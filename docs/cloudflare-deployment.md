# Cloudflare worker deployment check

`npm run build:cloudflare` builds OpenNext, then runs `npm run check:cloudflare`.
GitHub deployment and CI both use this checked build.

The checker executes the **installed OpenNext CLI**, including its yargs parser,
`withWranglerPassthroughArgs`, deploy handler, and `runWrangler`. An isolated Node
probe replaces cache population, config/environment loading, and deployment
mapping with local stubs. It intercepts subprocess spawning before any command
can run. Cache population must be called before the final deploy invocation.
The probe uses Node's `registerHooks` API (Node 22.15+; CI uses Node 22).

The checker requires explicit `wrangler.jsonc` selection in both OpenNext's
config/cache options and the captured final subprocess arguments. It then runs
that captured npm/Wrangler invocation with `--dry-run` and temporary output and
metafile paths. Unsupported arguments fail closed before invoking Wrangler.
It checks the custom entry point, `default`, `ChatNotifications`, the three
OpenNext exports, and locally bound/declaratively configured Durable Object classes.
It requires top-level `exports.ChatNotifications` with `type: "durable-object"`
and `storage: "sqlite"`, and rejects any top-level `migrations` field. Credentials
and metrics are disabled for the dry-run. No upload or remote cache population
is performed. Do not run the real OpenNext deploy command with `--dry-run` as an
offline check: it populates remote caches before invoking Wrangler.

## Proven production root cause

The operator-provided live Cloudflare Versions API evidence distinguishes code
exports from declarative lifecycle configuration:

| Version | `script_runtime.migration_tag` | `script_runtime.exports` |
| --- | --- | --- |
| 83 (deployed) | `chat-notifications-v1` | `ChatNotifications: {type: "durable-object", storage: "sqlite"}` |
| 87 (uploaded during failed attempt) | `chat-notifications-v1` | Absent |

Version 87 still lists `ChatNotifications` in `named_handlers` and retains its
Durable Object binding. The code export and entry point are correct. Cloudflare
rejects the missing declarative lifecycle entry with
`provisioned_class_missing_from_config` for `ChatNotifications`. The shared
historical migration tag does not replace the required exports map.

The [Cloudflare class lifecycle documentation](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
(updated 2026-09-22) says that after deploying with `exports`, later deployments
must keep using it. Legacy `migrations` and declarative Durable Object `exports`
are mutually exclusive. Existing namespaces can switch configuration formats
without moving data: classes created by `new_sqlite_classes` retain storage
`sqlite`. Accordingly, `wrangler.jsonc` replaces its legacy migration block with:

```json
"exports": {
  "ChatNotifications": { "type": "durable-object", "storage": "sqlite" }
}
```

The evidence above is a sanitized summary supplied by the operator; no live API
request is needed for these local checks. No credentials or account/version IDs
are recorded here.

## Argument-forwarding verification

The prior checker split the package script and passed its arguments directly to
Wrangler. That did **not** validate OpenNext's actual argument forwarding, and
could disagree with the production path. The regression fixture demonstrates
this: a `--` delimiter is stripped by OpenNext but was passed through by the old
checker, changing Wrangler's interpretation of the remaining flags.

The installed package identifies itself as OpenNext **1.20.6**. Its executable
behavior contradicts the proposed explanation that `--config` is consumed and
lost. Although `deployCommand` does not pass `wranglerConfigPath` separately to
`runWrangler`, `getWranglerArgs()` explicitly restores `args.config` as
`['--config', args.config]`. The CLI also removes `--` tokens before parsing.
The deterministic probe records the same result for both:

```text
opennextjs-cloudflare deploy --config wrangler.jsonc
opennextjs-cloudflare deploy -- --config wrangler.jsonc

config/cache path: wrangler.jsonc
cache target: remote
final subprocess: npm exec wrangler deploy -- --config wrangler.jsonc
OPEN_NEXT_DEPLOY=true
```

Therefore the package deploy command remains
`opennextjs-cloudflare deploy --config wrangler.jsonc`. Adding a delimiter would
not fix the reported production failure with this installed code. OpenNext's
cache population is retained. The live version evidence above establishes the
lifecycle-configuration failure independently of this local forwarding probe.

Explicit config remains necessary to prevent Wrangler following a generated
`.wrangler/deploy/config.json` redirect. The regression tests create an isolated
redirect to a worker without the required exports and exercise both command
forms through the checker. Missing explicit configuration is rejected.

After a build, run:

```sh
npx vitest run test/deployment
npm run check:cloudflare
node scripts/check-cloudflare-deploy.mjs .open-next/worker.js
```

The normal check must pass with entry `cloudflare-worker.ts` and exports
`BucketCachePurge`, `ChatNotifications`, `DOQueueHandler`, `DOShardedTagCache`,
and `default`. The last command is a negative control and must fail because
`.open-next/worker.js` lacks `ChatNotifications`.

The worker wrapper, Durable Object binding, and Dashboard behavior are unchanged.
The declarative entry matches the already provisioned SQLite class; no namespace
recreation, storage conversion, migration reset, or Durable Object data change
is required. The local checks do not deploy or modify remote state.

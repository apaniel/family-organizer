# Cloudflare worker deployment check

`npm run build:cloudflare` builds OpenNext, then runs `npm run check:cloudflare`.
The check invokes Wrangler with the deployment script's arguments, `--dry-run`,
and a temporary output directory/metafile. It verifies the custom entry point,
`default`, `ChatNotifications`, the three OpenNext exports, and locally bound
Durable Object classes. It does not upload or populate remote caches.
Both GitHub deployment and CI already call this build script.

`npm run deploy:cloudflare` pins `--config wrangler.jsonc`, whose `main` is
`cloudflare-worker.ts`. Keep this explicit: Wrangler can otherwise discover
`.wrangler/deploy/config.json` and follow a generated configuration instead.
OpenNext's deploy command is retained for R2 cache population.
Do not use OpenNext deploy with `--dry-run` as an offline check: installed
OpenNext 1.20.6 populates remote caches before forwarding arguments to Wrangler.

## Failure investigation

The reported production failure means the selected entry point did not export
`ChatNotifications`; exporting it in a wrapper cannot help if that wrapper is
not selected. Installed OpenNext 1.20.6 forwards deployment to Wrangler and does
**not** unconditionally replace `main` with `.open-next/worker.js`. Wrangler
4.132.0 supports generated-config redirection unless `--config` is explicit.
The production redirect/config files were unavailable, so redirection is a
supported failure mechanism, not a proven account of that production run.
The unmodified local checkout's default Wrangler dry-run already included the
wrapper and all required exports.

An isolated temporary project with a generated-config redirect to
`.open-next/worker.js` reproduced the missing-export failure (exit 1).
The same fixture with `--config wrangler.jsonc` exported `ChatNotifications`
and passed (exit 0). Both runs used Wrangler `--dry-run`.

After a build, reproduce the reported missing-export artifact locally:

```sh
node scripts/check-cloudflare-deploy.mjs .open-next/worker.js
```

This must fail: Wrangler reports that `ChatNotifications` is not exported by
`.open-next/worker.js`. Then run the production artifact check:

```sh
npm run check:cloudflare
```

This must pass with entry `cloudflare-worker.ts` and exports `BucketCachePurge`,
`ChatNotifications`, `DOQueueHandler`, `DOShardedTagCache`, and `default`.
The focused regression is `npx vitest run test/deployment/worker-deploy.node.test.ts`.
It protects explicit configuration selection and automatic artifact validation.

The wrapper pattern and configuration are documented in
[OpenNext's custom worker guide](https://opennext.js.org/cloudflare/howtos/custom-worker).
Bindings and the existing `chat-notifications-v1` SQLite migration are preserved;
this fix requires no namespace recreation or migration reset.

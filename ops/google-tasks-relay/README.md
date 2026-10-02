# Outbound Dashboard Tasks relay

The Dashboard queues Google Tasks intents in D1. This hermes-owned user service polls the authenticated Dashboard and invokes only `/opt/hermes-tasks/client.py` through the existing family adapter. It has no listener, OAuth flow, copied tokens, or protected-service modifications. The existing family request helper supplies authentication privately. Use the installed Hermes venv (which supplies python-dotenv); system Python is not the service runtime.

Install only the supplied user unit under `~/.config/systemd/user/`, then `systemctl --user daemon-reload` and `systemctl --user enable --now google-tasks-relay.service`. User lingering must already be supported/enabled; never modify protected services to install this relay. The unit references this checkout's absolute path, so retain the checkout while the service runs.

Apply migrations 0008 and 0009 with the documented Cloudflare credential-injecting wrapper before deploying `npm run deploy:cloudflare`. Keep `cloudflare-worker.ts`, existing Durable Object declarative exports, R2, Calendar, auth and non-task routes intact.

Explicit browser keys represent a single intent and survive failed submission retries; closing/reopening a form creates a new intent. Completed keyed retries return their original verified result, even after deletion. Keyless requests deduplicate active/ambiguous work only. A fresh deliberate creation receives a new broker sourceKey. An unresolved ambiguous creation blocks new creations; do not clear it or repeat the Google mutation automatically. Inspect the broker and operation readback before any separately authorized recovery.

A claim can be retried only before execution begins. Expired executing leases become ambiguous and are never replayed. A SQL CHECK guard aborts the entire D1 transition batch on an expired, mismatched or terminal lease; zero-row transitions cannot publish a snapshot. Capture generation tickets are invalidated by begin/finish and by later captures. The capture start timestamp determines freshness; delayed publication cannot make an old capture fresh. Task mirrors expire after 90 seconds. The UI hides unavailable/expired task rows and reports availability separately while keeping non-task records accessible.

The broker accepts only Dani, Cris, Saida and Familia owners; empty/null/unassigned owners are rejected. Dashboard `Sin asignar` uses the shared Familia list plus an explicit `Responsable (Dashboard): Sin asignar` note. The adapter returns `Sin asignar` and removes this note from the editable notes field, then restores it on writes. Ordinary Familia tasks remain Familia. This is a supported-field representation, not native broker unassigned-owner support.

The Google updated timestamp is a preflight revision check, **not atomic optimistic concurrency**. The supported Tasks CLI has no documented ETag/conditional-update interface. Concurrent edits in Google between preflight and mutation can be overwritten; matching readback cannot prove an intervening edit never existed. Detected preflight conflicts are explicit failed operations; post-write errors/readback mismatches are ambiguous and never silently retried. Guaranteeing atomic Google edit protection requires a supported broker CAS capability. No direct API/token bypass is used. Completion digests use Google completion timestamps and conservative inferred/other attribution; they do not invent historical channel provenance.

Local checks:

```sh
npm test
npx tsc --noEmit
npm run build:cloudflare
/home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/google-tasks-relay -p 'test*.py'
/home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/familia/google-tasks -p 'test*.py'
```

`verify_production.py baseline /tmp/unique-baseline.json` saves broker data privately (0600) before deployment. `verify_production.py verify /tmp/unique-baseline.json` runs real disposable CRUD through Dashboard routes with broker and Dashboard readbacks, same-key retry, deliberate identical recreation, cleanup, exact original-task preservation and non-task preservation assertions. It prints only verification evidence. It does not mutate existing family tasks. Do not run it without explicit production-verification authorization.

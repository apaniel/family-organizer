# Google Tasks relay verification — 2026-10-01 UTC

Completed deployment and disposable production verification on `integration/google-canonical`. Base revision: `f97374f0e2f056cc0115c15625ba590b0ad45d9a`, identical to fetched `origin/main` before changes. Existing unified tasks, gifts and chat capability was retained. User explicitly authorized deployment and requested the scoped commit after verification; that instruction superseded the deployment skill's default commit/merge/push-before-deploy sequence. No push or main-branch merge was performed.

## Changes and regressions

1. Worker readback compares adapter-transformed fields, including creation source notes (`Origen: Familia`), instead of the untransformed request. SourceKey retries preserve the Google identity.
2. Dashboard generates a UUID per submitted intent, retains it for failed submission retries, and generates a new intent when a form is opened again. Keyed completed retries return the verified result. Actor/payload permanent uniqueness is removed; keyless deduplication applies only to active/ambiguous operations, with an atomic insertion predicate. Ambiguous creations block further creates until reviewed.
3. Begin/finish use a SQL CHECK guard inside the same D1 batch as the state transition, generation change and mirror publication. Expired, terminal, mismatched and concurrently changed leases abort the whole batch. A zero-row transition cannot publish. Regressions include a competing transition immediately before the transaction, expired/duplicate finish and old lease tokens.
4. Every capture gets a generation ticket before the broker read. Begin/finish and later captures invalidate older tickets. Publication uses capture-start time for freshness and rejects captures delayed beyond 90 seconds. Regressions cover delayed pre-mutation capture, delayed older refresh, capture expiry and refresh during execution.
5. Supported CLI inspected with `python3 /opt/hermes-tasks/client.py --help` and `status`; actions are status/list/get/create/update/complete/reopen/delete. No supported/documented conditional ETag update was found or used. Preflight revision mismatch is an explicit failed conflict; post-write/readback uncertainty is ambiguous and never blindly replayed. No atomic Google optimistic-concurrency guarantee is claimed.
6. CLI validation established that empty, null and `unassigned` owners are rejected. It accepts only Dani, Cris, Saida and Familia. Dashboard `Sin asignar` is represented in the shared Familia list with the explicit note `Responsable (Dashboard): Sin asignar`; the adapter returns `Sin asignar` and removes/restores that note consistently. Ordinary Familia tasks remain Familia. Regression covers normalized notes, unassigned roundtrip and reassignment. This is supported-field representation, **not native broker unassigned support**.
7. Records response separates task availability from non-task data. UI hides absent/stale/failed-refresh task rows, expires snapshots even with no background refresh, and shows `Tareas no disponibles` instead of `Todo al día`. Non-task records remain accessible. Browser regressions cover initial failure, later failure, timed expiry and retry-key retention.
8. Independent digest authentication, invalid-date-before-storage, Madrid winter/summer and both 2026 DST boundary tests restored. Additive migrations preserve historical records/audits and provenance constraints. Meals retain CRUD, revision conflict and create/update/delete audit coverage. Reserved namespaces remain protected through planner predicates/assertions and unchanged-row/audit assertions; retired D1-task operations are rejected explicitly. Namespace tests use meals to exercise the remaining storage mutation paths rather than broadly accepting arbitrary failures.

D1-task/recurrence/flatten write-contract tests were replaced because these operations are intentionally retired; historical D1 task rows/audits were not migrated, rewritten, deleted or copied back into Google. Existing Google Calendar, auth, worker wrapper, R2/DO bindings and non-task business logic were not replaced.

## Local validation

Commands run from `/home/hermes/workspaces/family-google-canonical` without reading secret env files or printing credentials:

```sh
npm ls --depth=0
npx vitest run test/family-mission/pending-tasks.test.tsx test/family-mission/records.node.test.ts test/family-mission/completion-digest.node.test.ts
npm test
npx tsc --noEmit
npm run build:cloudflare
node scripts/check-cloudflare-deploy.mjs .open-next/worker.js
/home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/google-tasks-relay -p 'test*.py'
/home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/familia/google-tasks -p 'test*.py'
```

- Declared installed dependencies: no missing/invalid packages (`npm ls` exit 0). Next 16.0.6, OpenNext 1.20.6, Wrangler 4.132.0, Node 24.21.0. No package stubs or removal of checks was used to make the build pass. Relay uses the existing Hermes venv for its python-dotenv dependency, rather than relying on system Python for the service runtime.
- Focused: **46/46 passed**.
- Project: **34 files, 290/290 passed** (114.80 seconds), including deployment forwarding, auth, chat, gifts, Calendar/model and non-task coverage.
- Typecheck: exit 0, no diagnostics. Next's existing typecheck-skip setting was not used as a substitute for this independent check.
- Python final: **8 relay + 3 adapter tests passed** after the broker owner correction.
- Cloudflare build/check: exit 0. Captured installed OpenNext invocation: `npm exec wrangler deploy -- --config wrangler.jsonc`. Wrapper exports verified: `BucketCachePurge`, `ChatNotifications`, `DOQueueHandler`, `DOShardedTagCache`, `default`.
- Negative generated-entry check rejected `.open-next/worker.js`, as expected, because it lacks the wrapper's ChatNotifications export.
- `git diff --check`: passed. Python compilation: passed.

Initial validation runs exposed one duplicate-text test selector and a hidden-tab expiry fixture; both were corrected and the full suite rerun. Build emitted existing browser-data-age and middleware-convention warnings; these were not errors.

## Migration and deployment evidence

Used the documented [Cloudflare personal skill](/home/hermes/.hermes/skills/devops/cloudflare-personal/SKILL.md) and its existing private credential-injecting helper. No secret files were opened, no tokens were extracted/copied, and no protected broker/root services were modified.

Wrapper prefix (`CF` below is notation, not a new executable):

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/.hermes/local-customizations/cloudflare/cloudflare_personal.py exec
```

Commands executed with that prefix:

```text
npx wrangler deployments list --config wrangler.jsonc
npx wrangler versions view ffa86ef7-75ba-4451-8c6c-f5226260d7f2 --config wrangler.jsonc
npx wrangler d1 migrations list family-mission-control --remote --config wrangler.jsonc
npx wrangler d1 migrations apply family-mission-control --remote --config wrangler.jsonc
npm run deploy:cloudflare
npx wrangler deployments list --config wrangler.jsonc
```

Only pending migrations **0008_google_tasks_relay.sql** and **0009_google_tasks_fences.sql** were applied successfully before deployment. They create transport/mirror/fence tables and drop the permanent intent index; no family-record data migration is performed.

Before: `ffa86ef7-75ba-4451-8c6c-f5226260d7f2` (2026-09-26). After: **`d6a65270-28dc-4945-8d53-b4e0bd11d8f7`**, created **2026-10-01T06:56:54.769Z**, deployed at 100% to existing custom domain `apalas.apaniel.dev`, independently confirmed with live deployments list. Deployment retained `CHAT_NOTIFICATIONS`, `FAMILY_DB`, `FAMILY_DOCUMENTS`, `NEXT_INC_CACHE_R2_BUCKET`, `WORKER_SELF_REFERENCE`, `ASSETS`, `WORKER_VERSION`; no namespace recreation or new server/OAuth path.

Built artifact SHA-256:

```text
cloudflare-worker.ts: 3246f7d84ec1141fa11b059998e4981d8794309b4fcb22409c4fbe042eca1944
.open-next/worker.js: d05223bf4d44c84108a102ab62aa3bc9c5568f0c3ac2064c37be5cc65c64bc45
.open-next/server-functions/default/handler.mjs: 7f45875fb75c1d9f7f7e9fb9266be8ea97bde27d6ad36d47cfdaf01f74a4796f
```

The later owner correction changed only the local Python relay adapter/runtime and its regressions/documentation; the validated deployed Worker artifact is unchanged.

## Durable outbound service

Installed only `/home/hermes/.config/systemd/user/google-tasks-relay.service`, owned by hermes. Existing user manager reported `running`; `loginctl show-user hermes -p Linger` reported **Linger=yes** before installation. No root service or lingering configuration was changed.

```sh
install -m 0644 ops/google-tasks-relay/google-tasks-relay.service /home/hermes/.config/systemd/user/google-tasks-relay.service
systemctl --user daemon-reload
systemctl --user enable --now google-tasks-relay.service
systemctl --user restart google-tasks-relay.service
systemctl --user show google-tasks-relay.service -p ActiveState -p SubState -p MainPID -p UnitFileState -p NRestarts
```

Final observed state: **enabled, active, running, NRestarts=0, MainPID=2165983**, started after the adapter correction at **07:01:07 UTC**. ExecStart uses `/home/hermes/.hermes/hermes-agent/venv/bin/python` and this checkout's `ops/google-tasks-relay/worker.py`. Outbound authenticated Dashboard polling only; Google operations use the protected Tasks CLI. No VPS listener, token copy, new OAuth, root restart or protected API bypass. Retain this checkout while the unit runs.

## Real production read/CRUD/readback/cleanup

```sh
/home/hermes/.hermes/hermes-agent/venv/bin/python ops/google-tasks-relay/verify_production.py baseline /tmp/google-relay-original-tasks.json
/home/hermes/.hermes/hermes-agent/venv/bin/python ops/google-tasks-relay/verify_production.py verify /tmp/google-relay-original-tasks.json
```

Baseline file was created 0600 and is not committed. Requests use the existing family helper's private authentication routine, not copied credentials. Reads/mutations use `/api/family/records`; operation polling and snapshots use `/api/family/tasks/relay`; Google readbacks use CLI `list`. Production digest uses `/api/family/completion-digest`.

The first disposable attempt (empty broker owner) was conservatively marked ambiguous. No task was created. Supported CLI rejected the invalid owner before mutation; exact original-task equality and absence of its deterministic sourceKey were confirmed. Only this own verification command `service:verify-176f1abc-c75e-42fc-b774-996e14ad307e` was conditionally marked failed in the transport table, with an explicit diagnostic, through the existing D1 wrapper. It was **not replayed**; no generic ambiguity-clearing behavior was introduced. The corrected Python adapter was tested and only the own user service restarted before the successful verification.

Final successful run completed **2026-10-01T07:01:48Z**:

| Action | Operation suffix (`service:verify-`) | Broker identity/result |
| --- | --- | --- |
| Create and same-key retry | `5899b618-0a17-44f9-af77-f4f220c1886c` | `M0pRV1EzUENyMDZCQ014bw`, open; one identity on retry |
| Update | `f7f3ace1-5cba-44e9-8483-007daf3ee3e4` | Same identity; changed title/notes verified |
| Complete | `81a2ce00-9b0a-46ac-bedb-0ed732f05dcc` | Same identity, done; completedAt and digest verified |
| Delete | `5445ab80-2914-4f12-a6e3-7867982e5c7c` | Absent from broker and Dashboard |
| Identical deliberate recreate | `23525f71-a78e-4ac6-8fbd-cf4da1f44f52` | New identity `N3JlZkZ3bDA3bHd6eXdRWA`, open |
| Delete recreated task | `a3066524-c262-4937-a857-d0d4f8f7c9fb` | Absent; cleanup complete |

All six command rows independently read back as **done** from remote D1. Source-transformed notes, unassigned representation, Dashboard revisions and broker values were checked. Exact equality of all **93 original broker tasks** held before and after; SHA-256 **`1c1032722409e3a6cd31843f83fc6a7613f1c68ab15de21db76c82293266ebbd`**. Non-task Dashboard records were unchanged. Original tasks were never selected as mutation targets.

Steady-service read confirmed snapshot refreshedAt advanced from **07:02:49.728Z** to **07:02:52.686Z**, with the same 93 original tasks still unchanged. Anonymous production requests to records and relay returned **403**. Calendar read succeeded before and after deployment (7 events for the same range, 2026-10-01 through 2026-10-02). API-route verification was performed; no parent browser login was synthesized.

## Residual limitations

- **No broker CAS/ETag:** Google edits between preflight and mutation can be overwritten. Matching readback cannot prove no intervening change existed. Atomic Google edit protection requires a supported conditional-update broker capability; it cannot be added safely via token/direct API bypass here.
- **No native unassigned owner:** Sin asignar is represented explicitly in supported Familia-list/notes fields. Google exposes the shared list and explanatory note; the Dashboard normalizes them.
- Mirrors are freshness-bounded snapshots, not instantaneous cross-system transactions. Expired/unavailable snapshots fail closed. Post-write uncertainty requires reviewed reconciliation; no automatic mutation replay.
- Google completion timestamps are canonical, but historical channel/evidence provenance is unavailable; digest uses inferred/other. Historical D1 rows/audits remain preserved and are not the live task source.

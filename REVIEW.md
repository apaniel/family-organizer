# Independent location feature review

**Verdict: NO-GO for the arrival/nearby implementation as submitted.** Resolve the code blockers below before approval. Live activation also remains NO-GO until the separate activation gates are satisfied. Departure, traffic ETA, routing and batching are explicitly future work and do not affect this verdict.

Reviewed branch `feat/location-aware-reminders` against `5fbb66f84823b0bb816bfa34eb6b6bc4ef612579`, including REPORT.md, every tracked change, and every untracked implementation, migration, documentation and test file listed by `git ls-files --others --exclude-standard`. Also read the existing auth, calendar/records routes, familia client, deployment workflow and migration detector. Only this file was written in the workspace. No installs, commits, deployment, network calls, broker reads or actual messages were performed. Offline probes used temporary SQLite and mock senders, with Python bytecode writes disabled.

## Code blockers

### B1 — Retry attempts/backoff are not durable across a crash (high)

`ops/location/runner.py:104–117`: one SQLite transaction spans the entire delivery batch, including external sender calls. Attempt increments at line 111 and acknowledgements at line 115 commit only after all calls finish. A process death during any call rolls back every attempt/acknowledgement in that batch. Thus the advertised maximum three attempts and bounded backoff do not survive crashes. A sender that durably dedupes successful deliveries can prevent duplicate successful messages, but cannot make this consumer's retry budget durable, especially for failures before acknowledgement.

Minimal offline reproduction: import `Engine`, `P`, `R`, `NOW`, `fix` from runner/test_runner; enqueue `{**R, 'mode':'nearby'}` with `evaluate([P],[r],{'Dani':fix(20)},NOW,{'task:l:t':'open'})`. Close/reopen the engine for each of four calls to `deliver([r],[P],{'task:l:t':'open'},sender,NOW+i)`, where mock `sender` records its invocation then raises `SystemExit`. Catch the exception and close the connection to simulate process death. **Observed: four sender invocations; persisted row remains `(attempts=0,status='pending')`.** No real transport is involved.

Required: commit bounded attempt/claim state before external work, with crash recovery/claim expiry and stable sender idempotency keys; commit outcomes individually. Test process death and concurrent recovery, including a crash late in a multi-notice batch.

### B2 — Old transition is relabelled as current after a place edit (high)

`ops/location/runner.py:74–77` checks duplicate fix time before checking revisions. `runner.py:159–163` then reads transition state without checking its stored rule/place revision and publishes it with the **current** revisions. Worker revision filtering cannot catch this, because the published envelope already carries the new revision. This produces a false proximity card for the edited place.

Minimal offline reproduction: run a deliver-mode mock cycle for nearby rule R, place P and `fix(20,NOW)`; then run another cycle with the same fix timestamp, place `{**P,'revision':2,'latitude':1}` and otherwise unchanged inputs. The user has moved the place roughly 111 km away. **Observed: published `state='nearby',placeRevision=2`, while SQLite transition remains `revision='1:1',inside=1`.** All senders/publishers were in-memory mocks.

Required: invalidate/check transition revision before duplicate-time handling and before publication. Missing current-revision evidence must publish unavailable or reevaluate safely. Include edits plus repeated/out-of-order fixes and interleaved consumers in regression coverage.

### B3 — Missing fixes bypass the promised retention cleanup (high, privacy)

`ops/location/runner.py:55–56` purges expired fixes only inside `evaluate`; `runner.py:136–140` returns before evaluation when the broker yields no valid fixes. Active consent plus an unavailable device can therefore retain its raw latitude/longitude indefinitely across otherwise successful cycles. The nominal 60-second title/status cache also stays physically retained; TTL controls reuse, not deletion. This contradicts the report's five-minute fix retention claim.

Minimal offline reproduction: one deliver-mode mock nearby cycle at NOW with `fix(20)` and an open target/title; another at `NOW+1000` with broker returning `None` and forbidden canonical-reader/sender mocks. **Observed: one raw fix still in `fixes`, and one title-cache row still in `cache`.** Repeating unavailable cycles continues to bypass cleanup.

Required: perform retention cleanup on every relevant invocation/early-return path, independent of fix availability, without requiring additional broker/canonical reads. Define and test physical cache retention separately from reuse TTL.

### B4 — Scheduler deadline cannot accommodate its permitted delivery batch (medium)

`ops/location/scheduled_cycle.py:22` kills the runner after 170 seconds. `ops/location/runner.py:106` allows ten sequential sender calls, each with a 20-second timeout (`runner.py:204`): delivery alone can consume 200 seconds. Metadata/canonical calls each have 45-second timeouts in `ops/familia/family_mission.py:18`; two sequential broker calls can add 100 seconds (`runner.py:131–133,169`), and derived publication is also sequential (`runner.py:205–206`). There is no shared deadline or remaining-budget check. Killing the runner during its transaction compounds B1, and subprocess.run's outer timeout does not establish termination of the runner's sender/broker descendants.

Minimal reproduction without live work: supply ten eligible pending notices and a mocked sender that consumes 18 seconds per call (below its 20-second limit). The batch requires 180 seconds before metadata/publication overhead, exceeding the wrapper's 170-second allowance. This is a static budget proof; no wall-clock slow sender or real process was launched during review.

Required: enforce a shared invocation deadline, stop claiming work before insufficient time remains, align child timeouts with the remaining budget, and ensure timeout cleanup includes descendants. Validate the actual wrapper-to-runner adapter path with offline fixtures, rather than replacing wrapper invocation with a direct `cycle()` call.

### B5 — Attention cards expire in Madrid rather than each place's timezone (medium)

`components/mission/LocationFeatures.tsx:17` supplies `dateKey()` (Europe/Madrid) to `lib/family-mission/location-model.ts:21`, which filters all rules against that one date. The consumer correctly uses the place timezone (`ops/location/runner.py:72,109`), so UI and consumer disagree for valid per-person timezones.

Minimal reproduction: at `2026-10-05T22:30:00Z`, a New York place with an open linked target and expiry `2026-10-05` is still valid locally. Madrid `dateKey()` is `2026-10-06`; passing that date into `locationCards` returns no card. Conversely, a Tokyo rule can remain displayed after its local expiry. This follows directly from the pure function and timezone conversion; no browser/live test was run.

Required: compute expiry per place timezone from the same current instant, and cover both sides of local midnight. Use the appropriate local date when offering expiry defaults as well.

## Security, identity and acceptance findings

- Browser authorization uses existing verified Cloudflare Access parent emails and same-origin mutation checks (`lib/family-mission/tasks-route.ts:4`, `lib/cloudflare-family-access.ts`). Service identities cannot mutate places/links. Browser reads and mutation WHERE clauses isolate person; linked place ownership is checked. Confirmations are server timestamped, links start disabled, and the UI explicitly says Cris notices also go to Dani's private WhatsApp. No configurable group destination was found.
- `personForEmail` maps the two Cris aliases to Cris and every other authorized email to Dani (`lib/family-mission/location-model.ts:5`). The upstream allowlist currently bounds this to two other addresses. Explicitly verify both are Dani aliases before live activation; future parent additions must not silently inherit Dani ownership. No unverified-email bypass was found.
- Task snapshots now expose list ID; adjunct uniqueness uses normalized target JSON, UI matching checks list+task ID, and canonical runtime lookup includes both. Missing/moved/deleted targets fail closed and no automatic remapping was found. Runtime concatenation at `runner.py:36,196` is not structurally collision-free for arbitrary colon-containing IDs, although standard Google IDs are opaque encoded IDs. A structured tuple/JSON key would strengthen the exact-identity invariant; adversarial arbitrary strings should not become alternate canonical identities.
- Google Calendar identity remains the existing fixed `losapalas@gmail.com` calendar and occurrence ID. Canonical location fields are preserved without canonical mutations. API and ICS produce different IDs (`google:<id>:<start>` versus `google:<uid>:single`/recurrence key), so fallback does not preserve adjunct matching; it fails closed. Document that availability limitation rather than claiming transparent identity continuity. Runtime Google lookup only covers Madrid today/tomorrow (`runner.py:198–200`); future event links outside that window are unavailable until fetched, even if their location rule is otherwise valid.
- Entry/exit use accuracy bounds and hysteresis; first reliable inside does not generate arrival, while nearby can trigger. Stale outside baselines and new revisions suppress fabricated arrival in the normal increasing-timestamp path. Conflicting per-person timezones deliberately fail closed and do not fan out broker calls. B2 is an exception to the report's stronger revision/state claim.
- SQLite BEGIN IMMEDIATE and episode uniqueness provide durable normal-path concurrency/dedupe. Parallel broker results are rejected by recorded/received ordering during evaluation. The existing parallel tests exercise evaluate, not full overlapping delivery, revisions, crash recovery or publication. A cycle guard is a start-time throttle, not a lifetime lock; slow direct runners can overlap after 60 seconds. B1/B2 must be covered under those overlaps.
- Consent is fetched fresh once per cycle, not before each send. Deliver uses that snapshot after broker/canonical work; revocation or edit during the cycle can still race a send. This is explicitly disclosed in REPORT.md/README.md and must remain an operational limitation, not a claim of immediate revocation. Stopping future scheduled invocations alone does not cancel an already-running process; an immediate-stop procedure must address that process and its transport child. API failure does not fall back to cached consent.
- No task completion/calendar mutation path, D1 task mirror, removed command queue or duplicate canonical task record was introduced. Local SQLite delivery messages and short-lived canonical title cache serve notification processing, not task authority.
- `migrations/0011_location_adjuncts.sql` uses separate adjunct tables and idempotent CREATEs. Existing main deploy Actions detect changed migration paths using the last successful deploy and apply D1 migrations before Worker deployment (`.github/workflows/deploy.yml`, `.github/scripts/d1-migrations-needed.mjs`). No manual deployment is needed. CI adds the Python suite; main deployment currently runs npm/tsc but relies on CI for Python validation.

## Separate activation gates and untested areas

These gates do not excuse B1–B5:

1. Reviewed PR/main Actions release and schema application; no migration/deploy was attempted.
2. Reviewed compatible private sender is **not implemented**. Its stdin contract requires `{destination,message,idempotency_key}`, fixed destination enforcement, durable sender-side dedupe, acknowledged-success exit semantics and no payload logging (`ops/location/README.md`). That is a meaningful contract, not evidence of deliverability or exactly-once external transport. Require offline contract/crash tests of the actual sender and separately authorized live validation before claiming delivery readiness.
3. Approved runtime identity/profile dependencies and existing read-only broker permissions; usable Cris device uploads; authorized scheduler/config activation. Keep enabled/deliver false pending approval.
4. Real per-rule personal confirmation and an operational revocation procedure covering in-flight work. Confirm email alias ownership and private state-directory/backups.
5. No live transport, broker response, browser automation, Cloudflare/D1 or deployed integration was tested in this review. The existing scheduler mock integration substitutes direct cycle execution and therefore does not prove main's helper import, real canonical adapter, sender subprocess or deadline handling. Parent independently runs npm test, tsc, Cloudflare build, 17 Python tests and demo; their results are not independently asserted here. This review's offline probes reproduced B1–B3; static inspection establishes B4–B5. `git diff --check` passed at review time.

Approval can become GO for the arrival/nearby code only after these coding defects are fixed and meaningful regression evidence is reviewed. Production activation requires the additional gates above; departure remains future scope.

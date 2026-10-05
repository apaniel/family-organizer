# Location-aware family features — implementation report

Status: review corrections implemented and verified in the isolated worktree; **not deployed, committed,
pushed, installed or activated**. No real reminder was armed or sent.

Worktree: `/home/hermes/workspaces/family-location-features`
Branch: `feat/location-aware-reminders`
Base: `origin/main`, `5fbb66f84823b0bb816bfa34eb6b6bc4ef612579`
Verified origin: `https://github.com/apaniel/family-organizer.git`

## Architecture established before edits

Read root CLAUDE.md, README.md, package.json, wrangler.jsonc, relevant API/store/UI
files, existing familia helper and ops docs, CI/deploy workflows, and the permitted
read-only `/opt/hermes-health/client.py`. No applicable AGENTS.md was found.

Google Tasks is canonical and is read/written directly by the existing Worker API.
The base removes the Tasks relay, D1 task mirror and command queue. None is restored.
Calendar uses canonical Google fields with read-only ICS fallback; local dashboard
plans remain in existing D1 records. Cloudflare Access verified emails and the
existing scoped family service credential remain the only API authorities.

Two authorized, read-only latest-location broker checks established the actual
response schema without outputting coordinates or health values: Dani has a location;
Cris (`wife`) has no uploaded location. The implementation treats unavailable data
as unavailable. No backend/admin credentials, root secret file, full history, service
edit, new broker route, or generic Cloudflare token was used.

The original checkout's four modified tracked files and four untracked reminder
files remain untouched. Final `git status --short` there has the same dirty paths
reported at the start. All edits and dependency installation were confined to this
new worktree; npm ci used `--ignore-scripts --no-audit --no-fund` because no existing
node_modules was available. No package manifest or lockfile changed.

## Acceptance delivered

| Area | Tested implementation and limits |
| --- | --- |
| Saved places | Authenticated, private CRUD; bounded name, coordinates, radius, IANA timezone and person. Person derives from verified email; cross-person mutations rejected. Revisions reject concurrent/stale writes. Linked places cannot be deleted. |
| Task adjuncts | Exact canonical Google list ID + task ID; new `googleTaskListId` on existing snapshots. Links contain no duplicate task record/title/body in D1; family_records and audit history remain unchanged. A moved/deleted/unavailable canonical target fails closed, without automatic remapping. |
| Calendar | Canonical Google API and ICS locations preserved. Saved-place links remain separate from canonical Google fields. Read-only Google events can edit their adjunct link without mutating Google. Local existing event identities also supported. |
| UI | Saved-place management, task/event link editing and explicit per-rule private confirmation. New links default disabled. Compact pending/arrived/nearby/unavailable attention cards with freshness and canonical status decisions. Browser receives derived states, never fixes or health streams. |
| Arrival/nearby | Executable deterministic consumer; first inside is nearby-only, arrival requires recent outside-to-inside evidence. Accuracy-aware entry/exit hysteresis. Date expiry uses each place timezone; one-shot and recurring episodes persist across restarts. Rule/place edits and stale baselines do not fabricate arrival or replay inside episodes. |
| Durable behavior | Temporary/local SQLite tests cover parallel consumers, dedupe, preview rollback, missing/stale/out-of-order/inaccurate fixes, ownership/version validation, retries and cancellation. Per-rule and place revisions prevent old notices/states being reused after edits. |
| Scheduler/conditional consumer | Real one-shot runner and config wrapper, not a placeholder broker adapter. Disabled by default, 300–3600s reviewed interval, durable early/duplicate guards, maximum two latest-fix broker calls per cycle. No LLM anywhere; no broker or canonical reads for empty/expired consent, and no canonical read/sender for missing fixes. Minimal eligible title/status cache has 60s TTL; consent is always fetched fresh. |
| Delivery | Offline scheduler-to-mock-broker-to-canonical-reader-to-private-sender-to-derived-state path exercised. Destination fixed to Dani's private WhatsApp `238615548420255@lid`. At most ten notices/cycle, three attempts/notice, bounded backoff and five-minute expiry. No group route or task completion operation exists. Live sender provisioning remains an activation gate. |
| Privacy | One minimal last fix/person, latest transition/rule, compact durable episode keys, short-lived derived states. No location trail or coordinate debug logging. Expired fixes are purged on invocation; message payloads after 30 days; dedupe keys survive. SQLite file mode 0600. |

Total scoped completeness: the prioritized **saved places + task/event links +
arrival/nearby + compact attention UI + durable offline consumer** vertical is
implemented and exercised. Production activation is intentionally incomplete.
**Leave-on-time, route/traffic durations, route optimization and combined-notification
batching remain unimplemented.** No traffic ETA or automatic departure urgency is
claimed. Multiple linked errands can be viewed as compact cards, but that is not a
claim of route optimization or combined delivery. No permitted duration adapter has
been established in this implementation; that must precede any departure vertical.

## Paths for independent review

- `migrations/0011_location_adjuncts.sql`: separate places, links and derived attention;
  idempotent CREATEs, canonical target uniqueness and foreign keys.
- `app/api/family/locations/route.ts`: existing auth/origin checks, private ownership,
  personal confirmation, service read-only metadata access, sanitized errors.
- `app/api/family/location-attention/route.ts`: existing service-only scope; strict
  bounded derived-state contract rejects coordinates/health fields and stale states.
- `lib/family-mission/location-model.ts`, `location-store.ts`: validation, private
  persistence/revisions, pure attention decisions.
- `lib/family-mission/google-tasks.ts`, `google.ts`, `model.ts`: list identity and
  canonical event location exposure; existing task operations retained.
- `components/mission/LocationFeatures.tsx`, `MissionControl.tsx`, `mission.css`:
  places/editor/card UI, minute-bounded metadata refresh.
- `ops/location/runner.py`, `scheduled_cycle.py`, `config.json`, `demo.py`, `README.md`:
  executable consumer, disabled scheduling config, safe offline demo, activation
  contract and retention/limitations.
- `ops/location/test_runner.py`: 17 offline regression tests.
- `test/family-mission/location*.test.ts`: 15 focused tests across API, storage,
  permissions, derived states, pure UI decisions and canonical Calendar preservation.
- `test/family-mission/google-tasks.node.test.ts`: existing snapshot assertion updated
  to verify the new canonical list identity.
- `.github/workflows/ci.yml`: Python location regression command added to existing CI.

## Original verification results (before independent NO-GO review)

The original implementation recorded these checks; this section is historical and is superseded by the correction evidence below:

```
npm test
# 41 files, 331 tests passed
npx tsc --noEmit
# exit 0
npm run build:cloudflare
# OpenNext build complete; Cloudflare deploy-check dry run passed
# --dry-run: exiting now; no upload/deployment
python3 -m unittest discover -s ops/location -v
# 17 tests passed on final Python implementation
python3 ops/location/demo.py
# offline:true; one mock arrival notice; final canonicalTaskStatus:open
python3 ops/location/scheduled_cycle.py
# {"skipped":"disabled"}
git diff --check
# exit 0
```

The first full npm run exposed an exact snapshot assertion and a malformed-response
handling issue in the new panel. Both were corrected; targeted and final full suite
passed. The final Python refinements were followed by the 17-test regression run and
offline demo. No additional browser UI automation was run. Existing npm suite UI
regressions ran as required by the user's canonical npm test command.

## Activation gates and remaining risks

1. Parent independent review comes next. No commit/push/PR has been created. Any
   production Worker/schema release must be a reviewed PR merge to main through
   existing GitHub Actions; no local/remote D1 migrations or deployment occurred.
2. Every real reminder requires personal, per-rule UI confirmation. No production
   rule was written or enabled. Cris must upload usable device location before her
   rules can operate. All notifications go privately to Dani, which the confirmation
   text explicitly states.
3. The repo has no approved compatible WhatsApp sender. Provision a reviewed sender
   executable with durable idempotency for the stdin contract documented in
   `ops/location/README.md`. Local SQLite acknowledgement alone cannot guarantee
   exactly-once external delivery after a crash; sender-side dedupe is mandatory.
4. The approved runtime identity must already be permitted by the read-only health
   broker and the scoped familia helper. No sham token or direct health backend is
   introduced. The Worker receives only derived states through existing service auth,
   so no raw-location broker-to-Worker ingestion route is claimed active.
5. An authorized scheduler hookup and reviewed config activation are still required;
   this change installs/restarts no services and edits no profiles or existing jobs.
   Keep default enabled/deliver false until those gates are satisfied. The consumer
   needs the existing family-profile Python environment; it installs nothing.
6. Consent is read once per cycle; revocation can race an in-flight send. Stop future
   scheduler invocations and terminate/verify the wrapper, runner, transport child
   and descendants as documented in ops/location/README.md. Sender retries require the same
   private destination and idempotency key, have limited attempts and expire quickly.
7. Boundaries are deliberately conservative: accuracy uncertainty, sparse uploads,
   stale outside baselines, conflicting per-person timezones, unavailable canonical
   targets and network failures can suppress an otherwise useful notice. They never
   fabricate a fix, traffic duration or automatic task completion.

Existing user data, profiles, D1 audit history and other dashboard/watchdog work were
preserved. **Nothing in this report is a claim of production deployment or active
location reminders.**


## Independent NO-GO correction pass — 2026-10-05

Read the complete REVIEW.md and REPORT.md before editing. REVIEW.md remains
unchanged independent evidence (SHA-256
`66b0636fc0f6fde32d89b647b0a33ffea6d5e15ac76a6261ad8dcbc3158abe6d`).
Code corrections address B1–B5; they are not reclassified as activation gates.
Parent canonical reruns and a fresh read-only independent review were completed in this pass.

- B1: each SQLite attempt, stable episode key, unique claim token, 30-second lease
  and next-attempt deadline commits before invoking the sender. Each outcome commits
  separately and is conditional on its claim token. Interrupted attempts remain
  consumed. Recovery serializes expired claims and caps total attempts at three.
  Sender crashes still require sender-side durable idempotency to avoid duplicate
  external delivery; consumer acknowledgement does not establish exactly-once delivery.
- B2: revision invalidation precedes fix ordering checks; obsolete spatial evidence
  becomes unknown while episode consumption survives. Consumers with older revision
  snapshots cannot downgrade newer persisted evidence. Publication checks the stored
  revision; arrival candidate presentation also requires the same inside transition
  and timestamp, so intervening outside evidence wins. Repeated and older fixes after edits
  cannot put a current envelope around an old transition.
- B3: cleanup runs before metadata, missing-fix and throttle returns, after broker
  work, and on runner exit. Disabled wrappers purge an already-existing configured
  state file without creating one. Raw fixes expire at 300 seconds and canonical
  title/status cache at 60 seconds. Guard timestamps remain separately durable.
  secure_delete clears deleted pages; WAL truncation is attempted outside transactions.
  Concurrent readers can defer truncation; backups/filesystem snapshots require private
  retention management. Cleanup is invocation-driven, not a separate five-minute timer.
- B4: wrapper passes an absolute monotonic deadline (maximum 165 seconds) to runner.
  Broker/API/sender children use remaining-budget timeouts capped at 50/45/20 seconds.
  No send claim starts below 22 seconds remaining; maximum ten notices per invocation.
  API requests run in repo-scoped children importing the existing familia helper,
  without changes to that helper, services, profiles or Hermes core. Process-group
  TERM/KILL cleanup covers subprocess descendants; interrupted attempts stay durable.
  Offline fixtures launch the real wrapper/runner and broker/API/sender child processes,
  exercising main's canonical identity/status mapping rather than replacing invocation
  with a direct cycle call. Fixtures explicitly bypass credentials and network adapters.
- B5: cards derive each place's date and attention freshness from one instant;
  new-link expiry defaults use the selected place timezone. New York and Tokyo
  regressions cover both sides of local midnight.

Canonical target keys now use structured JSON arrays, including adversarial
colon-containing IDs. Ownership maps only the four existing allowed email aliases;
unknown newly allowed identities fail closed. This map does not independently
prove ownership of the two Dani aliases; operational confirmation remains required.
Calendar API/ICS IDs are discontinuous: fallback can make adjuncts unavailable and
never remaps them. Runtime Google Calendar fetch covers Madrid today/tomorrow only.
Future linked occurrences outside that window remain unavailable until fetched.

Transport assessment: repo searches found scheduler delivery configuration and
Apalas dashboard chat bridges, but no existing private WhatsApp transport with
acknowledged delivery plus durable sender-side deduplication. The chat run API's
idempotency is for dashboard runs, not proof of WhatsApp delivery. No safely supported
repo-only sender adapter can be established from those contracts without speculative
runtime/secret connections. No sender was invented; live readiness is not claimed.

Consent is fresh once per cycle, not immediately before each send. Revocation during
an in-flight cycle can race delivery. README documents stopping future scheduling,
TERM of identified wrapper/runner, verifying sender/API/broker descendants, targeted
process-group KILL if necessary, and preserving consumed attempt/claim state. Already
acknowledged messages cannot be recalled.

Scope exception: the first Python regression run retained an obsolete mock of
subprocess.run after the implementation moved to Popen. One adapter test therefore
invoked the real latest-location broker and received a usable fix in memory before
failing its mock-call assertion. No coordinates were printed or persisted by that
test, and no send occurred. This violated this pass's no-live-health-read instruction.
The mock now targets run_process; subsequent regression runs use mocks and explicit
offline subprocess fixtures. No commit, push, deployment, remote migration, live send,
service/profile edit or primary-checkout edit was performed.

The new regression coverage was added during the correction pass, rather than a
strict all-tests-before-edits TDD sequence. The initial implementation's tests alone
did not establish crash durability or actual subprocess integration.

### Correction verification evidence

- `npm test`: final rerun **41 files / 332 tests passed**, 115.91 seconds.
  First run: 40 files passed, one existing attention-assignment UI test exceeded
  5000ms while the production build ran concurrently. The unchanged test passed
  in the final standalone full run; no test timeout was raised.
- `npx tsc --noEmit`: final rerun exit 0.
- `npm run build:cloudflare`: exit 0, OpenNext build complete, Wrangler
  `--dry-run: exiting now`, deploy entry verified; no deployment/upload.
- `python3 -m unittest discover -s ops/location -v`: **34 tests passed**,
  23.935 seconds. Includes real wrapper CLI cancellation, sender timeout and
  descendant termination, actual runner canonical mapping through offline child
  fixtures, late-batch SystemExit, concurrent expired-claim recovery, durable
  budget/cancellation, revisions and retention regressions.
- `git diff --check`: exit 0. REVIEW.md checksum unchanged.
- Primary checkout `git status --short` was empty when checked in this pass;
  no primary files were edited. Its current state differs from the original
  historical report's dirty inventory; this pass did not cause that change.

Logs for this pass are in `/tmp/location-npm-test-final.log`,
`/tmp/location-tsc-final.log`, `/tmp/location-build.log` and
`/tmp/location-python-final.log` (local ephemeral evidence).
Production activation stays NO-GO pending the reviewed release/schema process,
compatible idempotent sender and separately authorized live validation, runtime
permissions/device uploads, alias ownership confirmation, personal rule consent,
private state/backups and scheduler activation. The fresh independent code verdict is GO as recorded below; production remains NO-GO.

- `python3 ops/location/demo.py`: offline:true, one mock arrival notice, final
  canonicalTaskStatus:open. Initial rerun exposed the demo's old colon key; corrected
  it to use the same structured target_key as the canonical adapter.


Fresh review identified two additional B2 interleavings in the first correction:
a resumed old metadata snapshot could downgrade newer transition evidence, and
candidate arrival presentation could override a newer outside transition. Both
new regressions failed before the follow-up fix and passed afterward. The final
parent Python rerun is 34/34; npm/TypeScript/build sources were unchanged by this
Python follow-up. The completed independent recheck is recorded below.


The fresh reviewer additionally found that place revision counters are only
comparable within the same rule revision: a new rule revision may relink to a
different lower-revision place. Comparison now orders rule revision first, then
place revision only when rule revision is equal. Three failing-before-fix tests
also cover deferring newer pending notices under stale delivery snapshots and
preserving newly created rule transitions absent from an older metadata snapshot.
Compact retired transition rows remain until explicit versioned deletion evidence
is available; they contain only revision/inside/episode/time, no raw coordinates,
canonical titles or message bodies. No stale snapshot can prune them implicitly.
Final parent Python run: 34 tests, 23.935 seconds, exit 0.


An additional failing-before-fix regression covers a newly created notice absent
from an older metadata snapshot. Missing rule/place metadata now defers a pending
notice until its five-minute delivery expiry; empty snapshots do not constitute a
deletion tombstone. Known disabled/unconfirmed rule revisions still cancel pending
notices durably and immediately, without cancelling newer revisions. Deferral can
hold later notices behind the oldest unknown notice until the next fresh snapshot
or expiry; this is bounded conservative suppression, not an external send.


### Completed fresh independent review

Read-only reviewer `/root/fresh_review` independently read the review/report and
final implementation, reproduced B2 interleaving defects offline, and re-reviewed
all follow-up corrections. Final verdict: **code GO for B1–B5 and requested
hardening; no substantive remaining blocker found**. Independent final evidence:
34/34 Python tests passed in 23.865 seconds; focused location Vitest suites passed
4 files / 16 tests in 3.68 seconds; diff check passed and REVIEW.md checksum stayed
unchanged. Reviewer made no edits or live adapter/service/profile/external calls.
Parent's full npm, TypeScript, Cloudflare dry-run build, final Python, demo and diff
checks are recorded above. Original REVIEW.md remains the independent NO-GO
submission evidence; it was not rewritten to reflect the fresh review.

Production remains NO-GO under the separate activation gates above. No durable
external sender, live delivery readiness, immediate in-flight revocation, transparent
ICS identity continuity, broader Calendar window or departure/traffic work is claimed.

# Unified canonical location rules

Review-only branch `feat/location-unified-rules`, based on origin/main 12697c1.
No real Tasks reads/writes, sends, cron changes, install, commit or push performed.
Personal wrappers retain explicit `HERMES_HOME=/home/hermes/.hermes`.

## Contract

`google_notes.py` is the single strict notes parser. v1 arrival remains compatible,
including fresh exterior baseline (900s), fresh fix (300s), accuracy and hysteresis.
v2 preserves the same place fields, replaces `nearby` with a typed `trigger`:

```json
{"type":"arrival","nearby":false}
```

```json
{"type":"presence_at","dueAt":"2026-10-07T00:00:00+02:00"}
```

The enclosing JSON has `version:2` and uses `[hermes-location:v2]` markers.
`dueAt` requires valid calendar date, seconds and timezone; no normalized bad dates.
`author_notes.py --trigger presence_at --due-at ...` uses canonical get → notes-only
patch → get verification, preserving unrelated notes, root metadata, sourceKey,
list/task IDs and Dani ownership. Without `--trigger`, existing v1 authoring works.
No task-specific local configuration is introduced; `notes-config.json` remains
generic. Canonical open Dani Tasks are discovered without a list mirror.

`notes_runner.py` is the common engine and `notes_state.py` the atomic private JSON
ledger. It stores identities, fingerprints, phases, evidence timestamps and immutable
delivery obligations, never GPS/history, SQLite or D1. Typed presence evaluates once
at the first poll at or after dueAt, even if the first fix is inside. The existing
300-second cadence remains: evaluation can be up to five minutes late under normal
operation, longer after downtime. This does not guarantee an exact minute. A finer
cadence requires a parent decision; no task cron or extra polling agent is added.
Only future rules cause no health calls. Recorded `due_at`, `evaluated_at`, `outcome`
and immutable notice make late, outside, stale and uncertain evaluations visible.
All notices use the approved private sender/receipt route on port 3000; success adds
no duplicate scheduler message. Malformed marked notes produce one durable private
error obligation; ordinary notes stay quiet. Claims are written before transport.
Unknown transport means possibly received, preserves the same body/key, and causes
a nonzero runtime result. Broker failures also cause nonzero results. Activation must
review cron failure delivery to the approved private DM, because this code cannot
make a scheduler's local failure visible by itself.

## Stationary inference: proposed bounded policy

Fresh position uses 300s and `distance + accuracy <= radius`, accuracy ≤100m.
Only typed timed presence can infer continuing presence from an older fix; arrival
never uses this relaxation. Proposed maximum fix age: two hours; contact/upload
age: fifteen minutes; three distinct stationary inside records spanning at least
thirty minutes, ending at the latest fix. Latest fix must explicitly be stationary,
`last_upload_at` must follow its receipt, and `last_location_ts` must match the latest
fix timestamp. Exactly one unrevoked device with a nonempty label and recent
`last_seen` supports limited person-scoped contact inference. Multiple active devices
report uncertain; the broker returns no device IDs binding a fix to that device.
History is read only via existing broker CLI, from latest fix minus two hours to
evaluation time, limit 200. Require `ok:true`, person `dan`, exact integer count equal
to the number of rows and below 200; absent `truncated`/`has_more` flags are accepted,
explicit true flags refuse inference. Valid geometry and event/receipt times are
required. Duplicate event IDs cannot count twice; conflicting repeats fail closed.
Distinct timestamps must be at least five minutes apart and span thirty minutes,
ending at the latest fix. Any event at/after that fix showing movement/exit fails
closed. An older trip uploaded later is not current movement.
No visit_arrival fallback, invented GPS or persisted history. Notice says
“Según el último registro … parece que sigues …”, not a claim of fresh GPS.
Contact and fix ages are checked against the local clock after broker reads, never
against remote `persons.now`. Seventeen minutes without contact reports stale even
with a valid stationary baseline; no continued-presence promise follows.

Parent chooses the bounded policy default before activation: maximum fix age two
hours, contact fifteen minutes, baseline thirty minutes with three separated samples.
These are heuristic evidence thresholds, not task expiry or a new polling cadence.
The supplied actual broker contract uses `persons[].person`, `last_upload_at`,
`last_location_ts`, and device `label`, `revoked`, `last_seen`; history uses `ok`,
`person`, `locations`, `count`; location records use `id`, `ts`, `received_at`, `lat`,
`lon`, `h_acc`, `motion`, `kind`. No `last_upload`, device ID, support flag or explicit
nontruncation flag is required. Offline private fixtures cover the supplied shapes;
no server/core/profile source or live endpoint was read. See UNIFIED-MAPPING-FIX.md
for the mismatch, validation and inference limits.

## Historical migration, never automatic rearming

New installs create no legacy per-task config or wrapper; upgrades preserve existing obligations and refuse missing legacy state. Legacy source/config/state stay preserved for compatibility and unknown-claim
reconciliation. They are retired for new authoring/activation. Its fresh predicate
now imports the common predicate; no new presence-config authoring workflow.
After explicit parent authorization of canonical notes migration, use offline
`author_notes.py --migrate-legacy --canonical-task TASK.json --legacy-state OLD.json
--state NEW.json --evaluated-at ACTUAL_ISO_TIME`. The fixture must contain the
read-back canonical v2 rule. Existing ledger items cannot be replaced; retry or
unclaimed legacy operations are rejected. Sent/skipped/cancelled remain consumed;
unknown preserves the exact original body and idempotency key. No new key is minted.
A completed task remains inactive, so unknown reconciliation can still use the old
runtime/receipt path. Never change its claim to skipped merely because it is done.

Historical evidence supplied by parent (not queried here): rice task
`amRHNnMzTUJaWThCY0ZENg`, list `WHh4eXR1cG94dGRueW1VdQ`, source
`whatsapp:location:rice:laforja63:20261006`, cron `6550013600a1`, completed 12:54.
Legacy “skipped” may coexist with an actual earlier private callback: preserve both
facts and original claim; do not send rice again. Parent must reconcile that evidence
before any historical notes patch, which normal active-task authoring deliberately
rejects. The historical task may remain completed with legacy evidence; no automatic
notes write/migration is necessary. Existing arrival evidence task
`NnZKdzZtbkNoaVJwN205ZQ` is untouched. These IDs are evidence, never runtime selectors.

## Release and bounded pending work

Independent parent review → PR/CI → merge → exact reviewed main installer under
existing local VPS policy → canonical author/readback only when separately authorized.
No Actions-to-host deployment requirement or approval weakening. Preserve old configs
and ledgers. Never reinterpret a historical expired dueAt as authorization for a new
clock. A new timed reminder needs fresh confirmation. No UI edits or heavy app build.
Pending activation gates: parent stationary policy choice, historical receipt reconciliation, and private cron failure delivery review.

Validation: full current location Python suite passed (102 tests: prior 96 plus six
focused broker mapping regressions), using `/usr/bin/python3 -m unittest discover
-s ops/location -p 'test_*.py'`. Unified suite now has 17 tests. `git diff --check`
passed. Fixtures isolate external boundaries; no real broker or sender call.
Prior other-suite validation is unchanged; those suites were not rerun for this
stationary-only fix.

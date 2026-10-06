# Conditional presence implementation

Code-only review on `feat/location-presence-once`, based on fresh origin/main
`4fa0001`. No installation, live broker reads, task edits, messages or timer
creation were performed. Existing arrival cadence/config/state remain untouched.

`presence_runner.py` is a generic one-shot presence check, explicitly not an
arrival detector. It never completes tasks or interprets task notes as commands.
`presence-config.example.json` contains the exact canonical Dani rice identity,
confirmed OSM 63–65 Laforja coordinates and 100 m radius, and exact immutable
message. `operation_id` is a placeholder: parent supplies a fresh retry handle,
never the old completed job/key. No epoch or five-minute clock exists in code.

The canonical `get` broker receives subprocess stdin as in `Runtime.tasks`.
Owner/id/listId/sourceKey must match, done must be false, and deleted/completed
cancel. Health `where dan --tz Europe/Madrid` is read next; current time is taken
only after the read. Finite coordinates/accuracy/time, timestamps
`0 <= ts <= received_at <= now`, age <=300 seconds, accuracy <=100 m and
`distance + accuracy <=100 m` are mandatory. Regular CLI outcomes are Spanish user-readable messages for outside, stale,
uncertain and cancelled; successful or already acknowledged sends have empty
stdout because the private adapter delivers the rice notice. `--check` retains
`presence: ...` diagnostics. Broker errors/identity mismatch and unavailable or
unknown transport exit nonzero with fixed Spanish stderr. Unknown delivery
explicitly says the notice may have been sent and reception is unconfirmed,
including when the current condition is false. No titles/coordinates/secrets
are printed. Parent must use cron delivery and failure delivery to the same
private Dani DM: `whatsapp:238615548420255@lid`, through the existing hooks.
Scheduler delivery of diagnostics is not the rice adapter receipt; parent must
verify the actual callback status in scheduler failure tracking.

A separate owned 0700 `state/location-presence` directory contains owned regular
0600 config and ledger. The ledger schema is
`{"version":1,"claim":null}` or one claim
`{"body":{"destination":"238615548420255@lid","message":"…","idempotency_key":"presence:v1:<operation_id>"},"status":"unknown|retry|sent|cancelled|skipped"}`.
It contains no coordinates/history/queue. The reviewed JSON State filesystem
code is reused with a schema hook; arrival schema and defaults stay identical.
Locking and fsync/atomic replace precede the external call. A crash leaves
unknown; repeated runs retain the exact body/key, and configuration changes are
rejected. Acknowledged operations do not call sender again. A known pre-reservation unavailable result (exit 75) gets at most two
transport attempts per execution with the exact same body/key, within the
existing 165-second runtime deadline and 25-second child limit. There is no
new queue or retry key. An existing unknown claim gets only one reconciliation
call and remains unknown even on exit 75. Unknown is never
converted to an unclaimed retry, including on sender 75. Reconciliation uses
the existing private receipt route on port 3000 and its idempotency journal;
there is no new transport/database. Reconciliation still requires current task
and presence evidence. A false condition consumes an unclaimed/retry operation;
an unknown claim remains preserved. Repeating the same key may call the bridge
again, but the existing bridge guarantees at most one message for that key.

Exact offline validation commands from this worktree:

```sh
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -p test_presence.py -v
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -v
```

Parent activation only after review, PR merge and CI, from exact clean merged
main (no Actions-to-host installation):

```sh
/home/hermes/.hermes/hermes-agent/venv/bin/python ops/location/install-main.py --repo /home/hermes/workspaces/family-organizer --commit <reviewed-main-sha> --home /home/hermes/.hermes
```

Installer adds `scripts/location-presence-once.sh` and absent disabled presence
config/state, preserves existing configs/state, and retains versioned rollback
source. Parent chooses fresh operation_id before any claim, retaining exact
message and canonical identity. One operation per ledger: a subsequent independent
operation requires a separate private directory/state/config; never reset unknown
or sent evidence. Wrapper accepts `LOCATION_PRESENCE_CONFIG` for that explicit path.

Read-only live parent preflight (not run here):

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/scripts/location-presence-once.sh --check
```

`--check` validates paths/client availability and reads canonical task and health;
it never locks/claims state or sends. It prints the actual reason. Healthy
brokers with a stale baseline permit the authorized timed attempt, but stale
is not evidence of being inside. Actual read/identity errors are failures. Parent then enables the reviewed config,
verifies activation, and creates a NEW one-shot cron with supported Hermes
relative schedule `in 5m`, `--script location-presence-once.sh --no-agent --deliver
whatsapp:238615548420255@lid --failure-deliver whatsapp:238615548420255@lid`. Local scheduler source confirms `in 5m` is one-shot (`5m` alone recurs).
Exact parent-only creation command after verification:

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/hermes cron create 'in 5m' --name location-presence-once --script location-presence-once.sh --no-agent --deliver whatsapp:238615548420255@lid --failure-deliver whatsapp:238615548420255@lid
```

Five minutes are anchored to that new activation/preflight, never this
implementation turn. Do not reuse old job `1e45d61701fd`. No inline Python, pipe,
LLM or approval/core changes. Parent preserves current task notes and appends
verified retry time/conditional presence wording without an arrival marker via
the existing author-notes workflow. Do not create a duplicate Google task.

Historical validation before the user-output correction (superseded below):
8 new offline presence tests passed; full discovery
passed **82 tests in 60.820 seconds**, with no skips/failures. Full log:
`/tmp/location-presence-tests-final.log`. `git diff --check` passed; original
family-organizer checkout remains clean. Tests invoke fixture broker subprocesses
and the actual shell/script, covering inside/outside/stale, finite/time rejection,
identity/cancellation, broker blocked errors, read-only preflight, sender 75 and
unknown, durable crash claim, immutable stable body/key and acknowledged no-op.
Installer fixture executes the disabled presence wrapper and verifies config/state
preservation. Release tests assert the expanded explicit allowlist and wrapper
mode. Existing timeout fixture budget changed from 23 to 27 seconds because its
22-second sender guard left only one second for startup; runtime deadlines and
arrival behavior were not changed. Initial test runs caught archive expectation
updates and this fixture startup issue; all were resolved before final discovery.

Remaining: parent review -> PR/merge/CI -> exact merged-main installation ->
fresh handle/private config and read-only real-client preflight -> activation
verification -> NEW `in 5m` private-DM no-agent cron -> preserved task notes with
verified retry time appended by parent. None of these live steps ran here.

The authoritative user-output correction and fresh offline test results are
recorded in `PRESENCE-CORRECTION.md`. `PRESENCE-REVIEW.md` is preserved as the
read-only historical review; its local-only delivery acceptance is superseded.
Fresh independent scoped review remains a parent step, not self-approval.

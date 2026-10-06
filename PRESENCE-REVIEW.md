# Independent presence review

**CODEGO.** No verified code blocker in the current uncommitted `ops/location` diff. This is code approval, not proof of current presence, arrival, installation, or delivery. No live client checks, sends, installation, scheduling, commits, core/profile edits, or code/test edits were performed. Only this review file was written; tests used temporary offline fixtures.

## Findings first

1. **Activation documentation correction, not a code blocker:** `ops/location/PRESENCE-IMPLEMENTATION.md` says preflight must report `inside`. That adds an unauthorized upfront condition to the confirmed attempt five minutes after verified installation. Parent should supersede that instruction: healthy exact-task and location brokers with a stale baseline permit the timed attempt. Stale is not evidence of being inside. At execution, stale/outside/uncertain must still prevent sending. Broker/read/identity errors remain failures and must be recorded accurately; a cancelled task must not produce a notice.
2. **Default handle is a placeholder:** `PARENT_CREATES_FRESH_RETRY_HANDLE` passes syntax validation. The installer intentionally creates disabled config and initializes an empty ledger without client reads. Parent must replace the handle before enabling/first claim, preserving the exact approved body and identity. Never reuse the old job/key or reset unknown/sent evidence.
3. **Known limitation:** an unknown claim survives a subsequently false condition, but receipt reconciliation requires the task and presence condition to become valid again. The runner cannot confirm whether delivery happened while those conditions remain false. Retain the evidence and report unknown; no new key, fabricated success, or additional notice is warranted. This does not require a broader rewrite.

## Code and integration evidence

- `presence_runner.py` performs canonical task `get` through `/opt/hermes-tasks/client.py` with exactly the configured id. Returned owner/id/listId/sourceKey must match Dani / `amRHNnMzTUJaWThCY0ZENg` / `WHh4eXR1cG94dGRueW1VdQ` / `whatsapp:location:rice:laforja63:20261006`; `done` must be false and completed/deleted tasks cancel. The actual client exits nonzero for HTTP failures: a deleted Google task returned as 404 becomes `presence: FAIL: Tasks broker unavailable`, not silent success. No task completion or duplicate creation occurs.
- Location uses `/opt/hermes-health/client.py where dan --tz Europe/Madrid`; time is sampled after the read. Finite coordinates/times, valid timestamp order, both ages <=300 seconds, accuracy <=100 m, and distance + accuracy <=100 m are required at Laforja 63 (`41.3970791, 2.1465232`, radius 100 m). This is conditional presence, not arrival evidence.
- Real `--check` validates executable paths and reads the two exact clients; it does not open/lock/claim the ledger or send. Its zero exit can accompany `stale`, `outside`, `uncertain`, or `cancelled`; inspect the diagnostic rather than relabeling it inside. Disabled config still supports this read-only check.
- The stable shell wrapper invokes the installed Python script directly. Installed Hermes CLI/source supports relative `--script`, `--no-agent`, `--deliver local`, `--failure-deliver local`, and one-shot `in 5m` (bare `5m` recurs). The no-agent scheduler short-circuits before model/session execution. There is no inline printf pipe/python-c, LLM approval workaround, or core modification. JSON subprocess input within the trusted script is the existing client interface.
- Only the existing private adapter can send: destination `238615548420255@lid`, loopback port 3000 `/family/private-notice`, exact immutable message/key. Zero sender exit requires an acknowledged receipt. Locking spans inspection, durable claim, transport, and final save; fsync/atomic replace precedes transport. Unknown retains the same body/key, including after unavailable; acknowledged reexecution does not call transport. At-most-one message relies on the existing approved bridge's idempotency/receipt contract, not on a new transport or a claim of actual delivery.
- Runtime retains the existing 165-second budget, per-child timeouts/process groups, and SIGTERM/SIGINT child kill handling. Presence stores one JSON claim with no GPS/history and introduces no SQLite/D1 store. The `notes_state` schema hook preserves the arrival defaults/schema; existing tests pass. State rejects symlink ancestors and enforces owned private directory plus regular single-link 0600 ledger/lock. The CLI reads config directly before a private-file check; within this reviewed trusted-root install, the installer validates owned regular single-link 0600 config and private directories. Parent must retain that boundary for any override config.
- Installer preserves existing arrival and presence config/state, initializes only absent disabled state, and installs versioned release plus stable wrapper. Preparing/reviewing this diff does not switch current installation. Release tests explicitly include the presence modules/config/wrapper and their modes.

## Independent validation

Ran focused/new coverage as part of **one full discovery process**, including all eight presence tests:

```sh
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -v
```

**82 tests passed in 58.054 seconds; no skips or failures.** `git diff --check` passed. Coverage includes actual wrapper/subprocess fixture clients, read-only preflight, private receipt endpoint fixtures, unavailable/unknown/acknowledged outcomes, crash claim reuse, installer preservation, release allowlist, descendant cancellation, and existing arrival behavior. No actual phone/location freshness or real arrival was tested.

## Exact remaining parent steps

1. PR merge and successful CI; check out the exact reviewed merged commit on clean `main` in `/home/hermes/workspaces/family-organizer`.
2. Use the already authorized local installation, with the actual full merged SHA substituted; no Actions-to-host requirement:

```sh
/home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/workspaces/family-organizer/ops/location/install-main.py --repo /home/hermes/workspaces/family-organizer --commit <reviewed-main-sha> --home /home/hermes/.hermes
```

3. Verify the installed `current` release and stable wrapper; preserve arrival config/state. In `/home/hermes/.hermes/state/location-presence/config.json`, replace the placeholder operation id before first claim, retain the reviewed task/geofence/message/sender/state, and retain 0600 ownership. Verify the existing bot/receipt service on port 3000 is healthy without sending a test notice. Enable the reviewed presence config and verify installed readiness. Do not reset existing claim evidence.
4. Run the real read-only preflight and record its exact diagnostic:

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/scripts/location-presence-once.sh --check
```

Healthy brokers with stale baseline are permissible for the authorized timed attempt, not a guarantee of inside at execution. Record actual 404/read failures as failures. No pretend fresh fix or actual-phone test is needed.

5. **Only after verified installation/readiness**, create a NEW one-shot; this starts the five-minute clock, not this review:

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/hermes cron create 'in 5m' --name location-presence-once --script location-presence-once.sh --no-agent --deliver local --failure-deliver local
```

Verify the new job's exact stored time, script/no-agent flags, and both LOCAL delivery routes. Never reuse old job `1e45d61701fd`. Preserve existing task notes and append only the verified retry time/conditional-presence wording through the existing author-notes workflow, with no arrival marker. Afterwards report the actual local outcome: skipped reason, failure, unknown receipt, or acknowledged send; do not equate scheduler success with delivery.

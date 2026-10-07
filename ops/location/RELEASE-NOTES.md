# Google Tasks notes location notices — disabled release

For the optional explicit Apalas arrival extension and revision-2 parent authoring,
see [APALAS-IMPLEMENTATION.md](APALAS-IMPLEMENTATION.md). The original private
contract and historical commands below describe the base release.

The new notes flow supersedes the D1 association/delegation proposal. Existing
user places, dashboard routes and the legacy runner remain untouched for backward
compatibility; none is imported or called by this flow. There is no Calendar scope.

## Reviewed contract

Canonical owner is Dani. Tasks are read through `/opt/hermes-tasks/client.py list`
with `{"owner":"Dani","includeDone":false}`. Each returned `owner`, `listId`, `id`
is checked; list names and titles have no role in identity. Immediately before
transport, `get` with `{"id":"EXACT_ID"}` must return the same Dani/list/task and
an open, identical notes rule. Client null/no-stdin handling remains unchanged.
The checker never calls update, complete or any dashboard/helper/credential API.
No token, browser JWT, service delegation or new location server is needed.

The notes contain readable place/address/Maps URL and exactly one
`[hermes-location:v1]` JSON block closed by `[/hermes-location:v1]`. Required fields
are version=1, positive integer revision, name, address, mapsUrl, latitude,
longitude, radius (50–1000 m) and explicit Boolean nearby. `nearby:false` means
arrival: first inside never triggers, and an outside baseline must precede inside
within 900 seconds of the actual outside timestamp. `nearby:true` explicitly permits a first-inside proximity
notice. No expiry is invented; one acknowledged notice consumes the task even
across rule revisions. Done tasks stop. Notice delivery never completes a task.
Malformed marked rules fail closed; unrelated user notes are never parsed/logged.

`author_notes.py` is opt-in authoring only, with no execution on import. It requires
exact task/list/source key and all place fields; it reads, patches **notes only**
through protected `update`, then reads back to verify notes and the unchanged
canonical identity/source key. The broker retains root `#hermes`/HermesTask
metadata. Pure `google_notes.update_notes` preserves a raw trailing metadata line
and unrelated notes. Future WhatsApp intents must use this path rather than a
personal token. Do not attach diagnostics or silently delete old diagnostic text.

Location reads use `/opt/hermes-health/client.py where dan --tz Europe/Madrid`.
Only its current `location.lat/lon/h_acc/ts/received_at` are evaluated in memory.
Coordinates must be finite/in range; accuracy 0–100 m; age at most 300 seconds;
recorded <= received <= now. Non-increasing recorded timestamps are ignored.
Inside requires distance + accuracy <= radius; outside requires distance -
accuracy >= radius + max(50 m, radius/4). Ambiguous boundary samples retain the
previous phase but never renew outside evidence. Outside evidence older than 900
seconds at evaluation is discarded; each current fix still must be <=300 seconds old. Rules
changed before triggering require a new baseline. No rules means no location
read or sender call. No LLM/model or mail is involved.

## Private state and receipt ownership

Only `notes_state.py` stores new feature state: a versioned JSON object with
hashed canonical item keys and listId/id, rule fingerprint, outside/inside phase,
last fix and separate outside timestamps, delivery status, attempts and episode
(0 or 1). At the first durable delivery claim only, the version-1 notice text is
retained unchanged, including a bounded title snapshot and exact list/task IDs.
No coordinates, title history, task records, notes, place or source key are stored.
This minimal delivery obligation lives in the same private JSON; local 0600 and
0700 permissions protect it without another database or external cipher key.
Retained notice text is sensitive: never log it or upload runtime state. The parent directory must exist with owner/mode 0700; files and the
flock lock must be owned regular files with mode 0600 and one hard link. Ancestors
are opened with directory fds/O_NOFOLLOW. One multiprocess lock covers the cycle,
including broker reads and transport. Saves fsync then atomically replace and
fsync the directory. Missing, corrupt, duplicate JSON fields, unsafe paths/modes
fail closed. Never delete/reset an existing ledger to repair a failure. Explicit
`--initialize-state` works only on a disabled config and a nonexistent state file.
The reviewed installer creates the private directory/config before initialization.

The existing `private_sender.py` POSTs only to loopback port 3000
`/family/private-notice`, destination **238615548420255@lid**. Its three-field body
is destination/message/idempotency_key. The stable versioned notice includes a bounded readable title snapshot and
canonical list/task identifiers. The inspected client has no verified canonical
Google task URL contract, so no speculative link encoding is used. The exact
message is captured once at claim and reused after restart, title edits and code
upgrades; destination/key derivation remain version-1 constants. Existing legacy
claims lacking a stored message retain the old generic body, never retroactively
replace a reserved payload. Existing idle baselines lacking outside_at require
new outside evidence. Notice text is never emitted in logs. The key hashes canonical Dani/list/task/rule fingerprint
and one-shot episode. A durable `unknown` claim is saved BEFORE invoking sender.
Zero exit means HTTP 200 `acknowledged` with a stable messageId, after recipient
receipt. Timeout/mismatch/other failure remains unknown. Only the bridge's exact
503 `{"state":"unavailable"}` is a definitive rejection before reservation and
WhatsApp socket work (exit 75); fresh definitive attempts are bounded to three
across restarts. A 503 while reconciling an earlier unknown does not erase that
uncertainty. Each cron cycle calls the same sender/body/key to reconcile unknown,
only while the same active rule still exists. There is no new transport server.

The already-approved private bridge journal owns its unchanged SQLite receipts,
reserves before socket work and deduplicates by key **and payload hash**; reposting
an existing key reconciles receipt without resending. No new feature database is
introduced. A crash after reservation can lose an unattempted notice but cannot
replay it. Unknown/sent evidence is never expired or reset. Changed/removed rules
or completion stop further transport; unknown evidence remains for independent
receipt review. The existing route has no receipt-only lookup; the checker cannot
safely reconcile a removed rule through POST without risking a fresh reservation.
Do not invent a receipt, reset the key, or automatically rearm it. Reconciliation
of an unchanged active rule is available by invoking the same notes runner/config.

## Artifacts and exact release gate

`prepare-release.py NEW_STAGING_DIRECTORY` includes the new code, disabled
`notes-config.json`, notes cron entry/job and these notes alongside the legacy
runtime. It does not include test fixtures or any state. Top-level
`notes-config.json` is mode 0600. The new entry runs `notes_runner.py --quiet` with
external config `/home/hermes/.hermes/state/location-notes/config.json`, or the
explicit `LOCATION_NOTES_CONFIG` alternate path. Runtime config defaults
`enabled:false`, interval_seconds=300, private state.json, approved sender path.
Optional tasks_client/location_client paths are explicit fixture/runtime CLI
alternatives, not credentials or backend URLs. Production should keep defaults.
Python stdlib suffices for the new engine; the combined backward-compatible
artifact retains existing requirements for the old runner. Sender calls/process
groups are bounded; the whole cycle has a 165-second budget.

Local VPS `ops/location` runtimes need no Actions-to-host path. The parent reviews
code, opens a PR, merges reviewed main with `gh pr merge`, then installs from that
exact clean checked-out main commit through `install-main.py`. Cloudflare app/UI
changes continue to use main CI only; this release makes no app/UI/migration or
Cloudflare deployment changes. Existing approved private bridge/session identity
and receipt journal are preserved; no plugin reinstall is required when unchanged.

Remaining gates, owned by parent:

1. Independently review code/tests and the concrete private sender contract. Parent
   commits, opens/reviews PR and merges main. No installation occurred here.
2. Follow the local installer procedure below to install disabled source and the
   default-home wrapper. Preserve existing configs/state and old versioned source.
3. Parent updates the existing task only after review via protected authoring and
   verifies readback. Existing target is owner Dani, list
   `WHh4eXR1cG94dGRueW1VdQ`, task `NnZKdzZtbkNoaVJwN205ZQ`, source key
   `whatsapp:location:test:horitzo:20261005`. Retain original notes. Horitzo,
   Passeig Bonanova 7, approximate coordinates 41.40602887575433,
   2.1323827894099114, radius 150 m are the previously confirmed candidate;
   phone precision still needs real validation. Choose nearby explicitly (arrival
   uses false). Mark an old diagnostic obsolete only after actual activation.
4. Parent performs separately authorized readback, phone accuracy and real
   outside→inside/recipient-receipt smoke; offline fixtures below are not that test.
   Enable external config only after reviewed installation/readback. Register the
   five-minute script under the default Hermes home, with `--no-agent`, local
   output/failure delivery; list existing cron jobs first and reconcile the name.
   `notes-cron-job.json` is a desired contract, not a direct cron database edit.

No real Google reads/writes, mail, location reads or notices were performed during
implementation. No commit, push, live configuration/cron or production edit was
made. The obsolete location-chat-association worktree is preserved unchanged.

Parent-only authoring command after review (not executed during implementation):

```sh
/home/hermes/.hermes/hermes-agent/venv/bin/python ops/location/author_notes.py \
  --id NnZKdzZtbkNoaVJwN205ZQ --list-id WHh4eXR1cG94dGRueW1VdQ \
  --source-key whatsapp:location:test:horitzo:20261005 \
  --name Horitzo --address 'Passeig Bonanova 7' \
  --maps-url 'https://www.google.com/maps?q=41.40602887575433,2.1323827894099114' \
  --latitude 41.40602887575433 --longitude 2.1323827894099114 \
  --radius 150 --revision 1 --nearby false
```

If a marked rule already exists, inspect it and choose an increasing revision;
never silently overwrite it with revision 1. After reviewed local installation,
the parent reconciles cron name `location-google-notes` and registers the installed
`location-google-notes.sh` with the existing CLI:

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/hermes cron create '*/5 * * * *' --name location-google-notes --script location-google-notes.sh --no-agent --deliver local --failure-deliver local
```

## Offline verification

`python3 -m unittest discover -s ops/location -v` includes focused JSON/engine
checks, legacy regression tests and actual CLI/actual /opt clients with canonical
broker mocks injected at their HTTP boundary. The actual notes shell entry runs
with only temporary installation paths substituted and the external config
override. CI without installed /opt clients uses their exact source snapshots;
no integration test is silently skipped. The private sender hits the exact
approved route handler snapshot on a random local **test** port, using a memory
transport fixture and mocked WhatsApp send. Test endpoints only inject synthetic
receipts. Synthetic outside→inside, unknown timeout, restart and later fixture ACK
prove a single mocked socket send; they do not report real GPS or receipt.

No UI code changes require a local Cloudflare build. Existing parent deployment
CI retains its build. See the final review handoff for actual test results and
availability of existing node_modules; do not install missing npm packages here.

Validation completed against base `521ca2168ed39501d8ca4c27943e8d891faf9779`:

- 69 Python tests passed (50 legacy + 19 new), using the existing Hermes runtime
  Python with cryptography 50.0.0. The final complete run took 49.861 s.
- 332 npm tests in 41 files passed with `--maxWorkers=1`; `tsc --noEmit` passed.
  Existing family-location-runtime node_modules was reused through an ignored
  local symlink after matching package-lock SHA-256; no npm install was run.
- Shell syntax, Python compilation and `git diff --check` passed.
- No local Cloudflare build ran. Parent deployment CI retains that build.

The review worktree is `/home/hermes/workspaces/location-google-notes`, branch
`feat/location-google-notes`; changes remain uncommitted for independent review.

## Parent-only local installation (not executed)

Read-only inspection confirmed `local-customizations/location-runtime/current`
is a relative symlink to `release-c5060a3`, with sources at `ops/location` below it.
`install-main.py` uses that layout, requires branch main, exact HEAD and a clean
checkout, copies only the existing source allowlist, installs the actual shell
entry under default-home scripts and atomically switches current. Old versions
remain available for an atomic symlink rollback; do not roll back or reset state.
It does not fetch, merge, change core/profiles, register cron, enable or send.
Existing configs and state are preserved. Absent config is disabled 0600, new
private directories are 0700, and a genuinely absent ledger is initialized once.
Unsafe existing directory/config permissions fail for parent review.

```sh
# After parent PR review and gh pr merge, use a clean main checkout.
/home/hermes/.hermes/hermes-agent/venv/bin/python ops/location/install-main.py \
  --repo "$PWD" --commit REVIEWED_FULL_MAIN_COMMIT
```

Verify current resolves to release-REVIEWED_FULL_MAIN_COMMIT, config/state/lock
are 0600, immediate private directories and shell entry are 0700. Preserve private
backups before authorized installation. Read back the disabled config without
printing notice state. Parent authoring above must return verified:true and a
separate canonical get must match owner/list/id/sourceKey and the parsed rule.
Only after parent review and separately authorized readback/smoke may cron be
reconciled or enabled. Offline fixture ACK proves no live activation.

Current fix evaluation captures wall clock after latest() returns, with an
injectable clock for tests; future timestamps remain rejected with no skew allowance.

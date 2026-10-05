# Independent cross-repository local runtime review — 2026-10-05

**Code decision: NO-GO for the requested complete runtime contract.** Two reproduced issues need correction: plaintext private payload persistence in the consumer, and loss of sender executable permissions in the proposed downloadable checker artifact. **Private transport algorithm: GO for offline review**, with the documented at-most-once limitations. **Live activation: NO-GO**, separately, pending the existing activation gates below.

Reviewed workspaces:

- `/home/hermes/workspaces/family-location-runtime`
- `/home/hermes/workspaces/family-whatsapp-location-runtime`

Reviewed both `LOCAL-RUNTIME-REPORT.md` handoffs, all modified/new runtime and transport files, tracked runtime dependencies and tests, actual freshly patched bridge source, installed upstream adapter/cron/bridge contracts, existing familia helper, read-only broker client source, build/installer instructions, and release/deployment workflows. Included the untracked sender, preparation script, cron artifacts, activation instructions, private delivery module/tests, private-scope test, workflow and attributes file. This is a runtime cross-repository review, not a fresh audit of every unchanged dashboard component.

No production broker request, real send, install, deployment, network write, root operation, profile/core edit, or credential inspection/copy was performed. Tests used temporary synthetic state and socket/network guards. The only review source file created is this report. Public read-only access to the upstream artifact action documentation verified permission-loss semantics. No administrative authority or host connection is inferred.

## Findings

### P1 — Consumer persists private notice text and location data in plaintext

Source: `ops/location/runner.py:43–47,110–119,181–187` in the organizer workspace.

`deliveries.message` stores the complete reminder, including private place name and canonical task title. Successful delivery changes its status but retains that message for up to 30 days, with cleanup only on subsequent invocations. The target cache stores plaintext titles; `fixes.data` stores plaintext latitude/longitude/accuracy. Closing/checkpointing SQLite leaves the reminder text plainly readable in the main database. A private directory and mode 0600 restrict access but do not satisfy the requested no-plaintext-state contract, including preserved backups.

This behavior is inherited from the existing consumer and explicitly described by its README; it is not a newly introduced bridge-journal leak. Nevertheless the newly prepared full runtime includes it, so the complete runtime cannot receive GO under this review's privacy requirement. The transport journal itself passed the plaintext sentinel check and stores hashes, message IDs and states only. No plaintext production logging leak was reproduced.

Offline regression executed successfully, from the organizer workspace:

```sh
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python - <<'PY'
import sys, tempfile
from pathlib import Path
sys.path.insert(0, 'ops/location')
from runner import Engine, cycle, target_key
from test_runner import P, R, NOW, fix
with tempfile.TemporaryDirectory() as d:
    path = Path(d)/'state.sqlite'
    e = Engine(path)
    cycle(e,
      lambda: {'places': [{**P, 'name': 'PRIVATE_PLACE_SENTINEL'}],
               'links': [{**R, 'mode': 'nearby'}]},
      lambda *a: fix(20),
      lambda: {target_key(R['target']):
               {'status': 'open', 'title': 'PRIVATE_TITLE_SENTINEL'}},
      lambda *a: None, NOW, True)
    assert 'PRIVATE_TITLE_SENTINEL' in e.db.execute(
      'SELECT message FROM deliveries').fetchone()[0]
    assert 'PRIVATE_TITLE_SENTINEL' in e.db.execute(
      "SELECT data FROM cache WHERE key='targets'").fetchone()[0]
    assert 'latitude' in e.db.execute('SELECT data FROM fixes').fetchone()[0]
    e.close()
    assert b'PRIVATE_TITLE_SENTINEL' in path.read_bytes()
    assert b'PRIVATE_PLACE_SENTINEL' in path.read_bytes()
print('REPRODUCED plaintext consumer state')
PY
```

Required correction: remove unnecessary coordinates/title persistence and protect any durable private payload required for stable retry identity. Do not reconstruct changed plaintext under an already reserved key or weaken durable dedupe. Add a privacy regression covering successful, uncertain, cancelled and restarted state plus database/WAL/backup content. This review made no implementation changes.

### P2 — Downloaded checker artifact loses the sender's executable bit

Source: organizer `.github/workflows/ci.yml:39`, `ops/location/prepare-release.py:15–22`, `ops/location/runner.py` nested `send()`; activation instructions steps 5 and 7.

CI uploads the prepared directory directly using `actions/upload-artifact@v4`. The sender is executed directly with `run_process([str(args.sender)], ...)`, unlike the checker scripts invoked through Python. The action documents downloaded files as mode 0644. The activation instructions do not restore the sender executable bit. Consequently copying this downloaded release to the specified installation path leaves an enabled checker unable to start its sender; attempts fail without sending. This is an artifact contract defect, distinct from the missing approved Actions-to-host transport. The disabled staging test cannot expose it.

Source verification: [upload-artifact v4 permission-loss documentation](https://github.com/actions/upload-artifact/blob/v4/README.md#permission-loss). Its recommended tar packaging preserves permissions.

Offline regression executed: prepare into a new temporary directory; assert the copied sender initially has owner execute permission; normalize only that temporary sender to 0644; call `subprocess.run([str(sender)], input='{}', text=True, capture_output=True, timeout=2)` and observe `PermissionError` before any transport call. Running that same temporary release's disabled `scheduled_cycle.py --quiet` still returns zero with empty stdout. No actual Action upload/download was performed; normalization models the documented action behavior.

Required correction: package the reviewed release in a permission-preserving archive, or explicitly restore and verify the installed sender mode in the reviewed installation contract. Test a simulated downloaded artifact through an enabled guarded path. The plugin source artifact's build script is invoked with `bash` by `INSTALL.md`, so the same missing executable bit does not prevent that documented build invocation.

## Independent validation

Executed separately from the parent's runs:

```sh
# organizer workspace
/home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -v

# plugin workspace
HERMES_UPSTREAM=/home/hermes/.hermes/hermes-agent \
PYTHONPATH=/home/hermes/.hermes/hermes-agent \
/home/hermes/.hermes/hermes-agent/venv/bin/python -m pytest -q plugin/whatsapp-platform/tests
HERMES_UPSTREAM=/home/hermes/.hermes/hermes-agent node --test bridge/*.test.mjs
```

Results: **38 checker tests passed; 50 plugin tests passed; 20 bridge tests passed**, no skips in these local runs. Actual upstream HEAD is the workflow's pinned `819cc3cbe02104c420ea32f1f1a924247d42eaf8`. The bridge tests rebuilt into temporary directories with zero-fuzz patch application, preserved upstream lockfile, excluded dependencies/session, and rejected incompatible/reused targets. No dependency installation was run. Dashboard test/build results in the handoff were not independently rerun for this runtime review.

Additional independent adversarial checks executed through stdin, using temporary state only:

- **12 separate Node processes** concurrently reserved the same journal key: exactly one `fresh:true`, one stable ID across all processes. This supplements the maintained suite's same-process concurrent requests and two SQLite handles.
- Rejected receipt statuses `-1,0,1,2,6,3.5,'3',null`; exact outbound recipient statuses 3, 4 and 5 acknowledged durably. Changed message under the same key threw a conflict. Closed transport SQLite contained neither the synthetic plaintext message nor raw idempotency key.
- Sender rejected a changed receipt ID between reconciliation responses. Maintained tests cover timeout and exact three-field validation; success requires HTTP 200 plus acknowledged state and a nonempty stable ID.
- Prepared a new temporary release and ran its **enabled** wrapper with synthetic metadata, broker and receipt responses under the existing socket/credential guard. The copied `ops/familia/family_mission.py` imported successfully in the approved Python, API child used familia scope, sender reconciled the synthetic receipt, and quiet wrapper emitted no stdout. This exercises more than the maintained disabled staging test. Synthetic config points to the temporary sender; no live deployment path was created.
- Both findings above reproduced offline. Their regression snippets/procedure are recorded here because authorization permitted only this report as a source edit.

## Contract assessment

| Property | Assessment |
| --- | --- |
| Exact destination/options | Private route and sender require Dani's exact `238615548420255@lid`; reject changed target and extra thread/reply fields. No configurable group/private destination expansion. |
| Default scope + bot mode | Adapter strips the journal variable outside resolved `/home/hermes/.hermes`; endpoint independently checks bot mode and journal presence. Default cron entry explicitly selects default home. Existing loopback trust boundary remains; this does not prove administrator or live session identity. |
| Durable at-most-once | FULL-synchronous `BEGIN IMMEDIATE` reservation commits before queue/socket work. Unique key/hash/ID plus unchanged retries prevents a second logical socket-send authorization across races and restart. Consumer's leased claims and claim-token updates complement this. |
| Crash/receipt semantics | Maintained tests SIGKILL after reservation and after committed receipt. Reservation-before-send crash can lose a notice; receipt-before-commit crash can remain unresolved. Committed receipt survives response loss. This is not exactly-once delivery. No reset endpoint, automatic resend or success based on local send promise. |
| Receipt identity | Exact remote LID, outbound `fromMe:true`, no participant, integer status 3–5 and stored protocol ID required. Phone-JID aliases remain uncertain; this limitation is documented in INSTALL/ACTIVATION/handoff. It is a live receipt smoke gate, not evidence of silent duplication. |
| Shared lane | Actual patched queue remains occupied by the underlying socket promise after HTTP timeout. Private sends enqueue there; actual reaction route uses `sendWithTimeout`. Permanently hung socket blocks the lane until reviewed restart. No independent parallel private lane introduced. |
| Default/idle behavior | Disabled wrapper performs no API/broker/sender work; may clean an existing local state file. Enabled empty/unconfirmed rules read fresh location-rule metadata only, skip canonical records/broker/sender. Real upstream no-agent dispatch tested offline; success is silent, cron delivery/failure delivery local. |
| Broker scope/bounds | Existing client only `where dan|wife --tz ZONE`, mapping to `location_latest`; no history/health/persons route. 50-second child cap, existing client's 45-second socket timeout, shared 165-second budget, process-group cleanup. At most one latest-fix read per eligible person; conflicting zones fail closed. |
| Fix validation | Adapter validates `ok` and person, maps actual client fields to internal version 1; engine checks person/timezone/version, finite coordinates/accuracy, timestamp ordering and age under 300 seconds. Internal version 1 is an adapter schema, not proof of a broker-supplied version. |
| Canonical identity/eligibility | Structured list+task identity, fresh task status gating, no task completion or Google mutation. Fresh consent each cycle; documented in-flight revocation latency. Calendar window/identity limitations and unknown email aliases are documented fail-closed behavior. |
| Runtime/artifact paths | Copied helper relative import layout works in a staged enabled guarded run; approved interpreter supplies dotenv. Config defaults disabled/nondelivering outside familia profile. Cron path and command match upstream script handling. Artifact sender permissions need correction as above. |
| Plugin installer/workflow | New module is copied in initial and upgrade layouts and hashed in build stamp. Workflow pins upstream, runs source build/patch tests and Python plugin tests, produces source artifact only. Its pip install is workflow content, not an operation performed in this review. No approved host deployment capability is invented. |
| Private payload persistence | Transport journal passes; complete consumer fails requested no-plaintext-state requirement. Error messages examined are generic; no production plaintext logging leak established. |

## Activation gates — separate from code findings

1. **Existing Cloudflare zone-token failure:** handoff records Worker route authorization failure for the zone. Resolve through the existing authorized administrative/token workflow and rerun existing Deploy. This review did not independently query live deployment status or token privileges.
2. **Approved Actions-to-host path:** not established by the proposed artifact workflows. Existing service-user `INSTALL.md` provides concrete install layout; lack of host automation is an activation dependency, not the principal code defect. Runner existence/identity remains unverified; a prior 403 is not evidence of absence. No guessed SSH credential, runner label, root-host connection or admin bypass is authorized.
3. **Live identity/recipient receipt smoke:** separately authorized validation must prove installed default bot/session, supported LID receipts and broker authorization, followed by real per-person rule confirmation and alias ownership. No live smoke occurred here. Missing/mismatched alias/receipt must remain unresolved without a resend.

Keep both journals across upgrade/rollback and privately managed backups. Do not delete uncertainty or change keys to force delivery. Correct and regress the two code findings before giving the complete release code GO; completing those corrections alone does not remove the independent activation gates.

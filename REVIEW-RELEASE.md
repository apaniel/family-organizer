# Independent release review — 2026-10-05

**Code verdict: GO for the first local runtime, for new encrypted state under the documented trusted-user boundary. No release-blocking findings remain in this narrow review. Live deployment/activation remains separately gated.** This is fresh offline code-review approval of the current worktree changes, not approval to auto-merge, install, activate, or send.

Reviewed organizer HEAD `4be5e7ee4fbdc64ee0cc9b6420ea984155884133` and sibling HEAD `8e6598763b1c8f62f4dd2d9a5772f3fa0bb1268f`, tracked diffs and untracked runtime/release/privacy/path/transport sources, workflows and updated `LOCAL-RUNTIME-REPORT.md`. No AGENTS.md was found. Prior `REVIEW-LOCAL-FINAL.md` remains historical evidence. Only this report was written in either repository; execution used temporary synthetic state and existing dependencies, with bytecode disabled. No install, live broker access, send, deploy, core/profile change, commit or push occurred.

## Corrected boundaries

- `state_crypto.py:25–49`: directoryfd-relative `O_NOFOLLOW` traversal rejects ancestor symlinks, checks ownership and rejects unprotected writable nonsticky ancestors. Normal root/home modes and root-owned sticky temporary roots are compatible. Missing directories are created relative to an opened parent. The final parent must be user-owned exactly 0700; existing directories are never chmodded. SQLite can canonicalize procfd paths, so the ownership/write-protection checks are necessary in addition to retaining a descriptor. Root and malicious same-uid mutation are outside the stated boundary.
- `state_crypto.py:89–123`: lock metadata is checked on its opened descriptor. DB, key, WAL, SHM and rollback journal are checked before the read-only SQLite marker probe: user ownership, exact 0600, regular file, single link, no symlink. Key contents come from the validated descriptor. Exclusive relative creation and flock serialize new DB/key initialization; key data and its directory are fsynced. Existing DBs never acquire a replacement key. Partial initialization fails closed.
- `state_crypto.py:70–79,123–140`: SQLite receives an actual Linux `/proc/self/fd/<parentfd>/<name>` path. The parent descriptor transfers to the connection and remains open through Engine's WAL setup and subsequent work; close shuts SQLite first, then the parent descriptor. Setup lock closure is deliberate after authenticated connection initialization; SQLite transactions serialize subsequent schema/state work. Successful, failing-open and repeated-close paths tested below show no early close or descriptor accumulation.
- Encryption and stable retry remain intact. The exact reserved message is authenticated with its original delivery key; changed titles cannot rewrite retries. Fixes persist `{}` plus timestamps; canonical titles are no longer cached. DB/WAL/SQLite-backup scans, restart, uncertain retry, sent/cancelled states, terminal corrupt payloads and missing/wrong/corrupt keys pass. Legacy plaintext fails closed without changing DB bytes or creating a key. Five-minute fix and 30-day delivery cleanup, persistent episode dedupe, and retained transport uncertainty are unchanged. Metadata remains plaintext; old backups are not retroactively encrypted.
- Actual source-only tar creation is now implemented and CI uploads that tar. Member allowlist/modes, deterministic bytes and extracted enabled entry execution pass. The test changes only temporary installation paths, preserves the real default-home entry scope and familia helper selection, and guards network, Unix socket and credentials. The bundled Python sender executes with the approved interpreter despite mode 0644. Tar packaging was a parent correction choice, not a user requirement; there is no remaining packaging demand beyond a working reviewable runtime.

## Independent execution

All commands used the existing `/home/hermes/.hermes/hermes-agent/venv/bin/python` and `PYTHONDONTWRITEBYTECODE=1`.

| Check | Fresh result |
| --- | --- |
| `-m unittest discover -s ops/location -p 'test_state*.py' -v` | 11 passed, no skips, 3.773s, exit 0 |
| `-m unittest discover -s ops/location -p test_runtime.py -v` | 5 passed, no skips, 4.917s, exit 0 |
| Independent combined synthetic probe (`PYTHONPATH=ops/location`, Python stdin) | 1 passed, exit 0: new DB/key/lock/WAL/SHM are owner-owned single-link 0600 even under umask 000; parentfd inode stays pinned; rename of a live parent followed by DB write/checkpoint touches no replacement directory; persisted row exists in moved DB; double close releases parentfd; 20 injected SQLite-open failures leave descriptor count unchanged |
| `git diff --check`, each repository | Exit 0, no diagnostics |

The path suite exercises the prior malicious-ancestor and live 0644-WAL reproductions, all six entry types with unsafe mode/symlink/FIFO/directory/foreign-owner faults before SQLite access, ordinary ancestor modes, unsafe writable ancestors, and rename/replacement between validation and actual SQLite connection. Foreign ownership is simulated at fstat without elevated privileges. These are offline adversarial checks, not a hostile-user live test.

The parent's full **50-test** location rerun is separate evidence; it was not redundantly rerun here. Dashboard/build, plugin Python and bridge counts in earlier reports are prior evidence, not new executions in this review.

## Transport and release targets

Transport algorithm remains GO from the prior independent review. Inspected current code retains durable reservation before socket authorization, hashed exact payload identity, stable protocol ID, matching outbound exact-LID statuses 3–5, default bot scope and a shared lane held until the underlying socket promise settles. Its two central files match the prior review byte-for-byte:

```text
395e5d67fc2ce5bd7c05af15bade2b725c643257e706f2fb782ff349efe755ce  sibling bridge/private_delivery.js
a25a43911d1cf64f9a225e2c7dbfc9ff51dd299beb32909f0ab4a9221ecb40a1  sibling bridge/bridge.patch
151024e6062730c3d0eee649783b9e24cc955a2c8946d60c390b832b625d56c1  ops/location/state_crypto.py
6cfff097b6900eaaf997c268a950a915352612055fc85a095ecdcf0dec2fee4d  ops/location/prepare-release.py
```

Reviewable release artifacts are organizer **`location-runtime-disabled`**, containing `location-runtime-release.tar`, and sibling **`family-whatsapp-reviewed-source`** using the existing plugin/bridge-source install layout. Neither workflow deploys to the host. Tar directories and `cron-entry.sh` are 0700, external `config.json` 0600, other source files 0644; downloaded tar 0644 is acceptable. Archive owner metadata is normalized to 0:0, not an instruction to install as root.

Eventual reviewed host targets, all owned by the Hermes service user:

- Runtime: `/home/hermes/.hermes/local-customizations/location-runtime/current`, directories 0700, source 0644; bundled sender needs read permission.
- Entry: `/home/hermes/.hermes/scripts/location-private-checker.sh`, exactly 0700.
- External disabled config: `/home/hermes/.hermes/state/location/config.json`, exactly 0600.
- State directory: `/home/hermes/.hermes/state/location`, exactly 0700. Consumer `location-reminders.sqlite`, adjacent `.key`/`.lock` and SQLite sidecars exactly 0600, single-link regular files. Transport `transport.sqlite` and its journals must remain private 0600 and survive release/rollback. Keep the matching key separately protected from DB backups and out of artifacts.

No local activation is authorized by these targets. Reviewed PRs/main release, the known Worker route authorization failure, an approved Actions-to-host path, broker policy authorization, separately authorized real recipient-receipt smoke and real per-person/rule consent remain independent gates. Legacy-state upgrades additionally require reviewed offline migration and legacy-backup protection/retirement. The approved Python dependency contract must be satisfied at release. Offline GO does not establish live delivery or exactly-once delivery and does not authorize deleting uncertain rows, replacing keys or resetting state.

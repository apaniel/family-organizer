# Independent correction review — 2026-10-05

**Overall code decision: NO-GO for the complete requested correction contract.** The original plaintext-payload defect is corrected for new state, and the original downloaded Python sender execution defect is corrected. Remaining secure-path validation gaps and the absence of the specifically requested permission-preserving tar artifact prevent an unconditional correction GO. **Private transport algorithm: GO for offline code review. Activation: separately BLOCKED.**

Reviewed organizer HEAD `4be5e7ee4fbdc64ee0cc9b6420ea984155884133` and sibling plugin HEAD `8e6598763b1c8f62f4dd2d9a5772f3fa0bb1268f`, including tracked diffs and relevant untracked runtime, crypto, release, workflow, documentation and transport files. No AGENTS.md was found. Read `REVIEW-LOCAL.md` first. The original handoff's 38-test/completed verification summary is stale evidence, not verification of these corrections. The user's reported earlier pidfile failure/truncated npm notification is also not a completed run; this review independently executed the commands below.

Only this review report was added as a source edit. Tests used temporary synthetic state and existing dependencies; no installs, real broker calls, WhatsApp sends, deployment, profile/core edits, commit or push occurred. The requested build generates ignored build output. Installed upstream remained clean at `819cc3cbe02104c420ea32f1f1a924247d42eaf8`.

## Decisions by boundary

| Boundary | Code verdict | Evidence / limits |
| --- | --- | --- |
| Original private-payload persistence finding | GO for new-state encryption correction | Fernet ciphertext binds exact reserved key and message; persisted fixes contain `{}` and timestamps, and canonical title caching is removed. Independent privacy tests scan live DB/WAL and SQLite backups, restart, uncertain retry, sent and cancelled states. No sentinel plaintext or key bytes found. |
| Complete state path security requirement | NO-GO | Ancestor symlinks and unsafe existing WAL permissions are accepted; reproductions below. Direct parent/database/key/lock symlinks are rejected. |
| Legacy plaintext and missing/wrong/corrupt key | GO for fail-closed behavior | Existing plaintext bytes remain unchanged and no replacement key is created. Missing, wrong, malformed keys and corrupt payloads, including terminal payload validation, fail before scheduler external invocation. Legacy backups remain plaintext; migration/retirement is explicitly a separate blocked upgrade gate. |
| Concurrent key creation and stable retry | GO within tested local path | Eight independent processes successfully create one state/key and one delivery. Lock serialization plus exclusive mode-0600 key creation, file fsync and directory fsync are present. Exact original message survives title changes and restart; unchanged key/payload goes to sender. Abrupt termination during initial setup was not tested; a partial initial DB fails closed rather than silently resetting identity. |
| Original sender executable-bit finding | GO for bundled `.py` sender | `runner.py:291` invokes it with `sys.executable`. Actual staged files normalized to 0644 execute through enabled wrapper/helper/broker/sender with network and real-credential guards; acknowledged delivery and unchanged throttled retry pass. Generic executable senders still require executable permissions. |
| Requested permission-preserving tar artifact | NO-GO / absent | CI still uploads a directory (`.github/workflows/ci.yml:37–45`); `prepare-release.py` creates no archive. Test normalizes staged files to 0644, but neither creates/extracts a tar nor asserts archived modes. This is a missing requested packaging contract, not a reproduced remaining failure of the bundled Python sender. |
| Runner / scheduler / cron | GO for tested offline behavior, subject to state-path findings | All runtime and runner tests pass, including process-group cancellation, quiet enabled/disabled/throttled behavior, fresh consent, and bounded broker access. Actual Hermes no-agent dispatch is tested, but its script-execution callback is mocked; staged wrapper is tested separately. `cron-entry.sh` production absolute-path invocation itself is not installed/executed. Upstream `cron/scheduler_script.py:408–417` invokes `.sh` through bash; ACTIVATION additionally requires setting/verifying installed entry mode 0700. |
| Private transport algorithm | GO, original at-most-once limitations retained | Relevant git diff retains durable reservation before socket authorization, hashed journal payload identity, stable protocol ID, exact LID outbound receipt statuses 3–5, default bot scope and shared lane. All 50 plugin and 20 bridge tests pass. No crypto/artifact correction changes these contracts. No earlier source hash exists in the original review to prove byte-for-byte identity since that review; current reviewed hashes are recorded below. |
| Live activation | BLOCKED independently | Existing Worker route authorization failure, unestablished approved Actions-to-host path, authorized broker/recipient receipt smoke, real per-person consent, and legacy-state migration where applicable remain unresolved. No live status was queried here. |

## Remaining findings and exact offline reproductions

### P2 — State path checks do not reject symlink ancestors or unsafe existing sidecars

`ops/location/state_crypto.py:17–22` checks only the immediate parent. An ancestor symlink is followed during recursive directory creation. `:30–43,63` opens an existing database without validating existing `-wal`/`-shm` ownership, type or mode; the orphan checks at `:45–46` apply only when the main DB is absent. SQLite's read-only marker probe can already access those sidecars before payload authentication.

Executed with exit 0, using only temporary synthetic state:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=ops/location \
/home/hermes/.hermes/hermes-agent/venv/bin/python - <<'PY'
from pathlib import Path
from runner import Engine
import tempfile
with tempfile.TemporaryDirectory() as d:
    root = Path(d)
    (root/'real').mkdir()
    (root/'alias').symlink_to(root/'real', target_is_directory=True)
    e = Engine(root/'alias'/'private'/'state'); e.close()
    print('ancestor symlink accepted:', (root/'real/private/state').exists())
with tempfile.TemporaryDirectory() as d:
    p = Path(d)/'state'; e = Engine(p)
    wal = Path(str(p)+'-wal'); wal.chmod(0o644)
    other = Engine(p)
    print('existing WAL mode accepted:', oct(wal.stat().st_mode & 0o777))
    other.close(); e.close()
PY
```

Observed `ancestor symlink accepted: True` and `existing WAL mode accepted: 0o644`. These do not demonstrate plaintext leakage or a remote attacker: reminder ciphertext remains encrypted, and a private directory still restricts access. They demonstrate failure to enforce the requested secure-path boundary. Metadata is still plaintext by design. Reject untrusted symlink components and unsafe sidecars before SQLite access, using a path-opening strategy that does not merely add another check/open race. Add adversarial path tests. This review did not change implementation or weaken tests.

Separately executed direct parent, database, key and lock symlink checks: all rejected (`ValueError` for the first three, `OSError` for lock). Thus the remaining finding is narrower than a claim that all symlinks pass.

### Requested tar packaging is not implemented

`ops/location/prepare-release.py:9–30` uses a source allowlist with copy2; `.github/workflows/ci.yml:44` uploads that directory. `ops/location/test_runtime.py:85–94,109–117` simulates a permission-losing download and successfully exercises enabled delivery with the interpreter correction. There is no archive-generation/extraction step or tar member-mode assertion. No actual GitHub upload/download was run.

The original P2 may be closed on the implemented interpreter/explicit-install-mode alternative documented in `ACTIVATION.md:87–98`. It cannot be represented as a verified permission-preserving tar fix. To satisfy the user's explicit tar requirement, create/upload an archive and test the extracted actual release under the existing enabled guard, including archived/extracted executable modes and source-only contents.

## Dependency and release assessment

`ops/location/requirements.txt` pins `cryptography==50.0.0`; the approved interpreter independently reports `50.0.0`. CI installs that exact requirements file and release preparation includes it and `state_crypto.py`. No install was performed. ACTIVATION explicitly requires the approved Python to supply the pin. The installed upstream source now declares `50.0.1` for Python >=3.14 and a matching override; that differs from this existing runtime environment and the checker pin. No claim of advisory resolution or dependency convergence is made here; host upgrade must reconcile the reviewed dependency contract rather than silently use a different version.

Source-only allowlist testing confirms release excludes database, WAL, SHM, lock and key material. Private backups need the matching separately protected key; legacy plaintext backup inventory/retirement remains necessary. Encryption of reminders does not encrypt person/timestamp/transition/dedupe metadata or erase old plaintext backups.

## Fresh independent command results

Python commands used `PYTHONDONTWRITEBYTECODE=1`. Plugin commands ran in the sibling repository with `HERMES_UPSTREAM` and `PYTHONPATH` pointing to installed upstream. Node/npm heavy commands were serialized; no dashboard/build concurrency was used.

| Command | Actual result |
| --- | --- |
| Approved Python `-m unittest discover -s ops/location -v` | Exit 0; 43 tests passed in 28.130s; no skips. Includes all five privacy and four runtime tests. |
| Approved Python `-m pytest -q plugin/whatsapp-platform/tests` | Exit 0; 50 passed in 3.33s. |
| `HERMES_UPSTREAM=… node --test bridge/*.test.mjs` | Exit 0; 20 passed, zero failures/skips, 3.282s. |
| `npm test` | Exit 0; 332 passed / 41 files; 109.44s. |
| `npx --no-install tsc --noEmit` | Exit 0; no diagnostics. Uses existing local TypeScript without installation. |
| `npm run build:cloudflare` | Exit 0; Next compilation, static generation, OpenNext Worker bundle and bundled Wrangler dry run passed. Verified custom `cloudflare-worker.ts` entry and required exports. No live deployment. |
| `git diff --check`, both repositories | Exit 0. |

The previous pidfile-not-created failure belongs to a timing-sensitive subprocess-startup boundary test (`test_review.py:72–80` uses a 0.3-second child timeout), not the payload encryption regression. Both timeout/cancellation tests passed independently in this run. A missing pidfile means the test did not reach its intended descendant-observation precondition; it is neither evidence of a privacy failure nor a pass for descendant cleanup. No assertion or timeout was changed in this review.

## Reviewed content identity

SHA-256 at review:

```text
b7f3b73a890a353fc830659333d0bf21c99932aeb3649c223176d2d6c27aaa3a  ops/location/state_crypto.py
5d5473fe56e0759ace130cc3052ff0e191c53423b6e758d3f5f1f5b31b3a37a0  ops/location/runner.py
00912fdbe4dd6b4cb20adf75600e28e8288f3d7eae4172264bdfff4a18078d27  ops/location/prepare-release.py
873f50981b9441e86eca52ca6d4add0343edc5e77519ab68f21c3e194adb5bfb  ops/location/test_runtime.py
f88f9169eb2c647e20d71994e7c21bde8bc61ec60563fc98d7d8baee1a508a1d  .github/workflows/ci.yml
395e5d67fc2ce5bd7c05af15bade2b725c643257e706f2fb782ff349efe755ce  sibling bridge/private_delivery.js
a25a43911d1cf64f9a225e2c7dbfc9ff51dd299beb32909f0ab4a9221ecb40a1  sibling bridge/bridge.patch
```

This is a correction review with new execution evidence, not a repetition of the original two-findings verdict. Preserve both journals and exact retry identities; passing offline checks does not authorize activation.

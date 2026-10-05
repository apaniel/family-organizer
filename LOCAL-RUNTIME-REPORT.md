# Local location runtime handoff — 2026-10-05

Status: narrow final-review corrections implemented and verified offline; uncommitted, unpushed, uninstalled and
inactive. Parent must independently review both branches and orchestrate PRs,
review, merge and release. No message send, real health/location read, household
sample write, Google mutation, profile/config write, local production deployment,
credential copy or Hermes core modification occurred.

## Worktrees and baselines

- Organizer: `/home/hermes/workspaces/family-location-runtime`, branch
  `feat/location-runtime`, freshly fetched `origin/main` at
  `4be5e7ee4fbdc64ee0cc9b6420ea984155884133` (reviewed PR14).
- Plugin: `/home/hermes/workspaces/family-whatsapp-location-runtime`, branch
  `feat/location-private-transport`, freshly fetched `origin/main` at `8e65987`.
  Origin verified `https://github.com/apaniel/hermes-family-whatsapp.git`.
- Originals `/home/hermes/workspaces/family-location-features` and
  `/home/hermes/family-whatsapp-src` remain clean and unchanged. Unrelated checkouts
  were not modified. Fetch/worktree GitHub access used the personal wrapper with
  `HERMES_HOME=/home/hermes/.hermes` and the approved runtime Python.

## Discovery before edits

Read the installed plugin under `/home/hermes/.hermes/plugins/whatsapp-platform`,
private repository `INSTALL.md`, bridge build/patch/test contracts, organizer
instructions/workflows, existing familia helper, and read-only broker client
`/opt/hermes-health/client.py`. No AGENTS.md was found in these repositories.
Read official [cron docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)
and local authoritative messaging/CLI docs and implementation under
`/home/hermes/.hermes/hermes-agent/website/docs/user-guide/messaging/whatsapp.md`,
`website/docs/reference/cli-commands.md`, `hermes_cli/send_cmd.py`,
`hermes_cli/subcommands/cron.py`, `cron/jobs.py`, and `cron/scheduler.py`.
Hermes core revision is `819cc3cbe02104c420ea32f1f1a924247d42eaf8`; never edited it.

The actual default bridge process is Node 26.7.0, port 3000, mode `bot`, script
`/home/hermes/.hermes/plugins/whatsapp-platform/bridge-build/bridge.js`, session
`/home/hermes/.hermes/platforms/whatsapp/session`. Inspection used process arguments
and source, not live health or send requests. Existing `/send` has no durable
idempotency, and its Promise.race could release serialization after timeout while
the socket operation remained outstanding. `hermes send` offers no durable
idempotency/receipt contract either; wrapping it in client SQLite would leave the
send/save crash gap. Baileys' installed source supports the `messageId` send option
and emits recipient receipts via `messages.update`. These are used by the extension.

`/run/hermes-health/api.sock` is root:hermes mode 0660; runtime user uid/gid 1001
belongs to hermes. The root-owned `/opt/hermes-health/server.py` is unreadable to
this user. Socket access is demonstrated by file permissions only; broker policy
and actual location authorization are not claimed verified. No root/sudo or real
broker request was attempted. Only existing client `where dan|wife --tz ZONE`
(`location_latest`) is used, with consenting rules and fresh fixes. No history,
health, persons, or other route is invoked.

## Concrete implementation

Organizer files:

- `ops/location/runner.py`, `scheduled_cycle.py`: subprocesses use `sys.executable`,
  ensuring the cron's approved interpreter propagates through API and broker reads.
  Existing bounded budget, process-group cleanup, freshness/consent checks, private
  destination, durable consumer claims and retries are preserved.
- `api_child.py`: only this bounded child sets the existing helper's familia
  `HERMES_HOME` scope. It imports `ops/familia/family_mission.py`; it never copies or
  independently reads credentials, changes familia files, or accepts admin tokens.
- `private_sender.py`: executable with the approved runtime shebang. Exact three
  JSON fields, Dani's exact `238615548420255@lid`, no thread/reply/media options.
  Talks only to established bot bridge `127.0.0.1:3000/family/private-notice`.
  Reconciles the unchanged key for up to 18 seconds. Exit zero requires durable
  `acknowledged` with a stable message ID; uncertainty/error/changed ID fails closed.
- `config.json`: disabled and nondelivering; state moved out of familia profile to
  `/home/hermes/.hermes/state/location/location-reminders.sqlite`.
- `cron-entry.sh`, `cron-job.json`: default profile, `*/5 * * * *`, `no_agent:true`,
  success/failure delivery `local`. Entry runs the approved Python with `--quiet`.
  Successful empty/throttled/disabled cycles have no stdout and spend no LLM tokens.
- `prepare-release.py`: prepares a new review directory and a deterministic `.tar`
  containing only the explicit runtime/helper source allowlist and disabled config.
  Archive modes are entry/directories 0700, external config 0600, other files 0644;
  owners and timestamps are normalized. Existing destinations/archives are refused.
  No live install, restart, cron registration or activation is performed.
- `.github/workflows/ci.yml`: existing CI now builds/uploads the disabled checker
  tar on main, after existing checks. No secrets or live host deploy added.
- `test_runtime.py`: actual wrapper/helper/canonical/broker/sender subprocess tests
  under strict network, Unix socket and real-credential guards; real installed
  Hermes no-agent dispatch is also checked with temporary cron storage. Host-specific
  integrations skip on generic CI machines; portable sender/staging tests still run.
  Existing timeout test now waits up to one second for asynchronous descendant
  signal delivery rather than observing the process immediately after SIGKILL.

Plugin files:

- `bridge/private_delivery.js`: SQLite (`node:sqlite`, Node 22.13+) FULL synchronous
  durable reservation keyed by hashes of exact target/message/key. Atomic transaction
  commits a unique protocol ID and `uncertain` state before socket work. Concurrent
  requests and restarted processes cannot authorize a second send for that key.
  Reordered JSON fields retain the same payload identity; changed payloads fail closed.
  No plaintext titles, message bodies, locations or credentials are stored.
- `bridge/bridge.patch`: mounts the opt-in private endpoint on the existing loopback
  bot bridge, sends through the existing shared lane, supplies supported `messageId`,
  and reconciles only exact outbound LID receipts with recipient delivery/read/played
  status 3–5. Server/local-send acknowledgement alone does not count. The general
  lane stays held until the underlying socket promise settles, even after HTTP timeout.
  Reactions also enter this lane. A permanently stuck socket blocks until reviewed
  restart rather than permitting overlapping sends.
- `family_whatsapp.py`: removes the private journal environment variable from
  non-default profile bridges. Bot mode is additionally required by the endpoint.
- `bridge/build.sh`: copies the new module and records its hash in the build stamp;
  preserves upstream lockfile and never patches core. `INSTALL.md` now includes the
  module in both install/upgrade layouts and records uncertainty/retention semantics.
- `.github/workflows/release-artifact.yml`: minimal tested source-release proposal
  for reviewed main, pinned upstream build, Node/Python tests, existing install layout.
  It creates an artifact, **not a live deployment**, and invents no host credential,
  runner label, SSH path or admin token. `.gitattributes` permits required unified-patch
  context spaces; actual source whitespace checks pass.

The endpoint is disabled unless the default bot service is explicitly released with
`HERMES_PRIVATE_NOTICE_JOURNAL=/home/hermes/.hermes/state/location/transport.sqlite`
in a Hermes-owned mode-0700 directory. Existing session/auth/config remain in place.
Consumer and transport state must survive upgrade/rollback and private backups.

## Crash, acknowledgement and idempotency limits

The transport enforces at most one logical socket send per durable key; it does
**not** claim exactly-once delivery. Crash after reservation but before send can
suppress a notice forever. Crash after receipt arrival but before receipt commit can
remain unresolved unless WhatsApp replays that receipt. An already committed receipt
survives sender crash/HTTP response loss and is reconciled by the unchanged request.
Timeout, rejection, missing receipt, unexpected phone-JID aliases, thread, changed
payload or target never authorizes resend or success. There is no manual ack/reset
endpoint. Never delete uncertain rows or change keys to force another send.

Recipient receipts represent acceptance by the recipient device, not human reading
unless WhatsApp specifically provides READ/PLAYED status. No live receipt behavior
has been smoke-tested. Preserve this distinction during release and review.

## Final correction evidence — local only

`REVIEW-LOCAL.md` and `REVIEW-LOCAL-FINAL.md` are preserved unchanged. The latter
found two remaining boundaries: ancestor/sidecar validation and absent tar
packaging. Earlier preparation uploaded a directory and used the Python interpreter
plus explicit installed entry mode; it did not implement a permission-preserving
tar. The review characterized tar as an explicit user requirement; that provenance
was mistaken. This correction nevertheless implements the tar contract directly.

State setup now walks every ancestor with directoryfd-relative `O_NOFOLLOW`
opens and creates missing directories relative to the opened parent. Normal root
and home modes are accepted; no existing directory is chmodded. The immediate
state directory must be user-owned 0700. Existing DB, key, lock, WAL, SHM and
rollback journal must be user-owned single-link regular 0600 files before even
the read-only SQLite probe. Lock metadata is checked on the opened descriptor;
key reads use the validated descriptor; creation is exclusive and relative to
the pinned directory. SQLite setup uses Linux `/proc/self/fd` directory paths.
SQLite can canonicalize these paths, so ancestor ownership and write protection
also exclude untrusted renames: root/user-owned ancestors cannot be writable by
others unless sticky, until a user-owned private ancestor protects traversal.
Malicious same-uid processes and root are outside this boundary; they can already
read the key. Regression tests exercise the review's ancestor symlink and live
0644 WAL reproductions, all relevant file types/modes/symlinks, simulated foreign
ownership at `fstat` (no chown privilege), normal ancestor modes, unsafe unprotected
ancestor rejection and rename/replacement between validation and SQLite setup.
The actual `/home/hermes/.hermes` mode was read, not changed (0700 on this host).

New state uses pinned cryptography 50.0.0 Fernet ciphertext for the exact reserved
message bound to its unchanged delivery key. Fixes persist `{}` plus timestamps;
canonical target titles are not cached. Person/timestamp/transition/dedupe/status
metadata remains plaintext. Fresh privacy tests scan DB/WAL and SQLite backups,
restart through changed titles, stable uncertain retry, sent and cancelled states.
Existing plaintext DBs fail closed without byte changes or key creation. Missing,
wrong or corrupt keys and corrupt terminal payloads fail before external work.
There is no automatic legacy migration or backup erasure. A valid existing key
can be reused when initializing an absent DB with no journal; existing DBs never
receive a replacement key. Private recovery needs matching state and separately
protected key; legacy migration/retirement remains an activation gate.

Fresh command (approved existing interpreter, no dependency installs):

```sh
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -v
```

Final result: **50 tests passed in 28.576s, no skips, exit 0** (the prior 43 plus seven new
test methods). Log: `/tmp/location-corrections-python-final.log`. This includes
actual release generation/extraction: downloaded tar normalized to 0644, exact
source allowlist, no state/key/lock/sidecars, deterministic bytes and member modes,
safe extraction into temporary private storage, restored entry mode 0700, and
enabled direct entry execution through guarded helper/canonical/broker/Python
sender. Delivery is acknowledged, the immediate retry is throttled, and fresh
unconfirmed consent avoids broker/sender work. Only temporary extracted entry
paths are substituted; real network, Unix socket and credentials remain guarded.
A separate actual CLI tar preparation/extraction and disabled cycle also returned
exit 0. No actual GitHub upload/download occurred.

Scoped and repository `git diff --check` returned exit 0. New correction sources
checked against `/dev/null` produced no whitespace diagnostics (`--no-index`
returns difference status 1 for these new files); aggregate validation exited 0. Review-report hashes and sibling plugin status
were unchanged. This turn changes only organizer correction sources, tests,
workflow and local documentation; no plugin/profile/core changes occurred.

The independent review's earlier **332 dashboard tests / 41 files**, TypeScript,
Cloudflare bundle/dry run, **50 plugin Python** and **20 bridge** passes remain
previous-review evidence, not commands rerun in this correction turn. No dashboard
or plugin source changed here and no memory-heavy build was run. Earlier 38-test
handoff counts were stale; the intermediate 43-test review is superseded only for
the locally rerun location Python suite. No install, live operation, commit, push,
deploy or activation occurred. Offline checks do not authorize activation.

## Exact deployment blockers and administrative paths

1. Dashboard Deploy [37305124592](https://github.com/apaniel/family-organizer/actions/runs/37305124592)
   completed **failure**. D1/check/build steps passed and Wrangler logged Worker
   upload, then failed requesting
   `/zones/51e54d2d36df2d71ca3edc4bd573d17b/workers/routes` with
   `No access to the specified resource`. Do not claim live dashboard release
   success. An administrator must correct the existing deployment token's zone
   resource access/Workers Routes permission for the apaniel.dev zone through
   [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens), and if
   its value changes update the **existing** `CLOUDFLARE_API_TOKEN` secret at
   [repository Actions secrets](https://github.com/apaniel/family-organizer/settings/secrets/actions).
   Then rerun the existing Deploy Action. No local credentials were inspected/copied,
   no broad admin token or alternative deployment route was used. The exact missing
   permission vs resource membership cannot be distinguished from that response.
   [Official Workers authorization docs](https://developers.cloudflare.com/workers/authorization/workers/)
   require zone Workers Routes Write for route/domain changes in addition to Worker
   editor access. This is a specific administrative permission blocker, not a need
   to reconnect Codex or supply a new unrestricted token.
2. Organizer Deploy runs on `ubuntu-latest` and deploys only Cloudflare. The plugin
   repo originally has no `.github` directory or deploy workflow. Its existing
   `INSTALL.md` is a local service-user procedure, not an approved Actions-to-host
   transport. No evidence of an established host runner/deploy credential was found.
   Repo API reports admin/push access, but listing
   `/repos/apaniel/hermes-family-whatsapp/actions/runners` returned **403 Resource
   not accessible by personal access token**. Therefore runner existence/identity
   is **unverified**, not asserted absent. An administrator must inspect
   [plugin runner settings](https://github.com/apaniel/hermes-family-whatsapp/settings/actions/runners)
   (and organizer equivalent if choosing shared release ownership) and establish
   the reviewed Actions-to-host path using the existing service-user installer.
   No personal wrapper/admin-token bypass, guessed runner label or SSH secret is
   permitted. This missing approved path prevents a truthful live deployment
   workflow; the prepared artifact workflows are concrete reviewable work, not a
   substitute claim of automated host activation.
3. Broker policy cannot be audited by this uid because `/opt/hermes-health/server.py`
   is root-readable only. The service owner can confirm location_latest authorization
   for Hermes uid 1001 without widening health/history access. No credentials need
   be granted to the checker; post-review smoke can validate the exact approved
   client path without any implementation-time health read.

## Steps to activation

See `ops/location/ACTIVATION.md` for the full ordered procedure, exact install paths,
reviewed release scope, disabled config staging, journal preservation and default
CLI command. Parent review/PR/main Actions release come first, followed by resolving
the two deploy-path blockers, installed transport receipt smoke under separately
confirmed authorization, real per-person/rule confirmation and only then enabling
external config and creating/reconciling the exact five-minute no-agent job.

No leave-on-time extension, route/traffic adapter, Google note write, task completion,
family-profile cron or sample household state has been added. Production remains
inactive. This is an offline working runtime plus private transport implementation
ready for review; live deploy/smoke/activation remain blocked and unverified.

# Reviewed activation procedure — do not execute during implementation

The repository defaults remain `enabled:false`, `deliver:false`. New household
rules remain unarmed until each real rule has personal confirmation. No sample
rule, place or household record is installed by this procedure.

## Release preparation already implemented

`prepare-release.py NEW_STAGING_DIRECTORY` creates a disabled, self-contained
review directory with the checker, sender, existing scoped helper, cron artifacts
and an external disabled `config.json`. It refuses an existing destination. It
never writes a live install, credentials, profile, cron database or service state.
The existing dashboard CI prepares `location-runtime-disabled` on main. The plugin
repository's proposed `release-artifact.yml` validates the actual bridge patch
against pinned Hermes revision `819cc3cbe02104c420ea32f1f1a924247d42eaf8` and
packages reviewed source using its established `INSTALL.md` layout.

## Required release ordering

1. Parent independently reviews both worktrees; parent commits, opens PRs, obtains
   review and merges. No agent self-approval. Worker deployment uses only the
   existing `.github/workflows/deploy.yml` on reviewed main.
2. Resolve the Worker route permission failure recorded in `LOCAL-RUNTIME-REPORT.md`,
   then rerun the existing Deploy Action. A Worker upload alone is not deployment
   completion. No local Cloudflare deploy or copied token is permitted.
3. Establish and review an Actions-to-this-host installation path. Neither repo
   currently defines one; build artifacts are not deployments. Do not substitute
   a local manual install, invented SSH secret, arbitrary runner label, root or sudo.
   The plugin's existing `INSTALL.md` is the approved service-user install procedure
   to be used by that path once established. Preserve its bot session argument.
4. The reviewed host release must install the plugin **and** `private_delivery.js`
   through `bridge-source/build.sh` against the host's actual Hermes version. Never
   patch Hermes core. Install dependencies from the existing bridge lockfile.
   Keep rollback source outside plugin discovery. Start only the default bot
   bridge with `HERMES_PRIVATE_NOTICE_JOURNAL` set to
   `/home/hermes/.hermes/state/location/transport.sqlite` through the approved
   service environment; preserve all current session/config values. No familia
   profile file changes are needed. Node 22.13+ is required; observed host is 26.7.0.
5. That same reviewed release places the disabled checker at
   `/home/hermes/.hermes/local-customizations/location-runtime/current`, creates
   `/home/hermes/.hermes/state/location` as Hermes-owned mode 0700, and installs
   the prepared disabled config at `/home/hermes/.hermes/state/location/config.json`
   mode 0600. Preserve and privately back up checker and transport SQLite files.
   Existing runtime Python is `/home/hermes/.hermes/hermes-agent/venv/bin/python`;
   it has python-dotenv and can read the Hermes-group broker socket. The API child
   selects the existing familia helper scope without config/profile writes.
6. Validate the default bot's bridge/session identity and receipt capability under
   the separately authorized post-review smoke procedure. No message has been sent
   during implementation. Confirm explicit person email aliases and Cris's own
   agreement to Dani's exact private destination. No group or thread can be chosen.
7. The reviewed path installs `ops/location/cron-entry.sh` at
   `/home/hermes/.hermes/scripts/location-private-checker.sh`. After real rule
   confirmation and successful smoke, enable `enabled` and `deliver` only in the
   external runtime config. Activation calls the installed Hermes CLI under the
   **default** scope, with the following exact arguments:

   ```sh
   HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/hermes cron create '*/5 * * * *' --name location-private-checker --script location-private-checker.sh --no-agent --deliver local --failure-deliver local
   ```

   Use `cron list --all` first; if this name exists, reconcile the recorded job ID
   rather than creating another job. `cron-job.json` records the desired contract;
   it is a review artifact, not a direct edit of `cron/jobs.json`. Hermes accepts
   only scripts under the active home's `scripts` directory. The `.sh` entry uses
   the approved Python path explicitly, `--quiet`, and local-only cron delivery.
   Empty cycles invoke no LLM; successes emit no cron notice. The private sender
   owns notification transport, so cron must not post its output to WhatsApp.

## Receipt and stop semantics

Private transport HTTP 202 means uncertain, not success. The sender polls the same
key up to 18 seconds, then exits nonzero unless a matching recipient receipt was
durably acknowledged. Consumer retry/backoff can reconcile the same key but cannot
issue another socket send. A reservation crash before sending can lose a notice;
a missing/reordered/lost receipt can leave it unresolved permanently. There is no
claim of exactly-once delivery. Never erase journals, change a key to force retry,
or manually mark uncertainty as success. Journal backups are part of the guarantee.

Pause the exact default cron job before revocation/emergency stop. Terminate the
identified checker process group following `README.md` if a cycle is in flight.
Retain state files and all uncertain transport rows. A stuck socket holds the shared
lane until a reviewed bridge restart; timeout alone does not release it. Receipt
reconciliation is conservative: phone-JID aliases or unexpected receipt threads
remain unresolved rather than being treated as Dani's exact LID acknowledgement.

## State encryption and downloaded-file contract (pending independent review)

The approved Python must provide the pinned dependency in
`ops/location/requirements.txt` (cryptography 50.0.0). This change does not install
anything on the host. The built-in `.py` sender runs with that same interpreter;
generic executable senders retain direct invocation compatibility. CI uploads
`location-runtime-release.tar`, which contains only the source allowlist and a
disabled config. A downloaded tar may have mode 0644; extracting this reviewed
archive restores its explicit member modes (entry 0700, config 0600, source 0644,
directories 0700). Validate the member allowlist and reject links/traversal before
extracting into a new private review directory. The reviewed installer must explicitly set and verify
`cron-entry.sh` at its installed scripts path to mode 0700, runtime source to 0600
or 0644, external config to 0600 and state directory to 0700. Check these modes
before enabling. The Python sender needs read permission, not an executable bit.
The enabled simulated-download test extracts the actual tar and executes its
restored entry through the guarded wrapper/helper/broker/Python sender offline.

Each new consumer database creates a local adjacent `<database>.key`, mode 0600,
under its owner-only 0700 directory. Every ancestor is opened without following
symlinks; normal home/root ancestor modes are permitted. The immediate parent
must already be user-owned 0700 (new directories are created 0700); no existing
directory is chmodded. Linux directory descriptors anchor file validation and
SQLite setup paths. SQLite may canonicalize descriptor paths, so ancestors must
also be root/user-owned and exclude untrusted renames: writable nonsticky
ancestors are rejected until a user-owned private ancestor protects traversal;
root-owned sticky temporary roots are allowed. Existing DB, key, lock, WAL, SHM and rollback journal must be
single-link regular user-owned 0600 files before SQLite opens. This boundary
excludes malicious same-uid processes, which already have access to the key. Creation is serialized by a local file lock
and exclusive creation; an existing key is never overwritten. Fernet authenticates
both the state marker and exact key-bound reminder payloads before external work.
Coordinates and target title caches are no longer persisted. Fix timestamps,
transitions, episode consumption and delivery status remain for monotonicity and
dedupe. The reminder ciphertext retains the exact original text for reconciliation;
changed canonical titles cannot alter a reserved notice.

Existing plaintext databases deliberately FAIL CLOSED, including disabled cleanup.
There is no automatic migration, new key for an existing database, or reconstruction
of an old reserved notice. Do not delete/rename state to bypass this gate: that can
cause duplicate delivery. A separately reviewed OFFLINE migration must stop all
writers, preserve episodes/claims/keys/statuses and exact original payloads, encrypt
into a fresh database, and explicitly inventory and retire or protect every legacy
database, WAL, snapshot and backup. Until that procedure is reviewed, upgrades with
legacy state are blocked. Existing plaintext backups remain plaintext; this patch
cannot retroactively protect them. Never run VACUUM/export to an unprotected file.

Keep the local key separate from database/WAL backups and release uploads; privately
managed recovery requires both. Losing or replacing the key blocks all operations,
including terminal payload validation. Restore the matching key and complete state
without resetting uncertainty. Release preparation copies an explicit source-only
allowlist and includes no runtime database, WAL, lock or key. No key is committed,
logged, included in artifacts, or uploaded by this workflow.

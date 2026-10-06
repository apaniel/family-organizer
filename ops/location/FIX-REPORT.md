# Scoped correction report

The four verified code blockers in NOTES-REVIEW.md are corrected. That independent
review remains untouched, including its superseded Actions-to-host conclusion.
No commit/push, live installation/config/cron edit, Google task mutation, health
service call, real transport send, app/UI/migration, core/profile or other-repo
change was performed. This report describes code and offline fixtures only.

## Scoped changes

- `notes_runner.py`: current fix freshness remains <=300 seconds. Arrival requires
  explicit outside evidence no older than 900 seconds at evaluation; outside_at is
  separate from lastfix, and ambiguous/repeated samples cannot extend it. First
  inside with nearby:false remains silent. Rule edits invalidate the baseline.
  Wall clock is captured after latest() returns through an injectable clock;
  genuine future timestamps remain rejected, without skew allowance.
- `google_notes.py` / `author_notes.py`: reject both reserved marker prefixes in
  every text field; parse and compare generated complete notes before update and
  after canonical readback. Notes-only protected update and unrelated/trailing
  metadata preservation remain intact.
- Notice text is versioned and useful: bounded title snapshot plus canonical exact
  list/task identifiers. The read-only installed Tasks CLI is a generic broker
  pass-through, with no verified canonical task URL contract. No Google link
  encoding is invented. IDs remain exact and independent of mutable titles;
  the readable snapshot avoids relying on an opaque Google ID alone.
  The exact message is stored only at the first durable claim in the same private
  0600 JSON under a 0700 directory and is reused verbatim after restart, title
  edits and template upgrades. This is a minimal pending delivery obligation,
  not title history or duplicate task storage. It intentionally retains sensitive
  notice text locally; do not log/upload state. No new database, coordinates or
  external encryption-key workflow was added. Legacy claimed rows retain their
  version-1 generic body; old idle rows need fresh outside evidence.
- `test_review.py`: inspected the distinct tests rather than adopting the review's
  mistaken equivalence. `test_timeout_kills_descendant` now establishes readiness
  within a bound before waiting for timeout. The actual parent-failure test,
  `test_wrapper_cli_timeout_cancels_runner_and_sender_descendants`, independently
  establishes sender-descendant readiness, retains its timeout, verifies death
  and still asserts `(1, pending)`. External-stop claim assertions are preserved.
- `install-main.py`, `test_install.py`, RELEASE-NOTES.md and ACTIVATION.md:
  local VPS scripts require no Actions-to-host deployment. Parent review -> PR ->
  `gh pr merge` -> exact clean checked-out main -> supported local install.
  Cloudflare app changes remain main CI only. Existing private bridge approval,
  bot/session identity and receipt journal remain; unchanged plugin needs no
  reinstall. No install or activation was attempted here.

## Installer and readback evidence

Read-only inspection found current -> release-c5060a3 under
`/home/hermes/.hermes/local-customizations/location-runtime`, with existing source
at `ops/location`. The stdlib installer copies the source-only release allowlist,
keeps old versions, atomically switches current, installs the actual default-home
shell entry, creates absent disabled 0600 config/private 0700 directories and
initializes only absent state. Existing config/state is preserved. It refuses a
wrong branch, dirty checkout, mismatched exact commit or unsafe directory/config.
It registers no cron, enables nothing and performs no broker/sender work.

The private-prefix fixture builds a clean temporary main repository, installs,
executes the actual installed disabled shell, repeats install, upgrades and rolls
back source through exact main commits, and checks old-source/config/state
preservation. Git mutations in this test affect only its disposable fixture.
Parent-only install and exact canonical task author/readback commands are in
RELEASE-NOTES.md, retaining the existing test task/list/source key. Live broker
metadata merge, deleted-task behavior, phone precision and recipient receipts
remain separately authorized parent acceptance work; offline ACK is no activation.

The actual private sender is exercised against the approved route snapshot on a
random fixture port with memory journal and mocked socket send. Its production
three-field body and exact unavailable/unknown/acknowledged semantics are retained.
The HTTP regression compares original body bytes and the route's payload hash
across restart/title edit and asserts one mocked send. No production route or
receipt journal was modified. Broker CLI sources run only behind fixture HTTP
and network guards; no real service connection is made.

## Verification

- Existing Hermes venv, `PYTHONDONTWRITEBYTECODE=1 .../venv/bin/python -m unittest
  discover -s ops/location -v`: **74 passed in 51.877 seconds**. Includes five
  added focused cases plus expanded HTTP and readiness assertions.
- Final installer hardening creates every new intermediate directory as 0700;
  its focused install/upgrade/rollback/shell regression passed again in 0.598 s.
- Shell syntax and `git diff --check` passed. No npm install/build, Cloudflare
  build, external service or live activation check ran.
- An earlier run's archive determinism test failed because source was edited
  during its two archive preparations. Both subsequent unchanged-source complete
  runs passed (53.512 s and 51.877 s); no archive failure was ignored.
- Reviewer report SHA-256 before/after:
  `4bede7a3a645b10f695ac013db3c7b9a2234e6a7831f41d44c390aeae9173615`.

All changes remain uncommitted for parent review. Installation commands are
reviewable instructions, not an activation claim.

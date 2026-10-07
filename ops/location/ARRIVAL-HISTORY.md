# Arrival history fix

Correction worktree: `/home/hermes/workspaces/family-organizer-arrival-history`,
base `2d5d52ff6724be5a20c3a93d4dbc8db88c51cef8`. Scope: `ops/location` only.
The P1 NO-GO review at `/home/hermes/.hermes/cache/scratch/arrival-history-review.md`
identified contradictory same-timestamp evidence. This correction records tests,
not self-approval or deployment approval; independent review remains required.

## Change and policy

`where` hid precise inside observations behind newer ambiguous/coarse readings.
The real runtime now shares one `locations dan --from <UTC ISO> --to <UTC ISO>
--tz Europe/Madrid --order asc --limit 200` read across idle arrival rules, within
the existing subprocess budget. Start is the earliest eligible baseline, capped
at two hours. The optional `history` cycle dependency preserves legacy callers;
timed presence and snapshot freshness (300 seconds) retain their old behavior.

Replay sorts by observation time and resolves classifications for each timestamp
before processing arrival. Precise inside and outside at the same timestamp are
contradictory regardless of distinct IDs or absent IDs: neither side changes
phase, lastfix or outside baseline, claims delivery, or consumes the episode.
The real earlier outside anchor survives uncertain groups and can support a
later unambiguous inside sample. Coarse and ambiguous rows do not mask precise
inside evidence at the same timestamp.
Accuracy remains <=100m, existing inside/outside geometry is unchanged, and
outside must precede inside by <=900 seconds measured between observations.
Actual phone kinds `significant`, `trip`, `fence` and synthetic `location` are
accepted; visit arrival/departure records are excluded. Ambiguous/coarse latest
cannot erase arrival. Arrival is event evidence, not current presence; newer
precise exit evidence survives.

Responses require `ok=true`, person `dan`, timezone `Europe/Madrid`, exact integer
count matching rows, count <200 and no explicit truncation/has-more. Empty,
malformed, partial, saturated, future and conflicting duplicate-ID data creates
no claim; broker errors propagate. Identical IDs deduplicate in memory.

Only numeric `history_after`/`history_checked` timestamps are added to the ledger.
No GPS, event IDs, records or history are persisted/logged. Reads overlap the
bounded replay floor rather than `lastfix`, recovering late arrivals older than
an already processed ambiguous fix. Legacy replay requires an unchanged idle,
episode-zero rule with a real `outside_at` within two hours. New/unanchored and
revised rules arm at first evaluation and exclude earlier movement. Revision
resets clear new history fields and outside evidence. Consumed claims remain
terminal. Exact task revalidation and frozen body/key save precede transport;
claimed rules perform no more history reads.

## Tests and evidence

Original hidden-arrival regression remains covered. Correction RED: 21 tests
ran with 7 failing assertions across two test methods before the runtime fix.
The prior-anchor conflict regression tested distinct IDs and no IDs, both input
orders, and lastfix before/after the tied observations (8 cases). It reproduced
false transport calls and phase/baseline changes. GREEN results below cover no
send/no consume/no dispatch and unchanged phase/lastfix/real outside anchor.

Additional correction coverage: both orders without an anchor; both orders with
a later real significant inside after an uncertain group; precise significant
inside plus coarse or ambiguous at the same timestamp in both orders (4 cases).
Existing duplicate-ID conflict rejection and visit_arrival exclusion remain
unchanged. The operational document now travels in the source artifact allowlist;
the archive test's explicit expected file set was updated accordingly.

Focused coverage also includes privacy, completeness, late uploads/multiple
polls, stale/pre-arm baselines, revisions, observation gaps, newer exits, shared
reads, private compatibility, frozen transport, crash recovery and no claimed
rereads. The runner/client/group sender CLI fixture remains entirely synthetic.

All correction checks use `/home/hermes/.hermes/hermes-agent/venv/bin/python -B`,
`PYTHONDONTWRITEBYTECODE=1` and
`TMPDIR=/home/hermes/.hermes/cache/scratch`. Focused commands:
`-m unittest discover -s ops/location -p test_arrival_history.py -v` and
`-m unittest discover -s ops/location -p test_apalas_cli.py -v`.
Canonical discovery is run by
`/home/hermes/.hermes/cache/scratch/arrival-history-correction-tests.py`, which
excludes exactly the installer/commit fixture in `test_install.InstallTests` and
`test_runtime.RuntimeTests.test_actual_hermes_cron_no_agent_empty_dispatch`
(the latter creates a fixture cron job), honoring the no install/commit/cron
constraint. No full unfiltered discovery was executed in this correction pass.
Final results: arrival-history **21/21 PASS** (0.832 seconds); group CLI
**2/2 PASS** (4.675 seconds); canonical **140/140 PASS** (66.571 seconds),
142 discovered minus the two exclusions above. Focused tests are included in
canonical; these counts are not additive. In-memory compilation of all seven
changed/untracked Python files PASS; `git diff --check` PASS. No bytecode or
compiled output was written. Correction logs and runner are in the designated
scratch directory; source identity is recorded in
`/home/hermes/.hermes/cache/scratch/arrival-history-correction-results.md`.

No live calls, Tasks/config/state/cron changes, installation, commits, pushes or
real sends were performed in this correction pass. Only synthetic private
fixtures write disposable state/config under the designated scratch directory.
No additional worktree or `/tmp` scratch was used. Live delivery remains unproven.

## Existing deployment behavior after review

Deployment awaits independent review through the existing release process. Keep production CASA's existing task identity, task list,
source, notes/revision/fingerprint, explicit Apalas destination and `Hola` body
untouched. Preserve configuration, cron and ledger. The next ordinary scheduled
evaluation uses history automatically: no new setting or manual send command.
Never reset a consumed claim or rewrite an outside timestamp. The real 08:57
outside / 09:02 ambiguous lastfix can recover 09:01 inside only while the
unchanged baseline is within two hours and the broker supplies a complete window
below 200 rows. Older/incomplete evidence cannot activate an alert.

No commit, push, PR, installation, live Tasks/config/state/cron mutation or live
send was performed by the implementer. Live delivery remains unproven.

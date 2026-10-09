# Arrival history fix

Correction worktree: `/home/hermes/workspaces/family-organizer-arrival-history`,
base `2d5d52ff6724be5a20c3a93d4dbc8db88c51cef8`. Scope: `ops/location` only.
The P1 NO-GO review at `/home/hermes/.hermes/cache/scratch/arrival-history-review.md`
identified contradictory same-timestamp evidence. This correction records tests,
not self-approval or deployment approval; independent review remains required.

## Change and policy

`where` hid precise inside observations behind newer ambiguous/coarse readings.
The real runtime now shares one `locations dan --from <UTC ISO> --to <UTC ISO>
--tz Europe/Madrid --order asc --limit 5000` read across idle arrival rules, within
the existing subprocess budget. Start is the earliest eligible baseline, capped
at two hours. The initial two-hour scanner uses dedicated
`ARRIVAL_HISTORY_LIMIT = 5000`; timed presence/evidence retains `HISTORY_LIMIT = 200`.
Arrival responses must have matching integer count and row length, with no
truncation or more-results flag; 5000 or more rows fail closed as saturated.
Complete 201-row responses can recover arrival. There is no paging; raw history
remains in memory and GPS rows are never serialized. The optional `history` cycle dependency preserves legacy callers;
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
an already processed ambiguous fix. Legacy replay retains an unchanged idle, episode-zero rule’s real `outside_at`
within two hours. Initial never-claimed arrival recovery may also use the latest
canonical task `updated`, as described below. Revision
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

## Initial history activation recovery

In this worktree, an idle, never-claimed, non-nearby arrival rule with no
`history_checked` may lower its initial floor to the latest canonical task
`updated`. This also covers migration with an existing `history_after` after an
empty history read. Read start and persisted floor use the same calculation.
An existing floor/real anchor is eligible only for the matching fingerprint;
a new or changed rule may use its canonical update without old-rule evidence.
Any canonical update, including a title edit, gives a conservative rule-age
floor. The value must be a timezone-aware string yielding a finite positive
timestamp no later than evaluation time. Missing, malformed, naive and future
values provide no earlier authorization; otherwise unanchored rules use now.
All replay remains bounded to two hours. Source-key datetime hints are ignored.

Recovery requires complete, accurate real outside then inside evidence within
the existing 900-second observation gap. It creates no outside baseline and
performs no nearby auto-change. Checked history never lowers its floor. Claimed,
unknown, sent, failed and stopped delivery behavior and transport revalidation
remain unchanged. No history records or location data are persisted.

Regression tests cover cleared inside-phase anchors, migrated cursors, exactly
one historical Hola, title-update conservatism, pre-update movement, invalid
updates, unchanged checked floors, new rules, rule changes, two-hour bounds and
inside-only evidence. Existing ordering, contradiction, deduplication, privacy
and transport tests remain in the canonical suite. This change is implementation
work only; independent review and parent deployment are still required. No live
broker/task/state/config/cron changes, installation, sends, commits or pushes.

Activation validation used the approved venv with bytecode disabled and only
`/home/hermes/.hermes/cache/scratch` for temporary fixtures/logs. TDD RED:
25 focused tests, 3 failing recovery assertions before the runtime change.
Final focused suite: 26/26 PASS (1.184s), including a genuine empty-read
migration. Canonical suite: 147 discovered (original 142 plus 5 new methods),
145/145 PASS (66.875s), with exactly the existing installer and fixture-cron
exclusions above. The final empty-read test refinement was rerun in the focused
suite. `git diff --check` passed. Logs: `history-activation-red.log`,
`history-activation-green.log`, `history-activation-canonical.log`; canonical
runner: `history-activation-tests.py`, all in designated scratch.

## Final-review blocker correction

This pass changes only this document, `notes_runner.py` and
`test_arrival_history.py` in the history-activation worktree. A mismatched
fingerprint ignores the old rule's `history_checked` during read-start
calculation, matching the later per-item reset. Initial canonical recovery
captures the validated numeric `updated` in memory and requires the same valid
timestamp from the existing final canonical GET before freezing transport.
Identity/open-status/identical-rule checks remain intact. A title-only update
also stops this unclaimed recovery, even when the rule fingerprint matches;
missing, invalid, naive or future updates fail closed. The stopped episode is
not automatically rearmed.

No additional ledger field is needed: the initial recovery claim remains
provisional until final GET validation. A GET exception or process death before
validation leaves the previously saved idle ledger; it cannot persist an
unfenced retry. The normal frozen claim is still saved before transport.
Already frozen unknown claims retain their body/key, route and existing GET
behavior, without an update fence or history reread. No GPS or broad metadata
is persisted or logged.

TDD RED: 29 focused tests, six failing assertions (five final-GET update cases
and one old-rule checked read-start). GREEN adds a GET-failure regression:
30/30 PASS. New methods are
`test_final_get_revalidates_initial_recovery_update`,
`test_changed_rule_ignores_old_checked_history_at_read_start`,
`test_frozen_recovery_claim_keeps_body_key_despite_update_change`, and
`test_recovery_get_crash_keeps_claim_provisional`.
The final-GET method also verifies the existing changed-fingerprint guard.
The main canonical recovery test still recovers, ACKs one episode and performs
no subsequent history read or send.

Validation uses the approved venv with `-B`, `PYTHONDONTWRITEBYTECODE=1` and
`TMPDIR=/home/hermes/.hermes/cache/scratch`. Focused command:
`-m unittest discover -s ops/location -p test_arrival_history.py -v`.
Canonical discovery runner: designated scratch `history-blockers-tests.py`;
151 tests discovered, 150 selected; **150/150 PASS** (71.440s). It includes
`test_install.InstallTests.test_clean_main_private_install_preserves_state_and_executes_disabled_entry`
(disposable offline installer/Git fixtures only). Exactly one test is excluded:
`test_runtime.RuntimeTests.test_actual_hermes_cron_no_agent_empty_dispatch`,
which creates a fixture cron job, respecting the no-cron instruction.
This is not an unfiltered full-suite claim. Logs in designated scratch:
`history-blockers-red.log`, `history-blockers-green.log`,
`history-blockers-canonical.log`. No live calls, installation, state/task/config/
cron changes, commits, pushes or real sends; no `/tmp` scratch. These results
are test evidence, not self-approval or deployment approval.

Final in-memory compilation of runtime/tests and `git diff --check` PASS.
Worktree status remains exactly the same three modified files.

## Dedicated arrival cap validation

History-cap worktree validation: TDD red had two expected failures (complete
201-row recovery and default request limit); green history **31/31 PASS**.
Focused actual CLI/group tests **4/4 PASS**. Approved-venv canonical suite
**151/151 PASS** (68.680s), from 152 discovered, excluding only
`test_runtime.RuntimeTests.test_actual_hermes_cron_no_agent_empty_dispatch`
under the no-cron constraint. Disposable offline installer fixture included.
Saturation fixture is now 5000 rows; evidence request still asserts 200.
Logs: `/home/hermes/.hermes/cache/scratch/history-cap-{red,green,cli,canonical}.log`.
All runs used approved venv, bytecode disabled and designated scratch, no `/tmp`.
No live broker calls, production installation/state/task/send operations, commits
or pushes. Parent review/merge/install and real-data recovery remain pending;
this patch does not establish delivery of the original hello or self-approval.

## Visit contract extension

The candidate described in [RELEASE-NOTES.md](RELEASE-NOTES.md#observed-ios-visits-uncommitted-implementation-candidate)
supersedes the visit-exclusion statements above. It adds true-time arrival
observations and chronological departure phases without changing timed presence,
phone geometry, the bounded scanner, immutable transport or existing release gates.
Full canonical fixture execution is permitted for this pass, including isolated
installer/Git and cron fixtures; historical exclusions above describe past runs.


## Independent-review blocker fixes (uncommitted)

An authorized precise inside visit establishes a historical arrival occurrence
for either nearby policy. Later phone movement, departure or arrival elsewhere
updates latest phase without retroactively canceling that occurrence. Saved
newer outside observations retain their phase when a late arrival is read alone.
Tied contradictory observations remain uncertain. Departures create neither
arrivals nor exterior GPS anchors. Floors, two-hour bounds, final canonical GET
and immutable one-shot transport remain required; arrival is not current presence.

The shared arrival history is validated before any ledger save or partial claim.
Provider errors, incomplete/count/saturated responses and invalid envelope/location
schema raise an operational error; the quiet CLI exits nonzero with bounded text
and no GPS. Prior state bytes survive, allowing the next complete read to recover.
Valid empty/no-eligible history is successful without delivery. Invalid visit event
times remain ineligible and legitimate non-location metadata remains ignored.

This correction does not approve or activate the candidate. See scratch
`location-visit-fixes.md` for exact RED/GREEN commands and complete outputs.

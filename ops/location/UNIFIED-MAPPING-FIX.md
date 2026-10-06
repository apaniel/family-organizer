# Stationary broker mapping fix

Scope: only stationary inference in `notes_runner.py`, its private offline fixtures
in `test_unified.py`, and implementation documentation. Existing uncommitted unified
changes were preserved. Arrival v1's fresh predicate and tests were not edited.

## Root cause and supplied contract

The prior implementation required invented broker fields: `last_upload`, device
`id`, `location_supported:true`, location `device_id`, and `truncated:false`.
Consequently the supplied successful responses could never support inference.
It also requested only one hour before the latest fix, limit 100, and counted
three distinct timestamps even when two were from the same burst.

Parent supplied actual responses, without any endpoint call in this work:

- Persons: `ok:true`, `now`, `persons`, with Dan's `last_location_ts`,
  `last_upload_at`, and devices containing `label`, `created_at`, `last_seen`,
  `revoked`, `model`, `os`, `app_version`, `tz`.
- Locations: `ok:true`, `person:'dan'`, `tz`, `count:191`, `locations`.
  Neither device IDs nor a truncation flag is returned.
- Latest: `ok:true`, `person:'dan'`, `location` containing `id`, `ts`,
  `received_at`, `lat`, `lon`, `h_acc`, `motion:'stationary'`,
  `kind:'significant'`. Supplied event and receipt times were
  2026-10-06T10:43:23.611Z and 2026-10-06T10:43:24.492Z; upload and
  device contact were 2026-10-06T10:43:36.981Z.

Fixtures retain these actual key shapes with synthetic positions, timestamps and
IDs. The 191-row completeness probe uses synthetic repeated rows; it does not
claim to reconstruct or validate the parent's actual 191 locations.

## Mapping and bounded policy

Validate successful persons envelope before interpreting Dan's unique entry.
Require `last_location_ts` equal to latest event time, `last_upload_at` at/after
latest receipt, and exactly one explicitly unrevoked device with a nonempty label.
Require recent `last_seen` at/after the fix. Extra revoked devices are allowed.
Multiple active devices yield uncertain because contact attribution is ambiguous.
Missing IDs and support flags are accepted. This is person-scoped contact evidence;
there is no cryptographic or other broker-provided binding of fix to device.

Parent policy choice remains before activation: maximum fix age two hours,
contact/upload age fifteen minutes, accuracy at most 100m, full accuracy circle
inside radius, and three stationary samples separated by at least five minutes
spanning at least thirty minutes and ending at the latest fix. These are bounded
heuristic defaults, not task expiry; existing five-minute cadence is unchanged.
The local clock is checked after latest and again after evidence reads, including
contact age; remote `persons.now` is not used as the evaluation clock.
At 13:00, last contact 12:43 is seventeen minutes old: unknown/stale, even when
the baseline otherwise qualifies. This fix makes no promise of current presence.

History request: latest minus two hours through evaluation time, ascending,
limit 200. For latest 12:43 this includes legitimate 11:28, 11:58 and 12:43
samples; a one-hour lookback would include only the latter two. Exact integer
`count == len(locations) < 200` is necessary. Missing `has_more`/`truncated` is
accepted; either explicit true refuses inference. Counts 191 and 199 can qualify;
200 and 201 refuse conservatively, as does a count mismatch. No raw history persists.

Repeated event IDs count once, conflicting repeats refuse, identical timestamps
collapse, and timestamps less than five minutes apart cannot supply separate
baseline samples. Same home coordinates at separated times remain legitimate.
Movement/exit at or after latest event refuses; older trips uploaded later do not
supersede latest by receipt time. Invalid geometry or event/receipt ordering refuses.
Insufficient baseline/contact returns stale; malformed/ambiguous evidence returns
uncertain; both notices truthfully say presence could not be confirmed. Provider
failures still propagate. Inferred notice retains “parece que sigues” wording.

## Offline validation

Full current location suite passed: **102 tests**, the prior 96 plus six new
regression methods (unified suite now 17). Command:
`/usr/bin/python3 -m unittest discover -s ops/location -p 'test_*.py'`.
`git diff --check` passed. Six new regression methods cover actual shapes,
local-clock/contact expiry, person/device consistency, history completeness,
event/burst deduplication, and CLI request limit. Existing stationary regression
was corrected to real keys, including movement and explicit truncation refusal.
The initial default Python run could not import `cryptography`; system Python has
the dependency already, so validation uses `/usr/bin/python3` without installing.

No live broker calls, core/profile reads, real task reads/writes, sends, installation,
cron changes, commit or push. Tests mock external boundaries and use temporary
private state. Generic config, JSON ledger, delivery deduplication and historical
consumed rice evidence remain unchanged. Next: independent parent code review,
then parent-controlled PR/merge/installer sequence; no activation occurred here.

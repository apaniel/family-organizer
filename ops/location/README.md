# Location consumer

This is a deterministic, bounded consumer, with no LLM. Production is inactive.
`config.json` has both `enabled:false` and `deliver:false`; running
`python3 ops/location/scheduled_cycle.py` returns `{"skipped":"disabled"}` without
reading profiles, API metadata, or the location broker, or creating state. If a configured state file already exists, disabled invocations
perform local retention cleanup only.

## Offline checks

```
python3 -m unittest discover -s ops/location -v
python3 ops/location/demo.py
python3 ops/location/scheduled_cycle.py
```

The demo uses mock broker, canonical metadata reader and sender, and temporary
SQLite. It enters from outside, sends one mock private notice, dedupes the next
inside fix, and leaves the canonical task open. Nothing reaches WhatsApp or Google.
CI runs the Python regression suite with the dashboard tests/build. No runtime
installation or service restart belongs to these scripts.

## Runtime contract and activation gates

Only after independent review, a reviewed PR merge to main and existing deployment
Actions may apply `0011_location_adjuncts.sql` and deploy the Worker/UI. The existing
familia helper provides narrowly scoped family API access; the consumer imports
`../familia/family_mission.py` and never reads/copies its credentials itself. Use the
existing family-profile Python environment (which already supplies python-dotenv).
No Cloudflare token is accepted by these scripts.

`runner.py --state ABSOLUTE_PATH` is a read-only preview against the scoped family
API and fixed `/opt/hermes-health/client.py where dan|wife --tz IANA_ZONE` broker.
Do not run it against production during implementation. Preview does not consume
arrival episodes or send/publish derived attention. It records only scheduler
rate-limit timestamps in the chosen SQLite file. Missing or expired consent skips
broker and canonical record reads entirely. No health/history route is used.

Reviewed activation must establish all of the following:

1. The broker's existing Unix socket authorizes the consumer's runtime identity.
   No new raw-location Worker ingestion endpoint or health token is introduced.
2. Each enabled rule has explicit personal confirmation in the UI. A service cannot
   create or enable rules. Rules are private to their verified person's email;
   notification text always goes to Dani's private `238615548420255@lid`, including
   Cris rules only if Cris explicitly confirms that destination. No group destination
   is configurable. Currently Cris has no uploaded location, so she is unavailable.
3. A reviewed **idempotent sender executable** exists at an absolute path. Configure
   that path in `sender`, then opt into `deliver:true`. The sender reads one JSON
   object from stdin: `{destination,message,idempotency_key}`. It must allow only
   Dani's private destination, durably dedupe the key, return zero only when delivery
   is acknowledged/already acknowledged, and keep all payloads out of debug logs.
   This repo has no compatible approved WhatsApp sender, so its provisioning is an
   explicit remaining activation gate. The executable adapter contract and offline
   mock are tested; no live sender or live delivery is claimed.
4. The approved scheduler calls `scheduled_cycle.py --config REVIEWED_CONFIG` as a
   one-shot invocation. Configure `enabled:true` only at that approved activation.
   Default interval is 300s; allowed range 300–3600s; a durable scheduler guard skips
   duplicate/early invocations. The direct runner additionally guards at 60s. There
   is no new background polling loop. At most one latest-fix call per person per
   invocation, two total. Conflicting per-person timezones fail closed.
5. The reviewed identity can POST derived, short-lived states to the existing scoped
   family service API `/api/family/location-attention`. Browser identities cannot
   ingest states; arbitrary coordinate/health fields are rejected. This uses existing
   auth, with no broker credential or whole health stream exposed in the Worker.

Deliver mode writes only derived attention through that endpoint, and sends through
that reviewed executable. It never calls task/calendar mutation APIs. No such writes
or sends occurred during implementation. Disabling a rule is checked on each new
cycle; API failure never falls back to stale cached consent. A change concurrent
with a cycle can have up to that single cycle's in-flight latency, so stop scheduled
invocations first for immediate operational revocation.

## Decisions and retention

Fixes require person, timezone, version=1, latitude/longitude, accuracy, recorded_at
and received_at. The broker adapter validates the actual response `ok/person` and
maps `location.ts/received_at/lat/lon/h_acc`; it discards last_visit and other fields.
No fabricated device data. Ages must be <300s, accuracy <=100m, timestamps ordered,
no future timestamps, and no out-of-order fix relative to durable state.

Entry requires `distance + accuracy <= radius`; exit requires
`distance - accuracy >= radius + max(50m,25% radius)`. The intervening band retains
state. Arrival requires a recent observed outside-to-inside transition: first inside
is never arrival. Nearby may show on the first reliable inside fix. Changing place
or rule revision, or a stale outside baseline, resets transition confidence. One-shot
keys survive restarts and edits. Recurring rules emit only for a new visit episode.
Expiry is inclusive through the rule's local calendar day in its place timezone.
Only fresh canonical open/waiting targets are eligible; Google task list+task ID is
the exact identity. Google moves/deletions are not auto-remapped or duplicated.

SQLite keeps one minimal last fix per person (purged after five minutes), one latest
transition per rule, compact episode keys, delivery acknowledgements and minimal
canonical eligibility/title cache (60s). No location trail. Sent/cancelled/failed
message rows expire after 30 days; episode dedupe keys remain. At most ten pending
notices are processed per invocation, at most three sender attempts per notice,
with 60/120s backoff and five-minute delivery expiry. Sender-side durable idempotency
is mandatory for a crash between delivery and local acknowledgement. SQLite file
mode is 0600; use a private state directory and retain its backups to preserve dedupe.

Derived cards contain only rule ID, person, state and timestamps, not fixes or
coordinates. State freshness ends at the fix's original five-minute deadline, and
rule/place revisions suppress stale states after edits. No proximity operation ever
marks a task complete.

Leave-on-time, traffic ETA, route optimization and combined-notification batching
are not implemented in this first vertical. No route adapter has been established;
there are no invented traffic durations or automatic departure urgency.

## Review corrections and operational stop

Attempts commit individually before external work. Claims have a 30-second lease;
expired claims can recover only after durable 60/120/240-second next-attempt deadlines,
with three attempts total, including interrupted attempts. Outcome updates require
the claim token; a late old consumer cannot acknowledge a replacement claim. A
sender must enforce the unchanged episode idempotency key across recovery.

Wrapper and runner share an absolute monotonic 165-second deadline. Each broker,
API and sender child gets at most the remaining time (50/45/20-second caps).
No new send is claimed with less than 22 seconds remaining; ten is an upper bound,
not a promise to exhaust the batch. Subprocesses start in process groups; timeout
and TERM/INT cleanup terminate their descendants. API access runs in a bounded
child importing the existing helper; no helper/profile changes are required.

Every invocation with an existing state file purges expired fix rows and 60-second target-cache rows
before metadata or throttle returns, without additional external reads. SQLite
secure_delete clears deleted page content and cleanup attempts WAL truncation;
concurrent readers can defer WAL truncation. Backups, filesystem snapshots and a
stopped process's state file still require private operational retention management.
Cycle/scheduler guard timestamps contain no titles/coordinates and remain durable.
Retention is enforced at invocation time, not by an independent five-minute timer.

Consent remains a fresh once-per-cycle snapshot. Revocation during broker/canonical
work or an in-flight send can race delivery. To stop operationally: disable future
scheduler invocations, identify the exact wrapper/runner PID and its process group
(e.g. `ps -eo pid,ppid,pgid,args`), send TERM to that wrapper or runner, and verify
that its runner, sender, API/broker children and their descendants have exited.
If a process fails to exit, terminate its identified process group with KILL and
verify descendants separately. Do not use broad process-name killing. Preserve
SQLite state: interrupted claims consume attempts and must not be reset. A message
already acknowledged by the transport cannot be recalled by this procedure.

Calendar API and ICS identities differ: fallback does not preserve adjunct links;
unmatched links fail closed. Runtime Google Calendar fetch covers only Madrid's
today and tomorrow. Links outside that window are unavailable until fetched.
Explicit email aliases map ownership; unknown newly authorized emails fail closed.
Alias ownership still needs operational confirmation before activation.

Revision ordering compares rule revision first; place revisions compare only under
an unchanged rule revision, since relinking can select another place's counter.
Stale snapshots defer newer notices and cannot downgrade or prune newer transition
evidence. Compact retired transitions retain only revision/inside/episode/time;
metadata absence is not a versioned deletion tombstone. A later outside transition
wins over a previously computed arrival candidate during publication.

Missing rule/place metadata defers pending notices until delivery expiry; known
disabled/unconfirmed rule revisions cancel eligible older pending notices immediately.
A missing oldest notice can conservatively hold later delivery work until the next
fresh snapshot or expiry. Neither absence nor deferral authorizes an external send.

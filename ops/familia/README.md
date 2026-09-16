# Family Mission Control operations

The existing Cloudflare Worker serves / (today), /family-calendar, and /week. The previous application and InstantDB/PIN flows are retired. Only the three new views remain.

D1 binding FAMILY_DB uses migrations/0001_family_mission.sql. Record mutations and their audit entries are atomic batches; revisions reject stale updates; source_key is unique for ingestion idempotency. Audit rows retain prior contents when a record is deleted. Cloudflare D1 recovery is separate from the VPS disk. Export D1 before schema changes.

/api/family/records and /api/family/calendar require a verified approved Cloudflare email identity or the existing Hermes service secret, behind Cloudflare Access. API requests are not publicly accessible. No credentials belong in this repository.

Install family_mission.py under the familia tools directory, and SKILL.md under familia/skills/family-mission-control. Python uses the existing Hermes virtual environment. Existing FAMILY_DASHBOARD_CF_CLIENT_ID, FAMILY_DASHBOARD_CF_CLIENT_SECRET, and FAMILY_DASHBOARD_SYNC_SECRET are read privately from familia/.env. The client refuses other profiles and redirects.

install_jobs.py uses Hermes's job API to idempotently add family-only daily summaries at 08:00 and 20:00 Europe/Madrid and email ingestion at 07:00, 13:00, 19:00. Summaries deliver to the existing parents group; ingestion is local-only. It never changes pre-existing jobs. The scheduler's normal profile discovery loads the jobs; no gateway restart is necessary. Pause those named jobs using Hermes cron tools to stop automation.

Google Calendar is currently a read-only private ICS source. Events created in the planner stay in D1; they are NOT written to Google Calendar. The familia broker at /opt/hermes-calendar/client.py can now read/create Google events; dashboard form events still remain local. Family Gmail may require reauthorization independently; ingestion must fail closed.

Verification: npm test -- test/family-mission; production Cloudflare build; authenticated live create/read/update/stale-revision/dedup/delete check using a temporary record, then cleanup. No automatic WhatsApp test messages.

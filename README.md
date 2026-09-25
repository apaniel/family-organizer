# Apalas — Family Mission Control

A small family planner: today/tomorrow tasks, calendar, and weekly adult/kids meals.

- Next.js + OpenNext on Cloudflare Workers, https://apalas.apaniel.dev.
- Cloudflare Access email login only, approved addresses apavicio@gmail.com and dapamar90@gmail.com.
- Each protected page and data request verifies the signed Access identity. No PIN, device activation, profile selection, or InstantDB authentication.
- Persistent shared records in D1 FAMILY_DB. Optimistic revisions, unique source keys and atomic audit records protect updates.
- Google family calendar prefers the Google Calendar API so event labels, event colors and the calendar's default color are preserved. The private losapalas feed remains a read-only fallback. Hermes can read/create Google events using the separate VPS calendar broker. Local dashboard events are not automatically pushed to Google.
- Hermes's service access is retained for background family planning.

`npm run dev`, `npm test`, `npm run build:cloudflare`, `npm run deploy:cloudflare`.

CI (`.github/workflows/ci.yml`) typechecks, tests and builds every pull request. Pushes to `main` deploy through `.github/workflows/deploy.yml`, which applies new D1 migrations first; it needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

The previous organizer, mobile app, and PIN code were retired. Git history preserves their source. Existing new-planner records are unchanged.


## Family artifacts
Private self-contained HTML artifacts are stored in D1 family_artifacts and published through /api/family/artifacts. The existing family service credential or verified approved email is required for every request. Responses use CSP sandbox with scripts but without same-origin privileges, network connections, forms or frame embedding; interactions are transient. Content-addressed immutable snapshots deduplicate retries. Familia uses tools/family_artifacts.py and the family-artifacts skill; no broad Cloudflare credential is needed. Apply migrations/0002_family_artifacts.sql before deployment.

## Daily digest and receipt documents
The Today view includes deliveries, receipts and existing calendar events. Authenticated `/api/family/digest` supports dated reads, source-key-idempotent creates and revision-checked updates. `/api/family/digest?pending=1` lists receipts awaiting a future finance connector. Finenance now stores original receipts and retries conservative matching after bank sync. The family API client writes receipt IDs/statuses into the digest and refreshes them when reconciling. Allianz has separate upload and guarded claim-submission APIs. Original PDF/JPEG/PNG files (5 MB maximum) are stored in the private `family-mission-documents` R2 bucket; `/api/family/documents/:id` enforces existing email/service authentication. D1 migration 0003 holds digest records and document metadata. Credentials are never included in records.

### Completion digest

Authenticated `GET /api/family/completion-digest?date=YYYY-MM-DD` returns `{date, explicit, inferred}` for that Europe/Madrid calendar day (including DST). Each entry contains the stable record `id`, snapshot `title` and `owner`, UTC `completedAt`, and `channel`. Entries represent completion transitions, so reopening and completing a task again produces another entry for the same record. Creation in done status includes recurring occurrences; open creation, repeated done updates, and deletion do not add completions. Later edits or deletion do not alter past completion snapshots. Historical audits with unknown provenance are grouped as inferred with channel other.

Apply `migrations/0006_completion_provenance.sql` before running the updated records API. `POST /api/family/records` derives provenance from its existing authentication: verified email/browser requests are explicit/dashboard. Service callers may send `x-family-completion-mode: explicit|inferred` and `x-family-completion-channel: whatsapp|telegram|email|other`. Both headers must be valid; otherwise provenance defaults to inferred/other. Payload provenance is ignored. The migration preserves historical audit rows and adds nullable constrained provenance columns.

## Binary tasks and legacy checklist migration

A task is one action, with open/waiting/done status (existing archive behavior is retained). Unfinished actions and unanswered questions each belong in a separate open task assigned to the responsible person. The dashboard has no task checklist editor or partial-completion choices. Normal record writes reject nonempty task checklists with Spanish HTTP 400; legacy records remain readable. Migrate legacy lists before editing those tasks in the dashboard. Non-task fields and recurring occurrence behavior are retained.

Data operations remain in the existing external family helper; repository scripts are build/deployment checks. No migration runs on startup or deployment. The helper can use this service-only contract without direct D1 access:

`POST /api/family/records/flatten` with the existing `x-calendar-sync-secret` credential supplied from the helper's secret environment (never source code). Email/browser authentication returns 403; unauthenticated requests return 401. JSON body:

```json
{"id":"parent-record-id","revision":3,"localToday":"2026-09-25","confirm":false}
```

All four fields are required. `revision` is the expected positive integer revision; `localToday` must be a real `YYYY-MM-DD` local calendar date, supplied by the caller. `confirm:false` previews without any writes. Response: `{dryRun, record, children, counts:{created,checked,moved}}`. Preview `record` retains the current revision; execution increments it and returns persisted timestamps. Each unchecked item becomes an independent open, nonrecurring task with an empty checklist, the same category/source/audience, and the parent's owner unless its text starts with exact `Dani`, `Cris`, `Saida`, or `Familia` followed by whitespace or a punctuation separator (`: , . ; - – —`). Only that prefix is removed. Titles are trimmed/bounded to 200 characters. Children retain the parent date unless the parent is done, when they use `localToday`.

The parent retains its status and other fields, clears its checklist, and appends notes naming checked historical items and every pending item moved, including child IDs. Child notes reference the original title and ID. Notes overflow is rejected rather than truncated. Read-only, non-task and protected `approval:`, `capability:`, `chat-conversation:`, `chat-thread:`, `system:` and `internal:` records cannot be flattened. Checked-only lists migrate to notes with zero children; empty lists return 400.

For an operational report, list records with the existing authenticated `GET /api/family/records`, select tasks with nonempty checklists, and preview each parent separately. The generic list keeps its existing 3,000-record limit: a result at that limit must be treated as potentially incomplete. Verify every response's HTTP status, `dryRun:true`, parent ID/revision, counts, child owners/dates, and empty proposed checklists; retain the preview report. Never execute unless the operator supplies an explicit `--confirm` flag to the external helper. On confirmation send the same parent revision and local date with `confirm:true`; verify `dryRun:false`, revision increment, stable child IDs/source keys and all counts against the preview. Stop on any mismatch or failed response; do not silently retry with a newer revision.

Execution uses one D1 batch for the guarded parent update, a `flatten` audit with complete before/after snapshots, all child inserts, and each child's `create` audit. Migration does not claim a new completion. SQL constraints abort the batch on a stale/missing parent; no cross-statement `changes()` state is assumed. Any insert/audit failure rolls back the batch. IDs derive from SHA-256 of `flatten:<parent id>:<revision>:<original item index>`; source keys use that same deterministic string. Confirmed retries and stale revisions return 409 without duplicates. Validation failures return 400; unexpected storage errors return a sanitized Spanish response. No new database migration is required beyond the existing schema.

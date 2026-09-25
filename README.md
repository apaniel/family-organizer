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

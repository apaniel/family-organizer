# Apalas — Family Mission Control

A small family planner: today/tomorrow tasks, calendar, and weekly adult/kids meals.

- Next.js + OpenNext on Cloudflare Workers, https://apalas.apaniel.dev.
- Cloudflare Access email login only, approved addresses apavicio@gmail.com and dapamar90@gmail.com.
- Each protected page and data request verifies the signed Access identity. No PIN, device activation, profile selection, or InstantDB authentication.
- Persistent shared records in D1 FAMILY_DB. Optimistic revisions, unique source keys and atomic audit records protect updates.
- Google family calendar is read from the private losapalas feed. Hermes can read/create Google events using the separate VPS calendar broker. Local dashboard events are not automatically pushed to Google.
- Hermes's service access is retained for background family planning.

`npm run dev`, `npm test`, `npm run build:cloudflare`, `npm run deploy:cloudflare`.

The previous organizer, mobile app, and PIN code were retired. Git history preserves their source. Existing new-planner records are unchanged.


## Family artifacts
Private self-contained HTML artifacts are stored in D1 family_artifacts and published through /api/family/artifacts. The existing family service credential or verified approved email is required for every request. Responses use CSP sandbox with scripts but without same-origin privileges, network connections, forms or frame embedding; interactions are transient. Content-addressed immutable snapshots deduplicate retries. Familia uses tools/family_artifacts.py and the family-artifacts skill; no broad Cloudflare credential is needed. Apply migrations/0002_family_artifacts.sql before deployment.

# Family Google Calendar

Production: https://apalas.apaniel.dev (existing Cloudflare Access + device/parent protection).
Source: the private iCal subscription for losapalas@gmail.com. One-way, read-only; edit events in Google Calendar.
Cloudflare runs the authenticated importer every five minutes, even with no browser or Hermes session open.
Google may cache its subscription feed, so changes are not guaranteed to appear instantly.

Set GOOGLE_CALENDAR_ICS_URL as a Cloudflare Worker secret. Never commit or log the private URL.
Keep existing CALENDAR_SYNC_CRON_SECRET, InstantDB, device and storage secrets in place.
The legacy Apple run endpoint delegates to Google when the Google secret is configured.
Existing Apple and manually created events are retained. Google deletions soft-cancel only Google-imported records.
A failed download or parse does not reconcile/delete events. Repeated imports use stable IDs, including recurring exceptions.

Build with NEXT_PUBLIC_INSTANT_APP_ID set to the existing production app ID and npm run build:cloudflare.
Deploy with npm run deploy:cloudflare. The configuration preserves the existing R2 cache, domain and secrets.
Do not create a new InstantDB app or overwrite the family data. Secrets and feed authorization require no Hermes restart.

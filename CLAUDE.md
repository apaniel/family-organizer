# Project guidance

Build a functional, clean Spanish family dashboard.
Do not test the UI unless explicitly instructed by the user. Validate API behavior, auth, date logic and builds instead.

See README.md for the current architecture. The old organizer is retired. Do not reintroduce InstantDB, PIN or device activation. Email access is verified using Cloudflare JWT signatures, the exact application audience, expiration, and the explicit allowed email list. Service credentials are only for the family API and are never exposed to browser code. Preserve D1 records and audit history.

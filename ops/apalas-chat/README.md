# Apalas chat

Cloudflare `/api/family/chat` verifies the existing Access JWT signature, issuer, audience, expiry and explicit parent email list. Dani's two aliases map to Dani; Cris's two aliases map to Cris. Sync/service credentials cannot authenticate this route. POST additionally requires same origin; client-supplied identity/session/profile fields are discarded.

The Worker uses APALAS_CHAT_SECRET to call a restricted tunnel origin on VPS loopback port 9123. The bridge fixes the upstream to `/p/familia/v1/runs`, derives separate stable sessions for each parent, stores message history in `/var/lib/apalas-chat/chat.sqlite`, and exposes final output only. Neither gateway credentials nor upstream run IDs are returned to the browser. Native run polling avoids long-lived Worker requests. UUID idempotency keys prevent accidental repeated submissions; each person can have one active request and at most six new requests per minute.

Service: `/etc/systemd/system/apalas-chat.service`; code: `/opt/apalas-chat/bridge.py`; root-only service environment: `/etc/apalas-chat.env`. The service runs as hermes with writable access restricted to its SQLite directory. Native gateway API keys are profile-scoped; API_SERVER listens on loopback only. The bridge is intentionally not a general proxy. Persist the SQLite directory in VPS backups.

No automatic retry of failed/interrupted agent actions. Failed requests show a short retry message. Unresolved upstream approvals may keep a request pending; this first version does not provide approval buttons or attachments. Other profiles and their sessions are not exposed. Conversation separation is routing/history separation, not Unix sandbox isolation: Familia retains the family tools and shared family memory.

## Outbound queue worker and D1 usage

The current durable chat consumer is `worker.py`, run by the Hermes user's
`apalas-chat-worker.service`. The loopback `bridge.py` service above is separate.
On the VPS the consumer runs from
`/home/hermes/workspaces/family-calendar-days/ops/apalas-chat/`.

Queue reads back off from 2 to 15 seconds when idle and return to 2 seconds while
messages are active. A newly submitted message can therefore take up to 15 seconds
to be picked up. Errors back off to 60 seconds; success resets the error delay.
No messages are discarded, and failed agent actions are not automatically retried.
This reduces an idle day's queue requests from about 86,400 to fewer than 6,000,
without adding a paid service or changing D1 data.

Run `python -m unittest discover -s ops/apalas-chat -p 'test_*.py'` in the Hermes
Python environment. Deploy `worker.py` and `polling.py` together and restart only
`apalas-chat-worker.service`; retain the previous files for rollback.

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

The consumer holds an authenticated WebSocket to `/api/family/chat/socket?worker=1`.
Submissions wake it immediately. Active Hermes runs are checked through loopback;
Cloudflare queue reads occur only on connection/reconnection, a submission event,
or a five-minute recovery interval (288 idle reads/day). Errors wait five minutes.
The Python environment requires `websockets>=15,<16`.

Open browser chats subscribe to conversation-scoped invalidations using the same
socket endpoint. Identity comes from the verified Access JWT or the existing
trusted app service secret; no credentials or message content travel in events.
Sockets use Durable Object hibernation. Browser tabs disconnect when hidden,
reconcile on reconnect, and retain a five-minute recovery check. Expired sessions
cannot receive further events. FineNance proxies upgrades through its private
service binding.

Deploy the website first (including the SQLite-backed ChatNotifications Durable
Object migration), then the consumer and FineNance client. No D1 schema migration
or stored-message deletion is required. If rolling back the consumer, restore the
15-second-backoff version, never the original one-second polling loop.

Run `python -m unittest discover -s ops/apalas-chat -p 'test_*.py'` in the Hermes
Python environment. Deploy `worker.py` and `polling.py` together and restart only
`apalas-chat-worker.service`; retain the previous files for rollback.

Production service files must match `main`. Review and merge a PR before
deploying the chat consumer; do not deploy unmerged feature-branch files.
The VPS consumer is separate from the Cloudflare website, so verify its running
files against the merged commit as part of release verification.

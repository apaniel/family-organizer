`private_delivery.approved.mjs` is an exact test-only snapshot of the existing
approved `bridge/private_delivery.js` from apaniel/hermes-family-whatsapp,
SHA-256 `395e5d67fc2ce5bd7c05af15bade2b725c643257e706f2fb782ff349efe755ce`.
The production runtime uses its existing `/family/private-notice` route on 3000;
these files are excluded from the runtime artifact. `private_route.mjs` invokes
that actual handler on a random loopback test port, with a memory-only transport
journal and mocked socket send. No SQLite instance or WhatsApp connection is
created. Test-only receipt endpoints do not claim real delivery.

The two `*_client.approved.py` files are exact snapshots of the installed read-only
`/opt/hermes-tasks/client.py` and `/opt/hermes-health/client.py` CLI sources. The
integration test uses the actual installed clients when present and these exact
snapshots on CI; the same boundary guard blocks every non-fixture connection.
No broker server, health dataset or credential is bundled.

Client snapshot SHA-256 values:

- tasks: `8707f08362f475b284a0c3f069c33366339d66784ea88d2357b5bb7ce76e96cd`
- location: `77ed03eded527ac1ca86d47721e80bf1f0580949004e89306e68ac592dc19eeb`

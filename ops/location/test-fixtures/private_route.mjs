// Offline HTTP harness around the approved route. The in-memory journal is test-only.
import http from 'node:http';
import { installPrivateDelivery, validate } from './private_delivery.approved.mjs';
const requests = [];
const records = new Map();
let sends = 0;
const journal = {
  reserve(body) {
    const { key, hash } = validate(body);
    const row = records.get(key);
    if (row) {
      if (row.hash !== hash) throw Error('Conflict');
      return { ...row, fresh: false };
    }
    const fresh = { hash, id: `offline-${records.size + 1}`, state: 'uncertain' };
    records.set(key, fresh);
    return { ...fresh, fresh: true };
  },
  get(key) { return records.get(key); }
};
let handler;
installPrivateDelivery({ post(route, callback) {
  if (route !== '/family/private-notice') throw Error('Unexpected route');
  handler = callback;
}}, { journal, botMode: () => true, connected: () => true,
  send: async () => { sends++; }, format: message => message });
const server = http.createServer(async (req, res) => {
  if (req.url === '/__test/receipts' && req.method === 'POST') {
    for (const row of records.values()) row.state = 'acknowledged';
    res.end('{}'); return;
  }
  if (req.url === '/__test/count' && req.method === 'GET') {
    res.end(JSON.stringify({ sends, reservations: records.size, requests })); return;
  }
  if (req.url !== '/family/private-notice' || req.method !== 'POST') {
    res.writeHead(404); res.end(); return;
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  const adapter = { status(code) { res.statusCode = code; return this; },
    json(body) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); } };
  try {
    const body = JSON.parse(text);
    requests.push({ text, hash: validate(body).hash });
    await handler({ body }, adapter);
  }
  catch { res.writeHead(500); res.end('{}'); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));

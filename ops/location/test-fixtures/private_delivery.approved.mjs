// Durable private notice journal. No payloads, credentials, or location data are stored.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
export const DESTINATION = '238615548420255@lid';
const digest = value => createHash('sha256').update(value).digest('hex');
export function validate(body) {
  if (!body || Object.keys(body).sort().join(',') !== 'destination,idempotency_key,message'
      || body.destination !== DESTINATION || typeof body.message !== 'string'
      || !body.message.trim() || body.message.length > 2000
      || typeof body.idempotency_key !== 'string' || !body.idempotency_key
      || body.idempotency_key.length > 512) throw new Error('Invalid private notice');
  return { key: digest(body.idempotency_key), hash: digest(JSON.stringify([body.destination, body.message, body.idempotency_key])) };
}
export class Journal {
  constructor(filename) {
    if (!path.isAbsolute(filename)) throw new Error('Absolute journal required');
    const directory = path.dirname(filename);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077))
      throw new Error('Private journal directory required');
    if (fs.existsSync(filename)) {
      const info = fs.lstatSync(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077))
        throw new Error('Unsafe journal');
    } else {
      fs.closeSync(fs.openSync(filename, 'wx', 0o600));
    }
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS notices (key TEXT PRIMARY KEY, hash TEXT NOT NULL, id TEXT UNIQUE NOT NULL, state TEXT NOT NULL CHECK(state IN ('uncertain','acknowledged')))");
  }
  get(key) { return this.db.prepare('SELECT hash,id,state FROM notices WHERE key=?').get(key); }
  reserve(body) {
    const { key, hash } = validate(body);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(key);
      if (existing) {
        if (existing.hash !== hash) throw new Error('Idempotency payload conflict');
        this.db.exec('COMMIT'); return { ...existing, fresh: false };
      }
      const row = { hash, id: randomBytes(16).toString('hex').toUpperCase(), state: 'uncertain' };
      this.db.prepare('INSERT INTO notices VALUES(?,?,?,?)').run(key, hash, row.id, row.state);
      this.db.exec('COMMIT'); // Durable BEFORE socket work; a crash may lose a notice, never duplicate it.
      return { ...row, fresh: true };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  reconcile(updates) {
    for (const { key, update } of updates) {
      // DELIVERY_ACK or READ/PLAYED: acceptance by recipient, not a local send promise.
      if (key?.remoteJid !== DESTINATION || key?.fromMe !== true || key?.participant
          || !Number.isInteger(update?.status) || update.status < 3 || update.status > 5) continue;
      this.db.prepare("UPDATE notices SET state='acknowledged' WHERE id=?").run(key.id);
    }
  }
  close() { this.db.close(); }
}
export function installPrivateDelivery(app, { journal, botMode, connected, send, format }) {
  app.post('/family/private-notice', async (req, res) => {
    if (!journal || !botMode()) return res.status(503).json({ state: 'unavailable' });
    try {
      validate(req.body);
      // Checking connection before reserving permits a safe retry of never-attempted work.
      if (!connected()) return res.status(503).json({ state: 'unavailable' });
      const row = journal.reserve(req.body);
      if (row.fresh) {
        // Deliberately return before waiting on the lane/socket; client retries only reconcile.
        send(DESTINATION, { text: format(req.body.message) }, { messageId: row.id, linkPreview: null })
          .catch(() => {}); // Every rejection is uncertain, never an automatic resend.
      }
      const current = journal.get(digest(req.body.idempotency_key));
      return res.status(current.state === 'acknowledged' ? 200 : 202)
        .json({ state: current.state, messageId: current.id });
    } catch { return res.status(409).json({ state: 'unresolved' }); }
  });
}

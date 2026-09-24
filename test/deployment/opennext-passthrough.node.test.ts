import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
function probe(args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/lib/probe-opennext-deploy.mjs', 'deploy', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.split('OPENNEXT_DEPLOY_PROBE=')[1]);
}

describe('installed OpenNext argument forwarding', () => {
  it.each([['--config', 'wrangler.jsonc'], ['--', '--config', 'wrangler.jsonc']])('forwards explicit config with argv %j', (...args) => {
    const events = probe(args);
    expect(events.map(event => event.type)).toEqual(['config', 'cache', 'spawn']);
    expect(events[0].config).toBe('wrangler.jsonc');
    expect(events[1].options).toMatchObject({ target: 'remote', wranglerConfigPath: 'wrangler.jsonc' });
    expect(events[2]).toMatchObject({ command: 'npm', args: ['exec', 'wrangler', 'deploy', '--', '--config', 'wrangler.jsonc'], env: { OPEN_NEXT_DEPLOY: 'true' } });
  }, 20000);

  it('does not invent a config argument when none was supplied', () => {
    expect(probe([]).at(-1).args).toEqual(['exec', 'wrangler', 'deploy']);
  }, 20000);
});

describe('artifact checker follows the installed OpenNext CLI', () => {
  it.each([
    ['--config wrangler.jsonc', true, { exports: { ChatNotifications: { type: 'durable-object', storage: 'sqlite' } } }],
    ['--config wrangler.jsonc', false, { migrations: [{ tag: 'chat-notifications-v1', new_sqlite_classes: ['ChatNotifications'] }] }],
    ['--config wrangler.jsonc', false, {}],
    ['--config wrangler.jsonc', false, { exports: { ChatNotifications: { type: 'durable-object', storage: 'legacy-kv' } } }],
    ['--config wrangler.jsonc', false, { exports: { ChatNotifications: { type: 'durable-object', storage: 'sqlite' } }, migrations: [] }],
    ['-- --config wrangler.jsonc', true, { exports: { ChatNotifications: { type: 'durable-object', storage: 'sqlite' } } }],
    ['', false, {}],
  ])('checks actual forwarding for %j', (args, succeeds, lifecycle) => {
    const dir = mkdtempSync(join(tmpdir(), 'opennext-regression-'));
    try {
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'deploy:cloudflare': `opennextjs-cloudflare deploy ${args}` } }));
      writeFileSync(join(dir, 'cloudflare-worker.ts'), 'export default { fetch() { return new Response("ok"); } }; export class ChatNotifications {}; export class DOQueueHandler {}; export class DOShardedTagCache {}; export class BucketCachePurge {};');
      writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify({ name: 'probe-worker', main: 'cloudflare-worker.ts', compatibility_date: '2026-05-04', durable_objects: { bindings: [{ name: 'CHAT_NOTIFICATIONS', class_name: 'ChatNotifications' }] }, ...lifecycle }));
      mkdirSync(join(dir, '.wrangler/deploy'), { recursive: true });
      writeFileSync(join(dir, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../generated.json' }));
      writeFileSync(join(dir, 'generated.json'), JSON.stringify({ name: 'probe-worker', main: 'generated.js', compatibility_date: '2026-05-04' }));
      writeFileSync(join(dir, 'generated.js'), 'export default { fetch() { return new Response("wrong worker"); } };');
      const result = spawnSync(process.execPath, [resolve(root, 'scripts/check-cloudflare-deploy.mjs')], { cwd: dir, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
      expect(result.status === 0, result.stdout + result.stderr).toBe(succeeds);
      if (succeeds) expect(result.stdout).toContain('ChatNotifications');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

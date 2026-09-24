import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

describe('production worker deployment', () => {
  it('retains the declarative SQLite lifecycle already provisioned in live version 83', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.exports?.ChatNotifications).toEqual({ type: 'durable-object', storage: 'sqlite' });
    expect(config).not.toHaveProperty('migrations');
    expect(config.durable_objects.bindings).toContainEqual({ name: 'CHAT_NOTIFICATIONS', class_name: 'ChatNotifications' });
  });

  it('pins the source config so generated deploy redirects cannot bypass the custom worker', () => {
    expect(pkg.scripts['deploy:cloudflare']).toBe('opennextjs-cloudflare deploy --config wrangler.jsonc');
  });

  it('checks the real deploy bundle after every Cloudflare build', () => {
    expect(pkg.scripts['build:cloudflare']).toBe('opennextjs-cloudflare build && npm run check:cloudflare');
    expect(pkg.scripts['check:cloudflare']).toBe('node scripts/check-cloudflare-deploy.mjs');
  });

  it('uses the checked build and shared deployment command in GitHub', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(workflow).toContain('run: npm run build:cloudflare');
    expect(workflow).toContain('run: npm run deploy:cloudflare');
  });
});

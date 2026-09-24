import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unstable_readConfig } from 'wrangler';

// Inspect the same Wrangler arguments OpenNext deploy forwards, without running
// OpenNext deploy: even with --dry-run it can populate remote caches first.
const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
const [command, action, ...args] = scripts['deploy:cloudflare'].split(/\s+/);
assert.equal(command, 'opennextjs-cloudflare');
assert.equal(action, 'deploy');
const configIndex = args.indexOf('--config');
const configPath = configIndex < 0 ? undefined : args[configIndex + 1];
const config = unstable_readConfig({ config: configPath });
const outdir = mkdtempSync(join(tmpdir(), 'family-worker-check-'));
try {
  const metafile = join(outdir, 'meta.json');
  const result = spawnSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'deploy', ...args,
    ...process.argv.slice(2), '--dry-run', '--outdir', outdir, '--metafile', metafile,
  ], {
    stdio: 'inherit',
    env: { ...process.env, OPEN_NEXT_DEPLOY: 'true', WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
  });
  assert.equal(result.status, 0, 'Wrangler dry-run failed');
  const meta = JSON.parse(readFileSync(metafile, 'utf8'));
  const entry = Object.values(meta.outputs).find(output => output.entryPoint);
  assert.ok(entry, 'No deploy entry point in Wrangler metafile');
  const required = new Set(['default', 'ChatNotifications', 'DOQueueHandler', 'DOShardedTagCache', 'BucketCachePurge']);
  for (const binding of config.durable_objects.bindings) {
    if (!binding.script_name) required.add(binding.class_name);
  }
  for (const migration of config.migrations) {
    for (const name of [...(migration.new_classes ?? []), ...(migration.new_sqlite_classes ?? [])]) required.add(name);
  }
  for (const name of required) {
    assert.ok(entry.exports.includes(name), `Deploy artifact is missing export: ${name}`);
  }
  assert.equal(resolve(entry.entryPoint), resolve('cloudflare-worker.ts'), 'Deploy must use the custom fetch wrapper');
  console.log(`Verified deploy entry ${entry.entryPoint}: ${entry.exports.join(', ')}`);
} finally {
  rmSync(outdir, { recursive: true, force: true });
}

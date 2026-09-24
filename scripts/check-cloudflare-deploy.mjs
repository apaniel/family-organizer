import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler';

// Run the installed OpenNext CLI in an isolated probe. Cache/network operations
// are stubbed; the real runWrangler subprocess invocation is captured, not guessed.
const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
const [command, ...args] = scripts['deploy:cloudflare'].trim().split(/\s+/);
assert.equal(command, 'opennextjs-cloudflare');
assert.equal(args[0], 'deploy');
assert.ok(args.every(arg => /^[a-zA-Z0-9_./=-]+$/.test(arg)), 'Unsupported deploy script syntax; review probe');
const extraArgs = process.argv.slice(2);
assert.ok(extraArgs.length === 0 || (extraArgs.length === 1 && extraArgs[0] === '.open-next/worker.js'),
  'Only the generated-worker negative control is supported');
const probe = spawnSync(process.execPath, [
  new URL('./lib/probe-opennext-deploy.mjs', import.meta.url).pathname, ...args, ...extraArgs,
], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
assert.equal(probe.status, 0, `OpenNext forwarding probe failed: ${probe.stderr}`);
const events = JSON.parse(probe.stdout.split('OPENNEXT_DEPLOY_PROBE=')[1]);
assert.deepEqual(events.map(event => event.type), ['config', 'cache', 'spawn']);
assert.equal(events[0].config, 'wrangler.jsonc', 'OpenNext must read the source config');
assert.equal(events[1].options.target, 'remote', 'OpenNext cache population must precede deployment');
assert.equal(events[1].options.wranglerConfigPath, 'wrangler.jsonc');
const invocation = events[2];
assert.equal(invocation.command, 'npm');
assert.deepEqual(invocation.args.slice(0, 4), ['exec', 'wrangler', 'deploy', '--']);
const forwarded = invocation.args.slice(4);
assert.ok(!forwarded.includes('--'), 'Unexpected Wrangler delimiter would disable dry-run flags');
const configIndex = forwarded.indexOf('--config');
assert.ok(configIndex >= 0, 'OpenNext did not forward explicit --config');
assert.equal(forwarded[configIndex + 1], 'wrangler.jsonc');
assert.deepEqual(forwarded, ['--config', 'wrangler.jsonc', ...extraArgs],
  'Unexpected deploy arguments; review before running the local dry-run');
assert.equal(invocation.env.OPEN_NEXT_DEPLOY, 'true');
const configArgs = { config: forwarded[configIndex + 1] };
const { rawConfig } = experimental_readRawConfig(configArgs);
assert.ok(!Object.hasOwn(rawConfig, 'migrations'),
  'Legacy migrations are forbidden: this Worker already uses declarative exports');
assert.deepEqual(rawConfig.exports?.ChatNotifications,
  { type: 'durable-object', storage: 'sqlite' },
  'Declare exports.ChatNotifications as type durable-object with storage sqlite');
const config = unstable_readConfig(configArgs);
console.log(`Captured OpenNext invocation: ${invocation.command} ${invocation.args.join(' ')}`);
const outdir = mkdtempSync(join(tmpdir(), 'family-worker-check-'));
try {
  const metafile = join(outdir, 'meta.json');
  const result = spawnSync(invocation.command, [
    ...invocation.args, '--dry-run', '--outdir', outdir, '--metafile', metafile,
  ], {
    stdio: 'inherit',
    env: { ...process.env, ...invocation.env, WRANGLER_SEND_METRICS: 'false',
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
  for (const [name, entry] of Object.entries(config.exports ?? {})) {
    if (entry.type === 'durable-object' && (!entry.state || entry.state === 'created' || entry.state === 'expecting-transfer')) required.add(name);
  }
  for (const name of required) {
    assert.ok(entry.exports.includes(name), `Deploy artifact is missing export: ${name}`);
  }
  assert.equal(resolve(entry.entryPoint), resolve('cloudflare-worker.ts'), 'Deploy must use the custom fetch wrapper');
  console.log(`Verified deploy entry ${entry.entryPoint}: ${entry.exports.join(', ')}`);
} finally {
  rmSync(outdir, { recursive: true, force: true });
}

// Local-only probe: execute the installed CLI/parser/deploy/runWrangler code,
// replacing cache/config/network operations and intercepting process spawning.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';

const events = [];
globalThis.__deployProbeEvents = events;
childProcess.spawnSync = (command, args, options) => {
  events.push({ type: 'spawn', command, args, env: {
    OPEN_NEXT_DEPLOY: options.env.OPEN_NEXT_DEPLOY,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: options.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV,
  } });
  return { status: 0, stdout: '', stderr: '' };
};
syncBuiltinESMExports();
const stubs = {
  '/commands/utils/utils.js': {
    printHeaders: '() => {}',
    retrieveCompiledConfig: 'async () => ({ config: {} })',
    getNormalizedOptions: '() => ({ packager: "npm" })',
    readWranglerConfig: 'async (args) => { globalThis.__deployProbeEvents.push({ type: "config", config: args.wranglerConfigPath }); return {}; }',
  },
  '/commands/utils/helpers.js': { getEnvFromPlatformProxy: 'async () => ({})' },
  '/commands/populate-cache.js': {
    populateCache: 'async (_build, _config, _wrangler, options) => { globalThis.__deployProbeEvents.push({ type: "cache", options }); }',
  },
  '/commands/skew-protection.js': { getDeploymentMapping: 'async () => undefined' },
};
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.includes('/@opennextjs/cloudflare/dist/cli/')) return result;
    const replacements = Object.entries(stubs).find(([suffix]) => url.endsWith(suffix))?.[1];
    if (!replacements) return result;
    let source = String(result.source);
    for (const [name, implementation] of Object.entries(replacements)) {
      const declaration = new RegExp(`export (async )?function ${name}\\(`);
      if (!declaration.test(source)) throw new Error(`Probe cannot isolate ${name}; review installed OpenNext`);
      source = source.replace(declaration, (_match, asyncKeyword = '') => `${asyncKeyword}function unused_${name}(`);
      source += `\nexport const ${name} = ${implementation};\n`;
    }
    return { ...result, source };
  },
});
const cli = new URL('../cli/index.js', import.meta.resolve('@opennextjs/cloudflare')).href;
process.argv = [process.execPath, fileURLToPath(cli), ...process.argv.slice(2)];
await import(cli);
console.log('OPENNEXT_DEPLOY_PROBE=' + JSON.stringify(events));

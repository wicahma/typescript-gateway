#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const USAGE = `tsgate - TypeScript Gateway CLI

Usage:
  tsgate init [dir]        Scaffold a new gateway project
  tsgate start [-c path]   Start the gateway (default: ./gateway.config.json)
  tsgate validate [-c path]  Validate config without starting
  tsgate version           Print version
`;

const STARTER_CONFIG = {
  version: '1.0.0',
  environment: 'development',
  server: { port: 8088, host: '0.0.0.0' },
  routes: [{ method: 'GET', path: '/api/*' }],
  upstreams: [
    { id: 'backend', protocol: 'http', host: 'localhost', port: 3000, poolSize: 10 },
  ],
  plugins: { dir: './plugins' },
};

const STARTER_PLUGIN = `import type { Plugin } from 'typescript-gateway';

const plugin: Plugin = {
  name: 'hello',
  version: '1.0.0',
  description: 'Example plugin: adds a response header',

  async postHandler(ctx) {
    ctx.state['pluginHeaders'] = { 'x-hello': 'from tsgate plugin' };
  },
};

export default plugin;
`;

const STARTER_PKG = {
  name: 'my-gateway',
  private: true,
  type: 'module',
  dependencies: { 'typescript-gateway': 'latest' },
  scripts: { start: 'tsgate start' },
};

function init(dir: string): void {
  const root = resolve(dir);
  if (existsSync(join(root, 'gateway.config.json'))) {
    console.error(`init: ${root} already has a gateway.config.json`);
    process.exit(1);
  }
  mkdirSync(join(root, 'plugins'), { recursive: true });
  writeFileSync(join(root, 'gateway.config.json'), JSON.stringify(STARTER_CONFIG, null, 2) + '\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify(STARTER_PKG, null, 2) + '\n');
  writeFileSync(join(root, 'plugins', 'hello.ts'), STARTER_PLUGIN);
  console.log(`Created gateway project in ${root}`);
  console.log('Next: npm install && npx tsgate start');
}

async function getConfigPath(args: string[]): Promise<string> {
  const i = args.indexOf('-c');
  const value = i >= 0 ? args[i + 1] : undefined;
  return resolve(typeof value === 'string' ? value : './gateway.config.json');
}

async function validate(configPath: string): Promise<void> {
  const { createConfigLoader } = await import('./config/loader.js');
  const loader = createConfigLoader({ configPath, hotReload: false, reloadInterval: 0, validate: true });
  try {
    const config = await loader.load();
    const routes = config.routes?.length ?? 0;
    const upstreams = config.upstreams?.length ?? 0;
    console.log(`OK: ${configPath} (${routes} routes, ${upstreams} upstreams)`);
  } catch (error) {
    console.error(`Invalid: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  } finally {
    loader.destroy();
  }
}

async function start(configPath: string): Promise<void> {
  const tsxApi = (await import('tsx/esm/api').catch(() => null)) as
    | { register?: (o?: { namespace?: string }) => () => void }
    | null;
  if (!tsxApi?.register) {
    console.error('tsx is required for TypeScript plugins: npm install tsx');
    process.exit(1);
  }
  const unregister = tsxApi.register({ namespace: 'tsgate-plugins' });
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const pluginDir = config?.plugins?.dir ? resolve(config.plugins.dir) : null;
    const { Gateway } = await import('./index.js');
    const gateway = new Gateway(configPath);
    if (pluginDir && existsSync(pluginDir)) {
      const { PluginLoader } = await import('./plugins/loader.js');
      const loader = new PluginLoader({ pluginDir, autoLoad: false, loadTimeout: 10000, hotReload: false });
      const plugins = await loader.loadFromDirectory();
      for (const p of plugins) gateway.registerPlugin(p);
    }
    await gateway.start();
  } finally {
    unregister();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'init':
      init(rest[0] || '.');
      break;
    case 'start':
      await start(await getConfigPath(rest));
      break;
    case 'validate':
      await validate(await getConfigPath(rest));
      break;
    case 'version': {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
      console.log(pkg.version);
      break;
    }
    default:
      process.stdout.write(USAGE);
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

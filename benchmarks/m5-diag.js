import autocannon from 'autocannon';
import { Gateway } from '../dist/index.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const GATEWAY_PORT = 3993;
const UPSTREAM_PORT = 4093;
const DURATION = 10;
const CONNECTIONS = 100;

async function run(label, cfg) {
  const upstream = createHttpServer((req, res) => { req.resume(); res.end('{}'); });
  await new Promise(r => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r));

  const config = {
    version: '1.0.0', environment: 'production',
    server: { port: GATEWAY_PORT, host: '127.0.0.1' },
    routes: [{ method: 'POST', path: '/api/*', priority: 0 }],
    upstreams: [{ id: 'u1', protocol: 'http', host: '127.0.0.1', port: UPSTREAM_PORT,
      basePath: '', poolSize: 100, timeout: 30000,
      healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 } }],
    plugins: [], performance: { workerCount: 0, contextPoolSize: 1000, bufferPoolSize: 1000,
      responsePoolSize: 1000, enablePooling: true },
    ...cfg,
  };
  const configPath = join(tmpdir(), `m5-diag-${Date.now()}.json`);
  writeFileSync(configPath, JSON.stringify(config));

  const gateway = new Gateway(configPath);
  await gateway.start();
  const result = await new Promise((resolve, reject) => {
    const inst = autocannon({
      url: `http://127.0.0.1:${GATEWAY_PORT}/api/p`,
      connections: CONNECTIONS, duration: DURATION, method: 'POST',
      body: '{"n":1}', pipelining: 1,
    }, (err, r) => err ? reject(err) : resolve(r));
    autocannon.track(inst, { renderProgressBar: false });
  });
  await gateway.stop(); upstream.close();
  await new Promise(r => setTimeout(r, 200));
  try { unlinkSync(configPath); } catch {}

  console.log(`${label.padEnd(24)} P99=${(result.latency.p99??0).toFixed(1)}ms RPS=${(result.requests.average??0).toFixed(0)}`);
}

await run('plain proxy (default)', {});
await run('no transform+compress', { performance: { workerCount: 0, contextPoolSize: 1000, bufferPoolSize: 1000, responsePoolSize: 1000, enablePooling: true, enableRequestTransformations: false, enableResponseTransformations: false, enableCompression: false } });

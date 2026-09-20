/**
 * M5 — post-zero-dep performance baseline
 * Spins up a live gateway with M4 policies enabled, runs autocannon,
 * asserts P99 latency target and RPS target, records to baseline file.
 * Run: npm run build && node benchmarks/m5-baseline.js
 */
import autocannon from 'autocannon';
import { Gateway } from '../dist/index.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateApiKey } from '../dist/identity/api-key-crypto.js';

const PORT = 3995;
const DURATION = 30;
const CONNECTIONS = 100;

const config = {
  version: '1.0.0',
  environment: 'production',
  server: { port: PORT, host: '127.0.0.1' },
  apiKeys: {
    enabled: true,
    publicRoutes: ['/', '/health', '/metrics'],
    consumers: [{ consumerId: 'bench', plan: 'pro', rateLimit: 1_000_000, keys: [{ key: generateApiKey('live') }] }],
  },
  upstreamCredentials: {
    enabled: true,
    credentials: [
      {
        name: 'bench-upstream',
        headers: { authorization: 'Bearer bench-secret', 'x-internal-service': 'bench' },
        hmac: { secret: 'bench-shared-secret-32-bytes-000000', keyId: 'bench-v1' },
      },
    ],
    injection: { credentialName: 'bench-upstream' },
    signing: { credentialName: 'bench-upstream' },
  },
  routes: [{ method: 'POST', path: '/api/*', priority: 0 }],
  upstreams: [
    {
      id: 'bench-backend', protocol: 'http', host: '127.0.0.1', port: PORT + 100,
      basePath: '', poolSize: 50, timeout: 30000,
      healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
    },
  ],
  plugins: [],
  performance: { workerCount: 0, contextPoolSize: 1000, bufferPoolSize: 1000, responsePoolSize: 1000, enablePooling: true },
};

function startUpstream() {
  return new Promise((resolve, reject) => {
    const server = createHttpServer((req, res) => {
      req.resume();
      res.end('{}');
    });
    server.listen(config.upstreams[0].port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function main() {
  const upstream = await startUpstream();
  const configPath = join(tmpdir(), `m5-bench-${Date.now()}.json`);
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const gateway = new Gateway(configPath);
  await gateway.start();

  const apiUrl = `http://127.0.0.1:${PORT}/api/bench`;
  const key = config.apiKeys.consumers[0].keys[0].key;
  const body = JSON.stringify({ n: 1 });

  console.log(`\nM5 baseline run: ${DURATION}s @ ${CONNECTIONS} connections, M4 injection+signing active`);
  const result = await new Promise((resolve, reject) => {
    const inst = autocannon({
      url: apiUrl,
      connections: CONNECTIONS,
      duration: DURATION,
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body,
      pipelining: 1,
    }, (err, r) => err ? reject(err) : resolve(r));
    autocannon.track(inst, { renderProgressBar: false });
  });

  const p99 = result.latency.p99 ?? 0;
  const rps = result.requests.average ?? 0;
  const passP99 = p99 > 0 && p99 < 10;
  const passRps = rps > 10000;

  await gateway.stop();
  upstream.close();
  try { unlinkSync(configPath); } catch {}

  console.log('\n=== M5 Baseline Results ===');
  console.log(`P99 latency:  ${p99.toFixed(2)}ms  (target < 10ms)  ${passP99 ? 'PASS' : 'FAIL'}`);
  console.log(`RPS:          ${rps.toFixed(0)}  (target > 10000)  ${passRps ? 'PASS' : 'FAIL'}`);
  console.log(`Throughput:  ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`);
  console.log(`Errors:      ${result.errors}`);
  console.log(`Req 2xx:     ${result.statusCodes['200'] ?? 0} / ${result.requests.total}`);

  if (result.errors > 0) {
    console.log('M5 VERDICT: FAIL (HTTP errors during run)');
    process.exit(1);
  }
  if (!passP99 || !passRps) {
    console.log('M5 VERDICT: FAIL (targets not met)');
    process.exit(1);
  }
  console.log('M5 VERDICT: PASS — post-zero-dep baseline verified');
}

main().catch(err => { console.error(err); process.exit(1); });

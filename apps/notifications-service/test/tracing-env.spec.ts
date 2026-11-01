import { execFile } from 'child_process';
import { createServer } from 'http';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { promisify } from 'util';

it('exports to the collector and service name configured only in .env', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'p2p-tracing-env-'));
  const requests: { path?: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ path: req.url, body });
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
    });
  });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address() as { port: number };
    writeFileSync(resolve(directory, '.env'),
      `OTEL_SERVICE_NAME=dotenv-probe
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${address.port}
`);
    const root = resolve(__dirname, '..');
    const script = `
      require(${JSON.stringify(resolve(root, 'src/tracing.ts'))});
      const { trace } = require(${JSON.stringify(resolve(root, 'node_modules/@opentelemetry/api'))});
      trace.getTracer('probe').startSpan('env-probe').end();
      const { TracingShutdown } = require(${JSON.stringify(resolve(root, 'src/observability/tracing-shutdown.ts'))});
      new TracingShutdown().onApplicationShutdown().catch(() => process.exitCode = 1);
    `;
    const env: NodeJS.ProcessEnv = { ...process.env, TS_NODE_PROJECT: resolve(root, 'tsconfig.json') };
    for (const key of Object.keys(env)) if (key.startsWith('OTEL_')) delete env[key];
    await promisify(execFile)(process.execPath,
      ['-r', resolve(root, 'node_modules/ts-node/register/transpile-only'), '-e', script],
      { cwd: directory, env, timeout: 15000 });
    const traces = requests.filter((request) => request.path === '/v1/traces');
    expect(traces).toHaveLength(1);
    const payload = JSON.parse(traces[0].body);
    expect(payload.resourceSpans[0].resource.attributes).toContainEqual({
      key: 'service.name', value: { stringValue: 'dotenv-probe' },
    });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

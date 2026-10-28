import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const port = 65446;
const origin = `http://127.0.0.1:${port}`;
const reservation = createServer();
reservation.listen(port, '127.0.0.1');
await once(reservation, 'listening');
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', REDIS_URL: 'redis://127.0.0.1:1',
    NEXTAUTH_URL: origin, NEXTAUTH_SECRET: 'test-only-http-check', ENCRYPTION_KEY: '1'.repeat(64) },
});
let output = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
const stopped = once(server, 'exit');
try {
  const endpoint = `${origin}/api/integrations/musa/v1/analytics/capabilities`;
  const deadline = Date.now() + 30000;
  let response;
  while (!response && Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next exited before the probe: ${output}`);
    try { response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) }); }
    catch { await delay(100); }
  }
  assert.ok(response, `Next did not start: ${output}`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_QUERY');
  const query = new URLSearchParams({ accountId: 'probe', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', timezone: 'UTC' });
  const unauthorized = await fetch(`${endpoint}?${query}`, { signal: AbortSignal.timeout(3000) });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, 'UNAUTHORIZED');
  assert.equal(server.exitCode, null, `The probe server exited: ${output}`);
  assert.equal(server.signalCode, null);
  console.log('MUSA analytics HTTP: invalid query 400 and missing credentials 401; no provider/database credentials used.');
} finally {
  server.kill('SIGTERM');
  await Promise.race([stopped, delay(5000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

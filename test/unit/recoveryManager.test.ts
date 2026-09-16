import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { RecoveryManager } from '../../src/recovery/recoveryManager';

type Reply = { status: number; body: unknown };

function stubFetch(replies: Reply[]): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: { method?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const reply = replies.shift() ?? { status: 200, body: { status: 'completed' } };
    return new Response(JSON.stringify(reply.body), { status: reply.status, statusText: 'x' });
  });
  return { calls };
}

// Timers and fetch both advance under our control, so a recovery runs in one tick sequence.
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(ticks: number[]): Promise<void> {
  await flush();
  for (const ms of ticks) {
    mock.timers.tick(ms);
    await flush();
  }
}

describe('RecoveryManager', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    mock.method(console, 'warn', () => {});
    mock.method(console, 'error', () => {});
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it('recovers after the alive timeout, polls to completion, and monitors once', async () => {
    const { calls } = stubFetch([
      { status: 200, body: { requestId: 'req-1', estimatedMessages: 3 } },
      { status: 500, body: {} },
      { status: 200, body: { status: 'in_progress' } },
      { status: 200, body: { status: 'completed' } },
    ]);
    const manager = new RecoveryManager('https://api.example', 'key', 30_000, true);
    const events: string[] = [];
    manager.on('recoveryStarted', data => events.push(`started:${data.estimatedMessages}`));
    manager.on('recoveryCompleted', () => events.push('completed'));

    manager.startMonitoring();
    manager.startMonitoring();
    await settle([20_000]);
    manager.onAlive({ productId: 1, timestamp: 1, subscribed: true });
    await settle([20_000]);
    assert.deepEqual(calls, [], 'an alive inside the window keeps recovery off');

    await settle([35_000, 2_000, 2_000, 2_000]);

    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].url.startsWith('https://api.example/sos-api/recovery/1/initiate_request?after='));
    assert.equal(calls.length, 4);
    assert.deepEqual(events, ['started:3', 'completed']);
    manager.stopMonitoring();
    manager.stopMonitoring();
  });

  it('reports a failed recovery, a refused request, and a poll that never completes', async () => {
    const errors: string[] = [];
    const failed = new RecoveryManager('https://api.example', 'key', 30_000, true);
    failed.on('error', err => errors.push(err.message));

    stubFetch([{ status: 200, body: { requestId: 'r', estimatedMessages: 0 } }, { status: 200, body: { status: 'failed' } }]);
    const reconnect = failed.onReconnect();
    await settle([2_000]);
    await reconnect;
    assert.deepEqual(errors, ['Recovery failed on server']);

    mock.restoreAll();
    mock.method(console, 'error', () => {});
    stubFetch([{ status: 503, body: {} }]);
    await failed.onReconnect();
    assert.match(errors[1], /Recovery request failed: 503/);

    mock.restoreAll();
    mock.method(console, 'error', () => {});
    stubFetch([{ status: 200, body: { requestId: 'r', estimatedMessages: 0 } }, ...Array.from({ length: 60 }, () => ({ status: 200, body: { status: 'pending' } }))]);
    const slow = failed.onReconnect();
    await settle(Array.from({ length: 60 }, () => 2_000));
    await slow;
    assert.equal(errors[2], 'Recovery polling timed out');
  });

  it('does nothing on reconnect when auto recovery is off, and never runs two recoveries at once', async () => {
    const { calls } = stubFetch([]);
    const off = new RecoveryManager('https://api.example', 'key', 30_000, false);
    await off.onReconnect();
    assert.deepEqual(calls, []);

    const on = new RecoveryManager('https://api.example', 'key', 30_000, true);
    stubFetch([{ status: 200, body: { requestId: 'r', estimatedMessages: 0 } }, { status: 200, body: { status: 'completed' } }]);
    const first = on.onReconnect();
    const second = on.onReconnect();
    await settle([2_000]);
    await Promise.all([first, second]);
    const posts = (globalThis.fetch as unknown as { mock: { calls: { arguments: [string, { method?: string }] }[] } }).mock.calls
      .filter(c => c.arguments[1]?.method === 'POST');
    assert.equal(posts.length, 1);
  });
});

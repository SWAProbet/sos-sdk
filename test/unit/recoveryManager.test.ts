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

  it('requests recovery under a configured API base path', async () => {
    const { calls } = stubFetch([{ status: 200, body: { requestId: 'req-9', estimatedMessages: 0 } }]);
    const manager = new RecoveryManager('https://api.example', 'key', 30_000, true, '/partner/sos');

    void manager.onReconnect();
    await settle([2000]);

    assert.ok(calls[0].url.startsWith('https://api.example/partner/sos/recovery/1/initiate_request?after='));
    assert.ok(calls[1].url.startsWith('https://api.example/partner/sos/recovery/1/status?request_id=req-9'));
  });

  const iso = (ms: number) => encodeURIComponent(new Date(ms).toISOString());

  it('replays each producer it has heard from, each from that producer\'s own last alive', async () => {
    const { calls } = stubFetch([
      { status: 200, body: { requestId: 'live', estimatedMessages: 4 } },
      { status: 200, body: { requestId: 'pre', estimatedMessages: 1 } },
    ]);
    const manager = new RecoveryManager('https://api.example', 'key', 30_000, true);
    const started: number[] = [];
    manager.on('recoveryStarted', data => started.push(data.estimatedMessages));
    manager.onAlive({ productId: 1, timestamp: 1_790_000_000_000, subscribed: true });
    manager.onAlive({ productId: 3, timestamp: 1_790_000_007_000, subscribed: true });
    manager.setConsumerQueue('amq.gen-7');

    const recovery = manager.onReconnect();
    await settle([2_000, 2_000]);
    await recovery;

    assert.deepEqual(calls.map(c => c.url), [
      `https://api.example/sos-api/recovery/1/initiate_request?after=${iso(1_790_000_000_000)}&consumer_queue=amq.gen-7`,
      `https://api.example/sos-api/recovery/3/initiate_request?after=${iso(1_790_000_007_000)}&consumer_queue=amq.gen-7`,
      'https://api.example/sos-api/recovery/1/status?request_id=live',
      'https://api.example/sos-api/recovery/3/status?request_id=pre',
    ]);
    assert.deepEqual(started, [5], 'one start for the whole recovery, counting every producer');
  });

  it('starts from the first connect on the live producer when no alive was ever heard', async () => {
    const { calls } = stubFetch([{ status: 200, body: { requestId: 'r', estimatedMessages: 0 } }]);
    const manager = new RecoveryManager('https://api.example', 'key', 30_000, true);
    manager.startMonitoring();
    const connectedAt = Date.now();
    mock.timers.tick(9_000);
    manager.onAlive({ productId: 1, timestamp: Number.NaN, subscribed: true });
    const heardAt = Date.now();
    manager.stopMonitoring();

    const unheard = new RecoveryManager('https://api.example', 'key', 30_000, true);
    unheard.startMonitoring();
    unheard.stopMonitoring();
    mock.timers.tick(4_000);
    const first = unheard.onReconnect();
    await settle([2_000]);
    await first;
    assert.equal(calls[0].url, `https://api.example/sos-api/recovery/1/initiate_request?after=${iso(connectedAt + 9_000)}`);

    const second = manager.onReconnect();
    await settle([2_000]);
    await second;
    assert.ok(calls[2].url.endsWith(`after=${iso(heardAt)}`), 'an alive with no usable timestamp counts from when it arrived');
  });

  it('keeps the start of a failed recovery, ignores alives meanwhile, and retries it after the timeout', async () => {
    const { calls } = stubFetch([
      { status: 503, body: {} },
      { status: 200, body: { requestId: 'again', estimatedMessages: 2 } },
      { status: 200, body: { status: 'completed' } },
      { status: 200, body: { requestId: 'later', estimatedMessages: 0 } },
    ]);
    const manager = new RecoveryManager('https://api.example', 'key', 30_000, true);
    const events: string[] = [];
    manager.on('error', () => events.push('error'));
    manager.on('recoveryCompleted', () => events.push('completed'));
    manager.onAlive({ productId: 1, timestamp: 1_790_000_000_000, subscribed: true });
    manager.startMonitoring();

    await manager.onReconnect();
    assert.deepEqual(events, ['error']);

    // The feed is back, so silence will not trigger anything; the debt alone must.
    for (let elapsed = 0; elapsed < 30_000; elapsed += 5_000) {
      manager.onAlive({ productId: 1, timestamp: 1_790_000_100_000 + elapsed, subscribed: true });
      await settle([5_000]);
    }
    await settle([2_000]);

    assert.equal(calls.filter(c => c.method === 'POST').length, 2);
    assert.ok(calls[1].url.includes(`after=${iso(1_790_000_000_000)}`), 'the retry starts where the failed attempt did');
    assert.deepEqual(events, ['error', 'completed']);

    const next = manager.onReconnect();
    await settle([2_000]);
    await next;
    assert.ok(calls[3].url.includes(`after=${iso(1_790_000_125_000)}`), 'once paid, the next recovery starts from the latest alive');
    manager.stopMonitoring();
  });
});

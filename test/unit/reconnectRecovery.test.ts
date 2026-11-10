import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import amqplib from 'amqplib';
import { SosClient } from '../../src/client';

// A broker per connection, so a close and a reconnect land on a fresh channel and queue.
function fakeBroker(queue: string) {
  const channel = {
    handler: null as ((msg: unknown) => void) | null,
    declared: 0,
    bound: 0,
    consumed: [] as string[],
    async assertQueue() { channel.declared += 1; return { queue }; },
    async bindQueue() { channel.bound += 1; },
    async consume(name: string, handler: (msg: unknown) => void) { channel.consumed.push(name); channel.handler = handler; return { consumerTag: 'tag' }; },
    ack() {},
    async cancel() {},
    async close() {},
  };
  const connection = Object.assign(new EventEmitter(), { async createChannel() { return channel; }, async close() {} });
  return { channel, connection };
}

const alive = (broker: ReturnType<typeof fakeBroker>, product: number, timestamp: number, routingKey = 'system.live.alive.boxing') =>
  broker.channel.handler?.({
    content: Buffer.from(`<alive product="${product}" timestamp="${timestamp}" subscribed="1"/>`),
    fields: { routingKey },
    properties: { headers: {} },
  });

const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise<void>(resolve => setImmediate(resolve)); };

function stubRecoveryApi(): string[] {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const body = url.includes('initiate_request') ? { requestId: `req-${calls.length}`, estimatedMessages: 2 } : { status: 'completed' };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

const LAST_ALIVE = Date.UTC(2026, 8, 21, 10, 0, 0);

describe('recovery after a reconnect', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: LAST_ALIVE });
    for (const level of ['error', 'log', 'warn'] as const) mock.method(console, level, () => {});
  });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  async function connectDropAndReconnect(autoRecover: boolean, queue?: string) {
    const brokers = [fakeBroker('amq.gen-first'), fakeBroker('amq.gen-second')];
    const [first, second] = brokers;
    mock.method(amqplib, 'connect', async () => brokers.shift()!.connection as never);
    const calls = stubRecoveryApi();
    const client = new SosClient({ accessToken: 'key', amqpHost: 'amqp://broker', apiHost: 'https://api.example', sport: 'boxing', autoRecover, queue });
    const seen: string[] = [];
    client.on('recoveryStarted', data => seen.push(`started ${data.estimatedMessages}`));
    client.on('recoveryCompleted', () => seen.push('completed'));
    client.on('error', err => seen.push(`error ${err.message}`));

    await client.connect();
    await flush();
    const callsOnFirstConnect = [...calls];

    alive(first, 1, LAST_ALIVE);
    mock.timers.tick(4_000);
    first.connection.emit('close');
    mock.timers.tick(5_000);
    await flush();
    mock.timers.tick(2_000);
    await flush();
    return { client, calls, callsOnFirstConnect, seen, channels: [first.channel, second.channel] };
  }

  it('asks for everything since the last alive before the drop, into the new consumer queue', async () => {
    const { client, calls, callsOnFirstConnect, seen } = await connectDropAndReconnect(true);

    assert.deepEqual(callsOnFirstConnect, [], 'the first connect has nothing to recover');
    const after = encodeURIComponent(new Date(LAST_ALIVE).toISOString());
    assert.deepEqual(calls, [
      `POST https://api.example/sos/recovery/1/initiate_request?after=${after}&consumer_queue=amq.gen-second&sport=boxing`,
      'GET https://api.example/sos/recovery/1/status?request_id=req-1&sport=boxing',
    ]);
    assert.deepEqual(seen, ['started 2', 'completed']);
    await client.disconnect();
  });

  it('asks for the replay into the durable partner queue when that is the queue it consumes', async () => {
    const queue = 'swa.sos.partner.3f9a1c2e';
    const { client, calls, callsOnFirstConnect, seen, channels } = await connectDropAndReconnect(true, queue);

    assert.deepEqual(callsOnFirstConnect, []);
    const after = encodeURIComponent(new Date(LAST_ALIVE).toISOString());
    assert.deepEqual(calls, [
      `POST https://api.example/sos/recovery/1/initiate_request?after=${after}&consumer_queue=${queue}&sport=boxing`,
      'GET https://api.example/sos/recovery/1/status?request_id=req-1&sport=boxing',
    ]);
    assert.deepEqual(seen, ['started 2', 'completed']);
    // Both connections consume the one queue by name; neither declares or binds.
    assert.deepEqual(channels.map(c => c.consumed), [[queue], [queue]]);
    assert.deepEqual(channels.map(c => [c.declared, c.bound]), [[0, 0], [0, 0]]);
    await client.disconnect();
  });

  it('asks for nothing when autoRecover is off', async () => {
    const { client, calls } = await connectDropAndReconnect(false);
    assert.deepEqual(calls, []);
    await client.disconnect();
  });
});

describe('recovery when this sport falls silent on the durable queue', () => {
  const QUEUE = 'swa.sos.partner.3f9a1c2e';

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: LAST_ALIVE });
    for (const level of ['error', 'log', 'warn'] as const) mock.method(console, level, () => {});
  });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  // Hears boxing once on connect, then for 40 seconds only heartbeats on the given key, one every 10 seconds.
  async function hearOnly(routingKey: string) {
    const broker = fakeBroker(QUEUE);
    mock.method(amqplib, 'connect', async () => broker.connection as never);
    const calls = stubRecoveryApi();
    const client = new SosClient({ accessToken: 'key', amqpHost: 'amqp://broker', apiHost: 'https://api.example', sport: 'boxing', queue: QUEUE, aliveTimeoutMs: 30_000 });
    const heard: number[] = [];
    client.on('alive', event => heard.push(event.timestamp));

    await client.connect();
    await flush();
    alive(broker, 1, LAST_ALIVE);
    for (let i = 1; i <= 4; i += 1) {
      mock.timers.tick(10_000);
      alive(broker, 1, LAST_ALIVE + i * 10_000, routingKey);
      await flush();
    }
    mock.timers.tick(2_000);
    await flush();
    return { client, calls, heard };
  }

  it("notices the silence while another sport's heartbeat keeps arriving, and replays from boxing's last", async () => {
    const { client, calls, heard } = await hearOnly('system.live.alive.tennis');

    assert.deepEqual(heard, [LAST_ALIVE], "tennis's heartbeat is not emitted as boxing's");
    const after = encodeURIComponent(new Date(LAST_ALIVE).toISOString());
    assert.deepEqual(calls, [
      `POST https://api.example/sos/recovery/1/initiate_request?after=${after}&consumer_queue=${QUEUE}&sport=boxing`,
      'GET https://api.example/sos/recovery/1/status?request_id=req-1&sport=boxing',
    ]);
    await client.disconnect();
  });

  it("stays quiet while boxing's own heartbeat keeps arriving", async () => {
    const { client, calls, heard } = await hearOnly('system.live.alive.boxing');

    assert.equal(heard.length, 5);
    assert.deepEqual(calls, []);
    await client.disconnect();
  });
});

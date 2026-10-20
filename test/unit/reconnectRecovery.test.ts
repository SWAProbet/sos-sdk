import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import amqplib from 'amqplib';
import { SosClient } from '../../src/client';

// A broker per connection, so a close and a reconnect land on a fresh channel and queue.
function fakeBroker(queue: string) {
  const channel = {
    handler: null as ((msg: unknown) => void) | null,
    async assertQueue() { return { queue }; },
    async bindQueue() {},
    async consume(_queue: string, handler: (msg: unknown) => void) { channel.handler = handler; return { consumerTag: 'tag' }; },
    ack() {},
    async cancel() {},
    async close() {},
  };
  const connection = Object.assign(new EventEmitter(), { async createChannel() { return channel; }, async close() {} });
  return { channel, connection };
}

const alive = (broker: ReturnType<typeof fakeBroker>, product: number, timestamp: number) =>
  broker.channel.handler?.({
    content: Buffer.from(`<alive product="${product}" timestamp="${timestamp}" subscribed="1"/>`),
    fields: { routingKey: 'system.live.alive.boxing' },
    properties: { headers: {} },
  });

const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise<void>(resolve => setImmediate(resolve)); };

// Plays the server: before a status poll reports completed, the replay's snapshot_complete has
// been delivered into the consumer's queue through the default exchange.
function stubRecoveryApi(deliverSnapshot: (requestId: string) => void = () => {}): string[] {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('initiate_request')) {
      return new Response(JSON.stringify({ requestId: `req-${calls.length}`, estimatedMessages: 2 }), { status: 200 });
    }
    deliverSnapshot(new URL(url).searchParams.get('request_id')!);
    return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
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

  async function connectDropAndReconnect(autoRecover: boolean) {
    const brokers = [fakeBroker('amq.gen-first'), fakeBroker('amq.gen-second')];
    const [first, second] = brokers;
    mock.method(amqplib, 'connect', async () => brokers.shift()!.connection as never);
    const replayed: unknown[] = [];
    const calls = stubRecoveryApi(requestId => second.channel.handler?.({
      content: Buffer.from(`<snapshot_complete product="1" request_id="${requestId}" timestamp="${Date.now()}"/>`),
      fields: { routingKey: 'amq.gen-second' },
      properties: { messageId: `sc-${requestId}`, headers: { 'x-sos-routing-key': 'system.live.snapshot_complete.-' } },
    }));
    const client = new SosClient({ accessToken: 'key', amqpHost: 'amqp://broker', apiHost: 'https://api.example', sport: 'boxing', autoRecover });
    const seen: string[] = [];
    client.on('recoveryStarted', data => seen.push(`started ${data.estimatedMessages}`));
    client.on('recoveryCompleted', () => seen.push('completed'));
    client.on('error', err => seen.push(`error ${err.message}`));
    client.on('snapshotComplete', event => replayed.push(event));

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
    return { client, calls, callsOnFirstConnect, seen, replayed };
  }

  it('asks for everything since the last alive before the drop, into the new consumer queue', async () => {
    const { client, calls, callsOnFirstConnect, seen } = await connectDropAndReconnect(true);

    assert.deepEqual(callsOnFirstConnect, [], 'the first connect has nothing to recover');
    const after = encodeURIComponent(new Date(LAST_ALIVE).toISOString());
    assert.deepEqual(calls, [
      `POST https://api.example/sos/recovery/1/initiate_request?after=${after}&consumer_queue=amq.gen-second`,
      'GET https://api.example/sos/recovery/1/status?request_id=req-1',
    ]);
    assert.deepEqual(seen, ['started 2', 'completed']);
    await client.disconnect();
  });

  it('marks the replayed snapshot_complete with its original key and message id', async () => {
    const { client, replayed } = await connectDropAndReconnect(true);
    assert.deepEqual((replayed[0] as { meta: unknown }).meta, {
      messageId: 'sc-req-1',
      routingKey: 'system.live.snapshot_complete.-',
      replayed: true,
    });
    await client.disconnect();
  });

  it('asks for nothing when autoRecover is off', async () => {
    const { client, calls } = await connectDropAndReconnect(false);
    assert.deepEqual(calls, []);
    await client.disconnect();
  });
});

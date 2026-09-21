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

  async function connectDropAndReconnect(autoRecover: boolean) {
    const brokers = [fakeBroker('amq.gen-first'), fakeBroker('amq.gen-second')];
    const [first] = brokers;
    mock.method(amqplib, 'connect', async () => brokers.shift()!.connection as never);
    const calls = stubRecoveryApi();
    const client = new SosClient({ accessToken: 'key', amqpHost: 'amqp://broker', apiHost: 'https://api.example', sport: 'boxing', autoRecover });
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
    return { client, calls, callsOnFirstConnect, seen };
  }

  it('asks for everything since the last alive before the drop, into the new consumer queue', async () => {
    const { client, calls, callsOnFirstConnect, seen } = await connectDropAndReconnect(true);

    assert.deepEqual(callsOnFirstConnect, [], 'the first connect has nothing to recover');
    const after = encodeURIComponent(new Date(LAST_ALIVE).toISOString());
    assert.deepEqual(calls, [
      `POST https://api.example/sos-api/recovery/1/initiate_request?after=${after}&consumer_queue=amq.gen-second`,
      'GET https://api.example/sos-api/recovery/1/status?request_id=req-1',
    ]);
    assert.deepEqual(seen, ['started 2', 'completed']);
    await client.disconnect();
  });

  it('asks for nothing when autoRecover is off', async () => {
    const { client, calls } = await connectDropAndReconnect(false);
    assert.deepEqual(calls, []);
    await client.disconnect();
  });
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import amqplib from 'amqplib';
import { AmqpConnection } from '../../src/amqp/connection';
import { AmqpConsumer } from '../../src/amqp/consumer';
import { SosClient } from '../../src/client';

// The slice of amqplib the SDK touches, faked: a connection that emits close, a channel that records.
function fakeBroker() {
  const channel = {
    bindings: [] as [string, string, string][],
    acked: 0,
    cancelled: [] as string[],
    closed: false,
    handler: null as ((msg: unknown) => void) | null,
    async assertQueue() { return { queue: 'amq.gen-1' }; },
    async bindQueue(queue: string, exchange: string, pattern: string) { channel.bindings.push([queue, exchange, pattern]); },
    async consume(_queue: string, handler: (msg: unknown) => void) { channel.handler = handler; return { consumerTag: 'tag-1' }; },
    ack() { channel.acked += 1; },
    async cancel(tag: string) { channel.cancelled.push(tag); },
    async close() { channel.closed = true; },
  };
  const connection = Object.assign(new EventEmitter(), {
    closed: false,
    async createChannel() { return channel; },
    async close() { connection.closed = true; },
  });
  return { channel, connection };
}

const deliver = (channel: ReturnType<typeof fakeBroker>['channel'], xml: string, routingKey = 'boxing.live.odds_change.sr:match:1') =>
  channel.handler?.({ content: Buffer.from(xml), fields: { routingKey }, properties: { headers: {} } });

describe('AmqpConnection', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    mock.method(console, 'error', () => {});
    mock.method(console, 'log', () => {});
  });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  it('connects, exposes the channel, reconnects after a close, and disconnects for good on request', async () => {
    const first = fakeBroker();
    const second = fakeBroker();
    const brokers = [first, second];
    const connect = mock.method(amqplib, 'connect', async () => brokers.shift()!.connection as never);
    const amqp = new AmqpConnection('amqp://broker');
    const seen: string[] = [];
    amqp.on('connected', () => seen.push('connected'));
    amqp.on('disconnected', () => seen.push('disconnected'));

    await amqp.connect();
    assert.equal(amqp.isConnected, true);
    assert.equal(amqp.getChannel(), first.channel);
    first.connection.emit('error', new Error('broker hiccup'));
    assert.equal(amqp.isConnected, true, 'an error alone does not drop the channel; a close does');

    first.connection.emit('close');
    assert.equal(amqp.isConnected, false);
    mock.timers.tick(5_000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(connect.mock.callCount(), 2);
    assert.equal(amqp.getChannel(), second.channel);
    assert.deepEqual(seen, ['connected', 'disconnected', 'connected']);

    await amqp.disconnect();
    assert.equal(second.channel.closed, true);
    assert.equal(second.connection.closed, true);
    second.connection.emit('close');
    mock.timers.tick(5_000);
    assert.equal(connect.mock.callCount(), 2, 'no reconnect after an intentional disconnect');
  });

  it('keeps retrying when the broker refuses, and disconnecting before any connection is harmless', async () => {
    const connect = mock.method(amqplib, 'connect', async () => { throw new Error('refused'); });
    const amqp = new AmqpConnection('amqp://broker');
    await amqp.connect();
    assert.equal(amqp.isConnected, false);
    mock.timers.tick(5_000);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(connect.mock.callCount(), 2);
    await amqp.disconnect();
  });
});

describe('AmqpConsumer', () => {
  afterEach(() => mock.restoreAll());

  it('declares an exclusive queue, binds every pattern, acks what it emits, and cancels on stop', async () => {
    const { channel } = fakeBroker();
    const consumer = new AmqpConsumer({ getChannel: () => channel } as unknown as AmqpConnection, 'swa.sos', ['boxing.live.#', 'system.live.alive.#']);
    const messages: { xml: string; routingKey: string }[] = [];
    consumer.on('message', m => messages.push(m));

    await consumer.start();
    assert.deepEqual(channel.bindings, [['amq.gen-1', 'swa.sos', 'boxing.live.#'], ['amq.gen-1', 'swa.sos', 'system.live.alive.#']]);
    deliver(channel, '<alive product="1" timestamp="1" subscribed="1"/>', 'system.live.alive.-');
    channel.handler?.(null);
    assert.deepEqual(messages, [{ xml: '<alive product="1" timestamp="1" subscribed="1"/>', routingKey: 'system.live.alive.-', headers: {} }]);
    assert.equal(channel.acked, 1);

    await consumer.stop();
    assert.deepEqual(channel.cancelled, ['tag-1']);
    await consumer.stop();
  });

  it('refuses to start without a channel, and stop tolerates a broker that rejects the cancel', async () => {
    const consumer = new AmqpConsumer({ getChannel: () => null } as unknown as AmqpConnection, 'swa.sos', []);
    await assert.rejects(consumer.start(), { message: 'AMQP not connected' });
    const { channel } = fakeBroker();
    channel.cancel = async () => { throw new Error('gone'); };
    const started = new AmqpConsumer({ getChannel: () => channel } as unknown as AmqpConnection, 'swa.sos', []);
    await started.start();
    await started.stop();
  });
});

describe('SosClient over the feed', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    mock.method(console, 'error', () => {});
    mock.method(console, 'log', () => {});
  });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  it('binds the sport, turns each message into its typed event, and feeds alives to recovery', async () => {
    const broker = fakeBroker();
    mock.method(amqplib, 'connect', async () => broker.connection as never);
    const client = new SosClient({ accessToken: 'key', amqpHost: 'amqp://broker', apiHost: 'https://api.example', sport: 'boxing' });
    const seen: string[] = [];
    for (const name of ['connected', 'disconnected', 'oddsChange', 'betSettlement', 'betStop', 'betCancel', 'fixtureChange', 'snapshotComplete', 'alive', 'recoveryStarted', 'recoveryCompleted', 'error'] as const) {
      client.on(name, () => seen.push(name));
    }

    await client.connect();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(broker.channel.bindings.map(b => b[2]), ['boxing.live.#', 'system.live.alive.#']);
    deliver(broker.channel, '<odds_change product="1" event_id="sr:match:1" timestamp="1"><odds/></odds_change>');
    deliver(broker.channel, '<bet_settlement product="1" event_id="sr:match:1" timestamp="2"><outcomes/></bet_settlement>');
    deliver(broker.channel, '<bet_stop product="1" event_id="sr:match:1" timestamp="3"/>');
    deliver(broker.channel, '<bet_cancel product="1" event_id="sr:match:1" timestamp="4"/>');
    deliver(broker.channel, '<fixture_change product="1" event_id="sr:match:1" timestamp="5"/>');
    deliver(broker.channel, '<snapshot_complete product="1" request_id="r" timestamp="6"/>');
    deliver(broker.channel, '<alive product="1" timestamp="7" subscribed="1"/>');
    deliver(broker.channel, '<fixtures/>');
    deliver(broker.channel, 'not xml at all <');
    assert.deepEqual(seen, ['connected', 'oddsChange', 'betSettlement', 'betStop', 'betCancel', 'fixtureChange', 'snapshotComplete', 'alive']);

    broker.connection.emit('close');
    assert.equal(seen.at(-1), 'disconnected');
    await client.disconnect();
  });

  it('reports a consumer that cannot start, and reads market descriptions with the key', async () => {
    const broker = fakeBroker();
    broker.channel.assertQueue = async () => { throw new Error('no queues'); };
    mock.method(amqplib, 'connect', async () => broker.connection as never);
    const client = new SosClient({ accessToken: 'key', amqpHost: 'amqp://broker', apiHost: 'https://api.example' });
    const errors: string[] = [];
    client.on('error', err => errors.push(err.message));
    await client.connect();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(errors, ['no queues']);

    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => { calls.push(url); return new Response(JSON.stringify({ markets: [] })); });
    assert.deepEqual(await client.getMarketDescriptions(), { markets: [] });
    assert.deepEqual(calls, ['https://api.example/sos-api/v1/descriptions/markets/json']);
    await client.disconnect();
  });
});

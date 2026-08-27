import { EventEmitter } from 'events';
import { SwaUofClient } from '../client';
import { AmqpConnection } from '../amqp/connection';
import { AmqpConsumer } from '../amqp/consumer';

jest.mock('../amqp/connection');
jest.mock('../amqp/consumer');

const ConnectionMock = AmqpConnection as unknown as jest.Mock;
const ConsumerMock = AmqpConsumer as unknown as jest.Mock;

class FakeConnection extends EventEmitter {
  connect = jest.fn().mockResolvedValue(undefined);
  disconnect = jest.fn().mockResolvedValue(undefined);
}

class FakeConsumer extends EventEmitter {
  start = jest.fn().mockResolvedValue(undefined);
  stop = jest.fn().mockResolvedValue(undefined);
}

const built: SwaUofClient[] = [];

function build() {
  const connection = new FakeConnection();
  const consumer = new FakeConsumer();
  ConnectionMock.mockImplementation(() => connection);
  ConsumerMock.mockImplementation(() => consumer);

  const client = new SwaUofClient({
    accessToken: 'swa_key',
    amqpHost: 'amqp://localhost',
    apiHost: 'https://feed.probet.live',
    autoRecover: false,
  });

  built.push(client);
  return { client, connection, consumer };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('SwaUofClient lifecycle', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Connecting starts the recovery monitor's interval; leaving it would leak.
    await Promise.all(built.splice(0).map(client => client.disconnect()));
    jest.restoreAllMocks();
  });

  it('binds to the feed and to alive by default', () => {
    build();
    expect(ConsumerMock).toHaveBeenCalledWith(expect.anything(), 'swa.uof', [
      'mma.live.#',
      'system.live.alive.#',
    ]);
  });

  it('honours explicit binding patterns', () => {
    ConnectionMock.mockImplementation(() => new FakeConnection());
    ConsumerMock.mockImplementation(() => new FakeConsumer());

    const client = new SwaUofClient({
      accessToken: 'k',
      amqpHost: 'amqp://localhost',
      apiHost: 'https://feed.probet.live',
      bindingPatterns: ['mma.live.odds_change.#'],
    });
    built.push(client);

    expect(ConsumerMock).toHaveBeenLastCalledWith(expect.anything(), 'swa.uof', [
      'mma.live.odds_change.#',
    ]);
  });

  it('starts consuming once the AMQP connection opens', async () => {
    const { client, connection, consumer } = build();
    const connected = jest.fn();
    client.on('connected', connected);

    await client.connect();
    connection.emit('connected');
    await flush();

    expect(consumer.start).toHaveBeenCalled();
    expect(connected).toHaveBeenCalled();
  });

  it('reports a consumer that will not start', async () => {
    const { client, connection, consumer } = build();
    consumer.start.mockRejectedValue(new Error('no channel'));
    const errors: Error[] = [];
    client.on('error', err => errors.push(err));

    connection.emit('connected');
    await flush();

    expect(errors[0].message).toBe('no channel');
  });

  it('passes a drop on to the caller', async () => {
    const { client, connection } = build();
    const disconnected = jest.fn();
    client.on('disconnected', disconnected);

    connection.emit('disconnected');

    expect(disconnected).toHaveBeenCalled();
  });

  it('emits a typed event for each feed message', async () => {
    const { client, consumer } = build();
    const seen: string[] = [];
    client.on('oddsChange', () => seen.push('oddsChange'));
    client.on('betSettlement', () => seen.push('betSettlement'));
    client.on('betStop', () => seen.push('betStop'));
    client.on('alive', () => seen.push('alive'));
    client.on('fixtureChange', () => seen.push('fixtureChange'));
    client.on('snapshotComplete', () => seen.push('snapshotComplete'));
    client.on('betCancel', () => seen.push('betCancel'));

    consumer.emit('message', {
      xml: '<odds_change product="1" event_id="sr:match:1" timestamp="1"><odds/></odds_change>',
    });
    consumer.emit('message', {
      xml: '<bet_settlement product="1" event_id="sr:match:1" timestamp="1"><outcomes/></bet_settlement>',
    });
    consumer.emit('message', {
      xml: '<bet_stop product="1" event_id="sr:match:1" timestamp="1"><groups>all</groups></bet_stop>',
    });
    consumer.emit('message', { xml: '<alive product="1" timestamp="1" subscribed="1"/>' });
    consumer.emit('message', {
      xml: '<fixture_change event_id="sr:match:1" product="1" timestamp="1"/>',
    });
    consumer.emit('message', {
      xml: '<snapshot_complete request_id="r1" product="1" timestamp="1"/>',
    });
    consumer.emit('message', {
      xml: '<bet_cancel event_id="sr:match:1" product="1" timestamp="1"/>',
    });

    expect(seen).toEqual([
      'oddsChange',
      'betSettlement',
      'betStop',
      'alive',
      'fixtureChange',
      'snapshotComplete',
      'betCancel',
    ]);
  });

  it('ignores a message it cannot recognise', () => {
    const { client, consumer } = build();
    const seen = jest.fn();
    client.on('oddsChange', seen);

    consumer.emit('message', { xml: '<something_else/>' });
    consumer.emit('message', { xml: 'not xml at all' });

    expect(seen).not.toHaveBeenCalled();
  });

  it('shuts the consumer and the connection down', async () => {
    const { client, connection, consumer } = build();

    await client.disconnect();

    expect(consumer.stop).toHaveBeenCalled();
    expect(connection.disconnect).toHaveBeenCalled();
  });

  it('passes a recovery event through to the caller', () => {
    const { client } = build();
    const started = jest.fn();
    const completed = jest.fn();
    const errors = jest.fn();
    client.on('recoveryStarted', started);
    client.on('recoveryCompleted', completed);
    client.on('error', errors);

    const manager = (client as any).recoveryManager as EventEmitter;
    manager.emit('recoveryStarted', { estimatedMessages: 5 });
    manager.emit('recoveryCompleted');
    manager.emit('error', new Error('boom'));

    expect(started).toHaveBeenCalledWith({ estimatedMessages: 5 });
    expect(completed).toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  });
});

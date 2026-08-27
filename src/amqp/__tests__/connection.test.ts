import { EventEmitter } from 'events';
import amqplib from 'amqplib';
import { AmqpConnection } from '../connection';

jest.mock('amqplib');

class FakeConnection extends EventEmitter {
  channel = { close: jest.fn().mockResolvedValue(undefined) };
  close = jest.fn().mockResolvedValue(undefined);
  createChannel = jest.fn().mockResolvedValue(this.channel);
}

const connect = amqplib.connect as unknown as jest.Mock;

describe('AmqpConnection', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    connect.mockReset();
  });

  it('opens a channel and announces the connection', async () => {
    const fake = new FakeConnection();
    connect.mockResolvedValue(fake);
    const connection = new AmqpConnection('amqp://localhost');
    const connected = jest.fn();
    connection.on('connected', connected);

    await connection.connect();

    expect(connected).toHaveBeenCalled();
    expect(connection.isConnected).toBe(true);
    expect(connection.getChannel()).toBe(fake.channel);
  });

  it('announces a drop and reconnects', async () => {
    jest.useFakeTimers();
    const fake = new FakeConnection();
    connect.mockResolvedValue(fake);
    const connection = new AmqpConnection('amqp://localhost');
    const disconnected = jest.fn();
    connection.on('disconnected', disconnected);

    await connection.connect();
    fake.emit('close');

    expect(disconnected).toHaveBeenCalled();
    expect(connection.isConnected).toBe(false);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('logs a broker error without dropping the channel', async () => {
    const fake = new FakeConnection();
    connect.mockResolvedValue(fake);
    const connection = new AmqpConnection('amqp://localhost');

    await connection.connect();
    fake.emit('error', new Error('broker unhappy'));

    expect(connection.isConnected).toBe(true);
  });

  it('schedules a retry when the first connection fails', async () => {
    jest.useFakeTimers();
    connect.mockRejectedValueOnce(new Error('refused')).mockResolvedValue(new FakeConnection());
    const connection = new AmqpConnection('amqp://localhost');

    await connection.connect();
    expect(connection.isConnected).toBe(false);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('stops reconnecting once disconnected on purpose', async () => {
    jest.useFakeTimers();
    const fake = new FakeConnection();
    connect.mockResolvedValue(fake);
    const connection = new AmqpConnection('amqp://localhost');

    await connection.connect();
    await connection.disconnect();

    expect(connection.isConnected).toBe(false);
    expect(fake.close).toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('swallows errors raised while closing', async () => {
    const fake = new FakeConnection();
    fake.close.mockRejectedValue(new Error('already gone'));
    connect.mockResolvedValue(fake);
    const connection = new AmqpConnection('amqp://localhost');

    await connection.connect();
    await expect(connection.disconnect()).resolves.toBeUndefined();
  });
});

import { AmqpConsumer } from '../consumer';
import { AmqpConnection } from '../connection';

function buildChannel() {
  return {
    assertQueue: jest.fn().mockResolvedValue({ queue: 'amq.gen-1' }),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'tag-1' }),
    cancel: jest.fn().mockResolvedValue(undefined),
    ack: jest.fn(),
  };
}

function build(channel: ReturnType<typeof buildChannel> | null) {
  const connection = { getChannel: () => channel } as unknown as AmqpConnection;
  return new AmqpConsumer(connection, 'swa.uof', ['mma.live.#', 'system.live.alive.#']);
}

describe('AmqpConsumer', () => {
  it('declares an exclusive queue and binds every pattern', async () => {
    const channel = buildChannel();

    await build(channel).start();

    expect(channel.assertQueue).toHaveBeenCalledWith('', { exclusive: true, autoDelete: true });
    expect(channel.bindQueue.mock.calls.map(call => call[2])).toEqual([
      'mma.live.#',
      'system.live.alive.#',
    ]);
  });

  it('emits and acknowledges each delivery', async () => {
    const channel = buildChannel();
    const consumer = build(channel);
    const messages: any[] = [];
    consumer.on('message', msg => messages.push(msg));

    await consumer.start();
    const handler = channel.consume.mock.calls[0][1];

    const delivery = {
      content: Buffer.from('<alive product="1"/>'),
      fields: { routingKey: 'system.live.alive.-' },
      properties: { headers: { producerId: 1 } },
    };
    handler(delivery);

    expect(messages).toEqual([
      {
        xml: '<alive product="1"/>',
        routingKey: 'system.live.alive.-',
        headers: { producerId: 1 },
      },
    ]);
    expect(channel.ack).toHaveBeenCalledWith(delivery);
  });

  it('ignores a null delivery and a delivery with no headers', async () => {
    const channel = buildChannel();
    const consumer = build(channel);
    const messages: any[] = [];
    consumer.on('message', msg => messages.push(msg));

    await consumer.start();
    const handler = channel.consume.mock.calls[0][1];

    handler(null);
    handler({
      content: Buffer.from('<alive/>'),
      fields: { routingKey: 'k' },
      properties: {},
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].headers).toEqual({});
  });

  it('refuses to start with no channel', async () => {
    await expect(build(null).start()).rejects.toThrow('AMQP not connected');
  });

  it('cancels the consumer on stop', async () => {
    const channel = buildChannel();
    const consumer = build(channel);

    await consumer.start();
    await consumer.stop();

    expect(channel.cancel).toHaveBeenCalledWith('tag-1');
  });

  it('stops cleanly when the cancel fails or nothing was started', async () => {
    const channel = buildChannel();
    channel.cancel.mockRejectedValue(new Error('gone'));
    const consumer = build(channel);

    await consumer.start();
    await expect(consumer.stop()).resolves.toBeUndefined();

    await expect(build(null).stop()).resolves.toBeUndefined();
  });
});

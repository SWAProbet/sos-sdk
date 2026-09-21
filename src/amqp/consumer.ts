import { Channel, ConsumeMessage } from 'amqplib';
import { EventEmitter } from 'events';
import { AmqpConnection } from './connection';

export class AmqpConsumer extends EventEmitter {
  private queueName: string | null = null;
  private consumerTag: string | null = null;

  constructor(
    private connection: AmqpConnection,
    private exchange: string,
    private bindingPatterns: string[],
  ) {
    super();
  }

  // The broker's name for this connection's queue, null until started.
  get queue(): string | null {
    return this.queueName;
  }

  /**
   * Set up the queue and start consuming messages.
   */
  async start(queuePrefix: string = 'swa.sos.sdk'): Promise<void> {
    const channel = this.connection.getChannel();
    if (!channel) throw new Error('AMQP not connected');

    // Exclusive, auto-delete queue for this SDK instance
    const q = await channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    this.queueName = q.queue;

    // Bind to the exchange with the specified patterns
    for (const pattern of this.bindingPatterns) {
      await channel.bindQueue(this.queueName, this.exchange, pattern);
    }

    // Start consuming
    const { consumerTag } = await channel.consume(
      this.queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) return;

        const xml = msg.content.toString('utf-8');
        const routingKey = msg.fields.routingKey;
        const headers = msg.properties.headers || {};

        this.emit('message', { xml, routingKey, headers });
        channel.ack(msg);
      },
      { noAck: false },
    );

    this.consumerTag = consumerTag;
  }

  async stop(): Promise<void> {
    const channel = this.connection.getChannel();
    if (channel && this.consumerTag) {
      try {
        await channel.cancel(this.consumerTag);
      } catch {
        // ignore
      }
    }
    this.consumerTag = null;
    this.queueName = null;
  }
}

import amqplib, { ChannelModel, Channel } from 'amqplib';
import { EventEmitter } from 'events';

export class AmqpConnection extends EventEmitter {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isIntentionallyClosed = false;
  private readonly reconnectDelayMs = 5000;

  constructor(private readonly amqpUrl: string) {
    super();
  }

  get isConnected(): boolean {
    return this.channel !== null;
  }

  getChannel(): Channel | null {
    return this.channel;
  }

  async connect(): Promise<void> {
    this.isIntentionallyClosed = false;
    await this.attemptConnection();
  }

  async disconnect(): Promise<void> {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // ignore errors during shutdown
    }
    this.channel = null;
    this.connection = null;
  }

  private async attemptConnection(): Promise<void> {
    try {
      const conn = await amqplib.connect(this.amqpUrl);
      this.connection = conn;
      const ch = await conn.createChannel();
      this.channel = ch;

      conn.on('error', (err: Error) => {
        console.error('[SwaUofSDK:AMQP] Connection error:', err.message);
      });

      conn.on('close', () => {
        this.channel = null;
        this.connection = null;
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.emit('connected');
    } catch (err: any) {
      console.error('[SwaUofSDK:AMQP] Connection failed:', err.message);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isIntentionallyClosed) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.attemptConnection();
    }, this.reconnectDelayMs);
  }
}

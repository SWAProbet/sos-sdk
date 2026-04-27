import { EventEmitter } from 'events';
import { AmqpConnection } from './amqp/connection';
import { AmqpConsumer } from './amqp/consumer';
import { RecoveryManager } from './recovery/recoveryManager';
import { parseUofXml, detectMessageType } from './xml/parser';
import {
  SwaUofClientConfig,
  SwaUofEventMap,
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  AliveEvent,
  FixtureChangeEvent,
  SnapshotCompleteEvent,
  BetCancelEvent,
} from './types';

const DEFAULT_BINDING_PATTERNS = [
  'mma.live.#',
  'system.live.alive.#',
];

export class SwaUofClient extends EventEmitter {
  private amqpConnection: AmqpConnection;
  private consumer: AmqpConsumer;
  private recoveryManager: RecoveryManager;
  private config: Required<SwaUofClientConfig>;

  constructor(userConfig: SwaUofClientConfig) {
    super();

    this.config = {
      accessToken: userConfig.accessToken,
      amqpHost: userConfig.amqpHost,
      apiHost: userConfig.apiHost,
      bindingPatterns: userConfig.bindingPatterns || DEFAULT_BINDING_PATTERNS,
      aliveTimeoutMs: userConfig.aliveTimeoutMs ?? 30000,
      autoRecover: userConfig.autoRecover ?? true,
    };

    this.amqpConnection = new AmqpConnection(this.config.amqpHost);
    this.consumer = new AmqpConsumer(
      this.amqpConnection,
      'swa.uof',
      this.config.bindingPatterns,
    );
    this.recoveryManager = new RecoveryManager(
      this.config.apiHost,
      this.config.accessToken,
      this.config.aliveTimeoutMs,
      this.config.autoRecover,
    );

    this.wireEvents();
  }

  /**
   * Connect to the SWA UOF feed.
   */
  async connect(): Promise<void> {
    await this.amqpConnection.connect();
  }

  /**
   * Disconnect from the feed.
   */
  async disconnect(): Promise<void> {
    this.recoveryManager.stopMonitoring();
    await this.consumer.stop();
    await this.amqpConnection.disconnect();
  }

  /**
   * Type-safe event listener.
   */
  on<K extends keyof SwaUofEventMap>(
    event: K,
    listener: (data: SwaUofEventMap[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  emit<K extends keyof SwaUofEventMap>(event: K, data?: SwaUofEventMap[K]): boolean {
    return super.emit(event, data);
  }

  /**
   * Fetch market descriptions from the API (convenience method).
   */
  async getMarketDescriptions(): Promise<any> {
    const response = await fetch(
      `${this.config.apiHost}/uof-api/v1/descriptions/markets/json`,
      { headers: { 'X-API-Key': this.config.accessToken } },
    );
    return response.json();
  }

  /**
   * Fetch fixtures from the API (convenience method).
   */
  async getFixtures(date?: string): Promise<any> {
    const params = date ? `?date=${date}` : '';
    const response = await fetch(
      `${this.config.apiHost}/uof-api/v1/sports/mma/events/json${params}`,
      { headers: { 'X-API-Key': this.config.accessToken } },
    );
    return response.json();
  }

  private wireEvents(): void {
    // AMQP connection lifecycle
    this.amqpConnection.on('connected', async () => {
      console.log('[SwaUofSDK] AMQP connected');
      try {
        await this.consumer.start();
        this.recoveryManager.startMonitoring();
        this.emit('connected');
      } catch (err: any) {
        console.error('[SwaUofSDK] Failed to start consumer:', err);
        this.emit('error', err);
      }
    });

    this.amqpConnection.on('disconnected', () => {
      console.log('[SwaUofSDK] AMQP disconnected');
      this.recoveryManager.stopMonitoring();
      this.emit('disconnected');
    });

    // AMQP message handling
    this.consumer.on('message', ({ xml }: { xml: string; routingKey: string }) => {
      this.handleMessage(xml);
    });

    // Recovery events
    this.recoveryManager.on('recoveryStarted', (data) => {
      this.emit('recoveryStarted', data);
    });

    this.recoveryManager.on('recoveryCompleted', () => {
      this.emit('recoveryCompleted');
    });

    this.recoveryManager.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private handleMessage(xml: string): void {
    try {
      const msgType = detectMessageType(xml);
      const parsed = parseUofXml(xml);
      if (!parsed) return;

      switch (msgType) {
        case 'odds_change':
          this.emit('oddsChange', parsed as OddsChangeEvent);
          break;
        case 'bet_settlement':
          this.emit('betSettlement', parsed as BetSettlementEvent);
          break;
        case 'bet_stop':
          this.emit('betStop', parsed as BetStopEvent);
          break;
        case 'fixture_change':
          this.emit('fixtureChange', parsed as FixtureChangeEvent);
          break;
        case 'snapshot_complete':
          this.recoveryManager.onAlive(parsed as any);
          this.emit('snapshotComplete', parsed as SnapshotCompleteEvent);
          break;
        case 'bet_cancel':
          this.emit('betCancel', parsed as BetCancelEvent);
          break;
        case 'alive':
          this.recoveryManager.onAlive(parsed as AliveEvent);
          this.emit('alive', parsed as AliveEvent);
          break;
      }
    } catch (err: any) {
      console.error('[SwaUofSDK] Failed to parse message:', err.message);
    }
  }
}

import { EventEmitter } from 'events';
import { AmqpConnection } from './amqp/connection';
import { AmqpConsumer } from './amqp/consumer';
import { RecoveryManager } from './recovery/recoveryManager';
import { parseSosXml, detectMessageType } from './xml/parser';
import {
  SwaSosClientConfig,
  SwaSosSport,
  SwaSosEventMap,
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  AliveEvent,
} from './types';

const DEFAULT_SPORT: SwaSosSport = 'mma';

// One feed carries one sport, so bind only that sport plus the shared alive stream.
function defaultBindingPatterns(sport: SwaSosSport): string[] {
  return [`${sport}.live.#`, 'system.live.alive.#'];
}

export class SwaSosClient extends EventEmitter {
  private amqpConnection: AmqpConnection;
  private consumer: AmqpConsumer;
  private recoveryManager: RecoveryManager;
  private config: Required<SwaSosClientConfig>;

  constructor(userConfig: SwaSosClientConfig) {
    super();

    this.config = {
      accessToken: userConfig.accessToken,
      amqpHost: userConfig.amqpHost,
      apiHost: userConfig.apiHost,
      sport: userConfig.sport ?? DEFAULT_SPORT,
      bindingPatterns:
        userConfig.bindingPatterns || defaultBindingPatterns(userConfig.sport ?? DEFAULT_SPORT),
      aliveTimeoutMs: userConfig.aliveTimeoutMs ?? 30000,
      autoRecover: userConfig.autoRecover ?? true,
    };

    this.amqpConnection = new AmqpConnection(this.config.amqpHost);
    this.consumer = new AmqpConsumer(
      this.amqpConnection,
      'swa.sos',
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
  on<K extends keyof SwaSosEventMap>(
    event: K,
    listener: (data: SwaSosEventMap[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  emit<K extends keyof SwaSosEventMap>(event: K, data?: SwaSosEventMap[K]): boolean {
    return super.emit(event, data);
  }

  /**
   * Fetch market descriptions from the API (convenience method).
   */
  async getMarketDescriptions(): Promise<any> {
    const response = await fetch(
      `${this.config.apiHost}/sos-api/v1/descriptions/markets/json`,
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
      `${this.config.apiHost}/sos-api/v1/sports/${this.config.sport}/events/json${params}`,
      { headers: { 'X-API-Key': this.config.accessToken } },
    );
    return response.json();
  }

  private wireEvents(): void {
    // AMQP connection lifecycle
    this.amqpConnection.on('connected', async () => {
      console.log('[SwaSosSDK] AMQP connected');
      try {
        await this.consumer.start();
        this.recoveryManager.startMonitoring();
        this.emit('connected');
      } catch (err: any) {
        console.error('[SwaSosSDK] Failed to start consumer:', err);
        this.emit('error', err);
      }
    });

    this.amqpConnection.on('disconnected', () => {
      console.log('[SwaSosSDK] AMQP disconnected');
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
      const parsed = parseSosXml(xml);
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
        case 'alive':
          this.recoveryManager.onAlive(parsed as AliveEvent);
          this.emit('alive', parsed as AliveEvent);
          break;
      }
    } catch (err: any) {
      console.error('[SwaSosSDK] Failed to parse message:', err.message);
    }
  }
}

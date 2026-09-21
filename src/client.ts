import { EventEmitter } from 'events';
import { AmqpConnection } from './amqp/connection';
import { AmqpConsumer } from './amqp/consumer';
import { RecoveryManager } from './recovery/recoveryManager';
import { parseSosXml, detectMessageType } from './xml/parser';
import {
  EventSummary,
  Fixture,
  FixtureFilters,
  SosClientConfig,
  SosSport,
  SosEventMap,
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  BetCancelEvent,
  FixtureChangeEvent,
  SnapshotCompleteEvent,
  AliveEvent,
} from './types';

const DEFAULT_SPORT: SosSport = 'mma';

// One feed carries one sport, so bind only that sport plus the shared alive stream.
function defaultBindingPatterns(sport: SosSport): string[] {
  return [`${sport}.live.#`, 'system.live.alive.#'];
}

export class SosClient extends EventEmitter {
  private amqpConnection: AmqpConnection;
  private consumer: AmqpConsumer;
  private recoveryManager: RecoveryManager;
  private config: Required<SosClientConfig>;
  private hasConnected = false;

  constructor(userConfig: SosClientConfig) {
    super();

    this.config = {
      accessToken: userConfig.accessToken,
      amqpHost: userConfig.amqpHost,
      apiHost: userConfig.apiHost,
      apiBasePath: userConfig.apiBasePath ?? '/sos-api',
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
      this.config.apiBasePath,
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
  on<K extends keyof SosEventMap>(
    event: K,
    listener: (data: SosEventMap[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  emit<K extends keyof SosEventMap>(event: K, data?: SosEventMap[K]): boolean {
    return super.emit(event, data);
  }

  /**
   * Fetch market descriptions from the API (convenience method).
   */
  async getMarketDescriptions(): Promise<any> {
    const response = await fetch(
      `${this.apiRoot()}/v1/descriptions/markets/json`,
      { headers: { 'X-API-Key': this.config.accessToken } },
    );
    return response.json();
  }

  /**
   * Every fixture the feed holds for this sport, filtered by date, status and whether
   * the feed will price it. A bare date string is still accepted, as before.
   */
  async getFixtures(filters: FixtureFilters | string = {}): Promise<Fixture[]> {
    const query = typeof filters === 'string' ? { date: filters } : filters;
    const params = new URLSearchParams();
    if (query.date) params.set('date', query.date);
    if (query.status) params.set('status', query.status);
    if (query.isLiveOdds !== undefined) params.set('is_liveodds', String(query.isLiveOdds));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const body = await this.getJson<{ events: Fixture[] }>(`${this.fixturesPath()}/json${suffix}`);
    return body?.events ?? [];
  }

  /**
   * One fixture by its event id, or null when the feed does not hold it.
   */
  async getFixture(eventId: string): Promise<Fixture | null> {
    return this.getJson<Fixture>(`${this.fixturesPath()}/${encodeURIComponent(eventId)}`);
  }

  /**
   * The fixture plus its result and settlement state, or null when the feed does not hold it.
   */
  async getEventSummary(eventId: string): Promise<EventSummary | null> {
    return this.getJson<EventSummary>(`${this.fixturesPath()}/${encodeURIComponent(eventId)}/summary/json`);
  }

  private fixturesPath(): string {
    return `${this.apiRoot()}/v1/sports/${this.config.sport}/events`;
  }

  private apiRoot(): string {
    return `${this.config.apiHost}${this.config.apiBasePath}`;
  }

  // A 404 is an answer (nothing held), any other failure is an error.
  private async getJson<T>(url: string): Promise<T | null> {
    const response = await fetch(url, { headers: { 'X-API-Key': this.config.accessToken } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`SOS API ${response.status} for ${url}`);
    return (await response.json()) as T;
  }

  private wireEvents(): void {
    // AMQP connection lifecycle
    this.amqpConnection.on('connected', async () => {
      console.log('[SosSDK] AMQP connected');
      try {
        await this.consumer.start();
        this.recoveryManager.setConsumerQueue(this.consumer.queue);
        this.recoveryManager.startMonitoring();
        const isReconnect = this.hasConnected;
        this.hasConnected = true;
        this.emit('connected');
        // The first connect has nothing to replay; every later one has the outage.
        if (isReconnect) void this.recoveryManager.onReconnect();
      } catch (err: any) {
        console.error('[SosSDK] Failed to start consumer:', err);
        this.emit('error', err);
      }
    });

    this.amqpConnection.on('disconnected', () => {
      console.log('[SosSDK] AMQP disconnected');
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
        case 'bet_cancel':
          this.emit('betCancel', parsed as BetCancelEvent);
          break;
        case 'fixture_change':
          this.emit('fixtureChange', parsed as FixtureChangeEvent);
          break;
        case 'snapshot_complete':
          this.emit('snapshotComplete', parsed as SnapshotCompleteEvent);
          break;
        case 'alive':
          this.recoveryManager.onAlive(parsed as AliveEvent);
          this.emit('alive', parsed as AliveEvent);
          break;
      }
    } catch (err: any) {
      console.error('[SosSDK] Failed to parse message:', err.message);
    }
  }
}

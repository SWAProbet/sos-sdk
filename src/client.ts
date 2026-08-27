import { EventEmitter } from 'events';
import { AmqpConnection } from './amqp/connection';
import { AmqpConsumer } from './amqp/consumer';
import { RecoveryManager } from './recovery/recoveryManager';
import { UofApiClient } from './http/apiClient';
import {
  parseUofXml,
  detectMessageType,
  parseFixtures,
  parseProbabilities,
  parseEventSummary,
} from './xml/parser';
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
  Fixture,
  FixtureQuery,
  Probabilities,
  EventSummary,
  EventRecoveryKind,
  RecoveryRequestAccepted,
} from './types';

// This feed carries MMA; the server exposes its fixtures under that path.
const EVENTS_PATH = 'v1/sports/mma/events';

const DEFAULT_BINDING_PATTERNS = [
  'mma.live.#',
  'system.live.alive.#',
];

export class SwaUofClient extends EventEmitter {
  private amqpConnection: AmqpConnection;
  private consumer: AmqpConsumer;
  private recoveryManager: RecoveryManager;
  private api: UofApiClient;
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

    this.api = new UofApiClient(this.config.apiHost, this.config.accessToken);
    this.amqpConnection = new AmqpConnection(this.config.amqpHost);
    this.consumer = new AmqpConsumer(
      this.amqpConnection,
      'swa.uof',
      this.config.bindingPatterns,
    );
    this.recoveryManager = new RecoveryManager(
      this.api,
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
    return this.api.getJson('v1/descriptions/markets/json');
  }

  /**
   * Fixtures the feed knows about, so a partner can map event ids onto their
   * own before a card starts.
   */
  async getFixtures(query: FixtureQuery = {}): Promise<Fixture[]> {
    const xml = await this.api.getXml(EVENTS_PATH, {
      date: query.date,
      status: query.status,
      is_liveodds: query.isLiveOdds === undefined ? undefined : String(query.isLiveOdds),
    });
    return parseFixtures(xml);
  }

  /** This route serves JSON, so there is nothing to parse. */
  async getFixture(eventId: string): Promise<Fixture> {
    return this.api.getJson<Fixture>(`${EVENTS_PATH}/${eventId}`);
  }

  /**
   * Result and settlement state for one event.
   */
  async getEventSummary(eventId: string): Promise<EventSummary | null> {
    return parseEventSummary(await this.api.getXml(`${EVENTS_PATH}/${eventId}/summary`));
  }

  /**
   * Current odds for an event, returned in the HTTP response rather than over
   * the queue. Narrow to one market, or to one market and specifier set.
   */
  async getProbabilities(
    eventId: string,
    marketId?: string | number,
    specifiers?: string,
  ): Promise<Probabilities | null> {
    const path = ['v1/probabilities', eventId, marketId, specifiers]
      .filter(part => part !== undefined && part !== '')
      .join('/');
    return parseProbabilities(await this.api.getXml(path));
  }

  /**
   * Ask the server to republish the current odds for one event to this
   * partner's recovery queue.
   */
  async recoverEvent(eventId: string): Promise<RecoveryRequestAccepted> {
    return this.recoverEventMessages(eventId, 'odds');
  }

  /**
   * Ask the server to republish the settlements, bet stops and bet cancels for
   * one event.
   */
  async recoverStatefulMessages(eventId: string): Promise<RecoveryRequestAccepted> {
    return this.recoverEventMessages(eventId, 'stateful_messages');
  }

  private recoverEventMessages(
    eventId: string,
    kind: EventRecoveryKind,
  ): Promise<RecoveryRequestAccepted> {
    return this.api.post(`recovery/${kind}/events/${eventId}/initiate_request`);
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

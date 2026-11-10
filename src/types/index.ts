// Parsed UOF message types exposed to SDK consumers

export interface OddsChangeEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  sportEventStatus: SportEventStatus;
  markets: Market[];
}

export interface SportEventStatus {
  status: number;
  matchStatus: number;
  reporting: number;
  /** Score of the first competitor; the feed sends 0 where the sport keeps none. */
  homeScore?: number;
  /** Score of the second competitor; the feed sends 0 where the sport keeps none. */
  awayScore?: number;
  clock?: {
    matchTime?: string;
    /** Time left in the current period, as m:ss. */
    remainingTime?: string;
    /** True while the clock is not running, for example between periods. */
    stopped?: boolean;
    round?: number;
  };
  statistics?: CompetitorStats[];
}

export interface CompetitorStats {
  id: string;
  [key: string]: any;
}

export interface Market {
  id: number;
  specifiers?: string;
  status: number;
  outcomes: Outcome[];
}

export interface Outcome {
  id: string;
  odds?: number;
  active: boolean;
  probabilities?: number;
}

export interface BetSettlementEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  certainty: number;
  markets: SettlementMarket[];
}

export interface SettlementMarket {
  id: number;
  specifiers?: string;
  voidReason?: string;
  outcomes: SettlementOutcome[];
}

export interface SettlementOutcome {
  id: string;
  result: 'won' | 'lost' | 'void' | 'undecided';
  voidFactor?: number;
  deadHeatFactor?: number;
}

export interface BetStopEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  groups: string;
  /** Status applied to the stopped markets, in the codes a market's status uses: 0 is deactivated. */
  marketStatus?: number;
}

/** This sport's producer heartbeat. Another sport's, as a queue bound to several sports carries, is not emitted. */
export interface AliveEvent {
  productId: number;
  timestamp: number;
  subscribed: boolean;
}

export type SosSport = 'tennis' | 'tabletennis' | 'volleyball' | 'mma' | 'boxing';

export interface SosClientConfig {
  accessToken: string;
  amqpHost: string;
  apiHost: string;
  /** Path the REST API is mounted at behind apiHost. Default: /sos. */
  apiBasePath?: string;
  /** Sport this feed carries. Drives binding patterns and the fixtures path. Default: mma. */
  sport?: SosSport;
  /**
   * Binding patterns for the AMQP queue. Defaults to the sport's live messages + alive.
   * Not applied when `queue` is set: the server binds that queue.
   */
  bindingPatterns?: string[];
  /**
   * Name of your durable partner queue, `swa.sos.partner.{partnerId}`. When set, the client
   * consumes that queue by name and declares and binds nothing: partner credentials can neither
   * declare a named queue nor change its bindings. The queue carries every sport on the account,
   * but only `sport`'s heartbeat counts as this feed's, and recovery covers `sport` alone.
   * Default: an exclusive auto-delete queue per connection.
   */
  queue?: string;
  /** How long (ms) before missing alive triggers recovery. Default: 30000. */
  aliveTimeoutMs?: number;
  /** Auto-recover on reconnect. Default: true. */
  autoRecover?: boolean;
}

export interface FixtureChangeEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  /** Epoch millis of the scheduled start, when the feed knows it. */
  startTime?: number;
}

export interface BetCancelEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  startTime?: number;
  endTime?: number;
  /** `specifiers` picks out the cancelled line, in the same form as on odds_change and bet_settlement. */
  markets: Array<{ id: number; specifiers?: string; voidReason?: string | number }>;
}

export interface SnapshotCompleteEvent {
  productId: number;
  requestId: string;
  timestamp: number;
}

export type SosEventMap = {
  oddsChange: OddsChangeEvent;
  betSettlement: BetSettlementEvent;
  betStop: BetStopEvent;
  betCancel: BetCancelEvent;
  fixtureChange: FixtureChangeEvent;
  snapshotComplete: SnapshotCompleteEvent;
  alive: AliveEvent;
  connected: void;
  disconnected: void;
  recoveryStarted: { estimatedMessages: number };
  recoveryCompleted: void;
  error: Error;
};

// --- Fixtures, as /v1/sports/{sport}/events/json answers them ---

export type FixtureStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

export type CompetitorGender = 'female' | 'male';

export interface SportUrn {
  id: string;
  name: string;
}

export interface FixtureCompetitor {
  id: string;
  name: string;
  qualifier: 'home' | 'away';
  /** As SWA holds it; absent where the feed has no value. */
  gender?: CompetitorGender;
}

export interface FixtureCard {
  id: string;
  name: string | null;
}

export interface Fixture {
  /** The event id the feed publishes on odds_change and bet_settlement. */
  eventId: string;
  /** SWA's own identifier. Provisional: derived from eventId until SWA assigns it, so stable but not yet authoritative. */
  sosId: string;
  imgFightId: string | null;
  name: string;
  /** ISO 8601, or null while the feed holds no start time. */
  scheduledTime: string | null;
  status: FixtureStatus;
  competitors: FixtureCompetitor[];
  sport: SportUrn;
  card: FixtureCard | null;
  tournament: SportUrn | null;
  weightClass: string | null;
  plannedRounds: number | null;
  isLiveOdds: boolean;
  updatedAt: string;
}

export interface FixtureFilters {
  /** YYYY-MM-DD, a UTC calendar day. */
  date?: string;
  status?: FixtureStatus;
  isLiveOdds?: boolean;
}

export interface EventSummaryOutcome {
  id: string;
  /** As the feed sent it: 1 won, 0 lost, -1 void. */
  result: string;
  voidFactor?: number;
  deadHeatFactor?: number;
}

export interface EventSummaryMarket {
  id: string;
  specifiers?: string;
  voidReason?: string;
  outcomes: EventSummaryOutcome[];
}

export interface EventSummary {
  fixture: Fixture;
  settled: boolean;
  betStopped: boolean;
  markets: EventSummaryMarket[];
  lastSettlementAt: string | null;
  generatedAt: string;
}

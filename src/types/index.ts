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
  clock?: {
    matchTime?: string;
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
}

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
  /** Sport this feed carries. Drives binding patterns and the fixtures path. Default: mma. */
  sport?: SosSport;
  /** Binding patterns for the AMQP queue. Defaults to the sport's live messages + alive. */
  bindingPatterns?: string[];
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
  markets: Array<{ id: number; voidReason?: string | number }>;
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
  /** SWA's own identifier. Provisional: it changes on every response until SWA fixes it. */
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
  result: number;
  void_factor?: number;
  dead_heat_factor?: number;
}

export interface EventSummaryMarket {
  id: string;
  specifiers: string | null;
  voidReason: string | null;
  outcomes: EventSummaryOutcome[];
}

export interface EventSummary {
  fixture: Fixture;
  settled: boolean;
  settledMarkets: number;
  lastSettlementAt: string | null;
  markets: EventSummaryMarket[];
  generatedAt: string;
}

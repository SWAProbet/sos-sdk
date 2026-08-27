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

export interface FixtureChangeEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  startTime?: number;
}

export interface SnapshotCompleteEvent {
  productId: number;
  requestId: string;
  timestamp: number;
}

export interface BetCancelEvent {
  productId: number;
  eventId: string;
  timestamp: number;
  startTime?: number;
  endTime?: number;
  markets: BetCancelMarket[];
}

export interface BetCancelMarket {
  id: number;
  voidReason?: number;
}

export interface AliveEvent {
  productId: number;
  timestamp: number;
  subscribed: boolean;
}

export interface SwaUofClientConfig {
  accessToken: string;
  amqpHost: string;
  apiHost: string;
  /** Binding patterns for the AMQP queue. Defaults to all MMA + alive. */
  bindingPatterns?: string[];
  /** How long (ms) before missing alive triggers recovery. Default: 30000. */
  aliveTimeoutMs?: number;
  /** Auto-recover on reconnect. Default: true. */
  autoRecover?: boolean;
}

export type SwaUofEventMap = {
  oddsChange: OddsChangeEvent;
  betSettlement: BetSettlementEvent;
  betStop: BetStopEvent;
  fixtureChange: FixtureChangeEvent;
  snapshotComplete: SnapshotCompleteEvent;
  betCancel: BetCancelEvent;
  alive: AliveEvent;
  connected: void;
  disconnected: void;
  recoveryStarted: { estimatedMessages: number };
  recoveryCompleted: void;
  error: Error;
};

// Fixtures and query responses served over the REST API

export interface SportUrn {
  id: string;
  name: string;
}

export interface FixtureCompetitor {
  id: string;
  name: string;
  qualifier: 'home' | 'away';
}

export interface FixtureCard {
  id: string;
  name: string | null;
}

export type FixtureStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

export interface Fixture {
  eventId: string;
  name: string;
  scheduledTime: string;
  status: FixtureStatus;
  competitors: FixtureCompetitor[];
  sport: SportUrn | null;
  card: FixtureCard | null;
  tournament: SportUrn | null;
  weightClass: string | null;
  plannedRounds: number | null;
  isLiveOdds: boolean;
  /** The upstream IMG fight id, when the feed knows it. */
  imgFightId: string | null;
}

export interface FixtureQuery {
  date?: string;
  status?: FixtureStatus;
  isLiveOdds?: boolean;
}

export interface Probabilities {
  eventId: string;
  productId: number;
  timestamp: number;
  generatedAt: string;
  markets: Market[];
}

export interface EventSummary {
  eventId: string;
  status: FixtureStatus;
  settled: boolean;
  settledMarkets: number;
  lastSettlementAt: string | null;
  generatedAt: string;
  fixture: Fixture | null;
  markets: SettlementMarket[];
}

/** Which stored messages a per-event recovery replays. */
export type EventRecoveryKind = 'odds' | 'stateful_messages';

export interface RecoveryRequestAccepted {
  requestId: string;
  eventId: string;
  kind: EventRecoveryKind;
  estimatedMessages: number;
  status: string;
}

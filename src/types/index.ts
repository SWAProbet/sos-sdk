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

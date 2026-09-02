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

export type SosEventMap = {
  oddsChange: OddsChangeEvent;
  betSettlement: BetSettlementEvent;
  betStop: BetStopEvent;
  alive: AliveEvent;
  connected: void;
  disconnected: void;
  recoveryStarted: { estimatedMessages: number };
  recoveryCompleted: void;
  error: Error;
};

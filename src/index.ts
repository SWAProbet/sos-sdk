export { SwaSosClient } from './client';
export { parseSosXml, detectMessageType } from './xml/parser';

// Deprecated aliases from the UOF-era naming; prefer the Sos names.
export { SwaSosClient as SwaUofClient } from './client';
export { parseSosXml as parseUofXml } from './xml/parser';
export type {
  SwaSosClientConfig as SwaUofClientConfig,
  SwaSosEventMap as SwaUofEventMap,
  SwaSosSport as SwaUofSport,
} from './types';
export {
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  AliveEvent,
  SwaSosClientConfig,
  SwaSosEventMap,
  Market,
  Outcome,
  SettlementMarket,
  SettlementOutcome,
  SportEventStatus,
} from './types';

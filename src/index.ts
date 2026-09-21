export { SosClient, defaultBindingPatterns } from './client';
export { parseSosXml, detectMessageType } from './xml/parser';

// Deprecated aliases from the UOF-era naming; prefer the Sos names.
export { SosClient as SwaUofClient } from './client';
export { parseSosXml as parseUofXml } from './xml/parser';
export type {
  SosClientConfig as SwaUofClientConfig,
  SosEventMap as SwaUofEventMap,
  SosSport as SwaUofSport,
} from './types';
export {
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  BetCancelEvent,
  FixtureChangeEvent,
  SnapshotCompleteEvent,
  AliveEvent,
  SosClientConfig,
  SosEventMap,
  Market,
  Outcome,
  SettlementMarket,
  SettlementOutcome,
  SportEventStatus,
  Fixture,
  FixtureCompetitor,
  FixtureCard,
  FixtureFilters,
  FixtureStatus,
  CompetitorGender,
  SportUrn,
  EventSummary,
  EventSummaryMarket,
  EventSummaryOutcome,
} from './types';

import { XMLParser } from 'fast-xml-parser';
import {
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  AliveEvent,
  FixtureChangeEvent,
  SnapshotCompleteEvent,
  BetCancelEvent,
  BetCancelMarket,
  Market,
  Outcome,
  SettlementMarket,
  SettlementOutcome,
} from '../types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  isArray: (tagName) => ['market', 'outcome', 'competitor', 'result'].includes(tagName),
});

export type ParsedUofMessage =
  | OddsChangeEvent
  | BetSettlementEvent
  | BetStopEvent
  | AliveEvent
  | FixtureChangeEvent
  | SnapshotCompleteEvent
  | BetCancelEvent;

export function parseUofXml(xml: string): ParsedUofMessage | null {
  const parsed = xmlParser.parse(xml);

  if (parsed.odds_change) return parseOddsChange(parsed.odds_change);
  if (parsed.bet_settlement) return parseBetSettlement(parsed.bet_settlement);
  if (parsed.bet_stop) return parseBetStop(parsed.bet_stop);
  if (parsed.fixture_change) return parseFixtureChange(parsed.fixture_change);
  if (parsed.snapshot_complete) return parseSnapshotComplete(parsed.snapshot_complete);
  if (parsed.bet_cancel) return parseBetCancel(parsed.bet_cancel);
  if (parsed.alive) return parseAlive(parsed.alive);

  return null;
}

function parseOddsChange(oc: any): OddsChangeEvent {
  const markets: Market[] = [];

  const rawMarkets = oc.odds?.market || [];
  const marketArr = Array.isArray(rawMarkets) ? rawMarkets : [rawMarkets];

  for (const m of marketArr) {
    if (!m) continue;
    const rawOutcomes = m.outcome || [];
    const outcomeArr = Array.isArray(rawOutcomes) ? rawOutcomes : [rawOutcomes];

    const outcomes: Outcome[] = outcomeArr.map((o: any) => ({
      id: String(o['@_id']),
      odds: o['@_odds'] != null ? Number(o['@_odds']) : undefined,
      active: o['@_active'] === 1 || o['@_active'] === '1',
      probabilities: o['@_probabilities'] != null ? Number(o['@_probabilities']) : undefined,
    }));

    markets.push({
      id: Number(m['@_id']),
      specifiers: m['@_specifiers'] || undefined,
      status: Number(m['@_status']),
      outcomes,
    });
  }

  const ses = oc.sport_event_status || {};

  return {
    productId: Number(oc['@_product']),
    eventId: String(oc['@_event_id']),
    timestamp: Number(oc['@_timestamp']),
    sportEventStatus: {
      status: Number(ses['@_status'] ?? 0),
      matchStatus: Number(ses['@_match_status'] ?? 0),
      reporting: Number(ses['@_reporting'] ?? 0),
      clock: ses.clock ? {
        matchTime: ses.clock['@_match_time'],
        round: ses.clock['@_round'] != null ? Number(ses.clock['@_round']) : undefined,
      } : undefined,
    },
    markets,
  };
}

function parseBetSettlement(bs: any): BetSettlementEvent {
  const markets: SettlementMarket[] = [];

  const rawMarkets = bs.outcomes?.market || [];
  const marketArr = Array.isArray(rawMarkets) ? rawMarkets : [rawMarkets];

  for (const m of marketArr) {
    if (!m) continue;
    const rawOutcomes = m.outcome || [];
    const outcomeArr = Array.isArray(rawOutcomes) ? rawOutcomes : [rawOutcomes];

    const outcomes: SettlementOutcome[] = outcomeArr.map((o: any) => {
      const resultCode = String(o['@_result']);
      let result: SettlementOutcome['result'] = 'undecided';
      if (resultCode === '1') result = 'won';
      else if (resultCode === '0') result = 'lost';
      else if (resultCode === '-1') result = 'void';

      return {
        id: String(o['@_id']),
        result,
        voidFactor: o['@_void_factor'] != null && o['@_void_factor'] !== '' ? Number(o['@_void_factor']) : undefined,
        deadHeatFactor: o['@_dead_heat_factor'] != null && o['@_dead_heat_factor'] !== '' ? Number(o['@_dead_heat_factor']) : undefined,
      };
    });

    markets.push({
      id: Number(m['@_id']),
      specifiers: m['@_specifiers'] || undefined,
      voidReason: m['@_void_reason'] || undefined,
      outcomes,
    });
  }

  return {
    productId: Number(bs['@_product']),
    eventId: String(bs['@_event_id']),
    timestamp: Number(bs['@_timestamp']),
    certainty: Number(bs['@_certainty'] ?? 1),
    markets,
  };
}

function parseBetStop(stop: any): BetStopEvent {
  return {
    productId: Number(stop['@_product']),
    eventId: String(stop['@_event_id']),
    timestamp: Number(stop['@_timestamp']),
    groups: String(stop.groups || 'all'),
  };
}

function parseAlive(alive: any): AliveEvent {
  return {
    productId: Number(alive['@_product']),
    timestamp: Number(alive['@_timestamp']),
    subscribed: alive['@_subscribed'] === 1 || alive['@_subscribed'] === '1',
  };
}

function parseFixtureChange(fc: any): FixtureChangeEvent {
  return {
    productId: Number(fc['@_product']),
    eventId: String(fc['@_event_id']),
    timestamp: Number(fc['@_timestamp']),
    startTime: fc['@_start_time'] != null ? Number(fc['@_start_time']) : undefined,
  };
}

function parseSnapshotComplete(sc: any): SnapshotCompleteEvent {
  return {
    productId: Number(sc['@_product']),
    requestId: String(sc['@_request_id']),
    timestamp: Number(sc['@_timestamp']),
  };
}

function parseBetCancel(bc: any): BetCancelEvent {
  const rawMarkets = bc.market || [];
  const marketArr = Array.isArray(rawMarkets) ? rawMarkets : [rawMarkets];

  const markets: BetCancelMarket[] = marketArr
    .filter((m: any) => m != null)
    .map((m: any) => ({
      id: Number(m['@_id']),
      voidReason: m['@_void_reason'] != null ? Number(m['@_void_reason']) : undefined,
    }));

  return {
    productId: Number(bc['@_product']),
    eventId: String(bc['@_event_id']),
    timestamp: Number(bc['@_timestamp']),
    startTime: bc['@_start_time'] != null ? Number(bc['@_start_time']) : undefined,
    endTime: bc['@_end_time'] != null ? Number(bc['@_end_time']) : undefined,
    markets,
  };
}

/**
 * Detect message type from raw XML without full parse.
 */
export function detectMessageType(xml: string): string | null {
  if (xml.includes('<odds_change')) return 'odds_change';
  if (xml.includes('<bet_settlement')) return 'bet_settlement';
  if (xml.includes('<bet_stop')) return 'bet_stop';
  if (xml.includes('<fixture_change')) return 'fixture_change';
  if (xml.includes('<snapshot_complete')) return 'snapshot_complete';
  if (xml.includes('<bet_cancel')) return 'bet_cancel';
  if (xml.includes('<alive')) return 'alive';
  return null;
}

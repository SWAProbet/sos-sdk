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
  Fixture,
  FixtureStatus,
  Probabilities,
  EventSummary,
  SportUrn,
} from '../types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  isArray: (tagName) =>
    ['market', 'outcome', 'competitor', 'result', 'sport_event', 'reference_id'].includes(tagName),
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

/**
 *  * Parses the <fixtures> list the /v1/sports/<sport>/events endpoint returns.
 */
export function parseFixtures(xml: string): Fixture[] {
  const root = xmlParser.parse(xml)?.fixtures;
  if (!root) return [];
  return asArray(root.sport_event).map(parseSportEvent);
}

/**
 * Parses the <probabilities_response> the odds query endpoints return.
 */
export function parseProbabilities(xml: string): Probabilities | null {
  const root = xmlParser.parse(xml)?.probabilities_response;
  if (!root) return null;

  return {
    eventId: String(root['@_event_id'] ?? ''),
    productId: Number(root['@_product'] ?? 0),
    timestamp: Number(root['@_timestamp'] ?? 0),
    generatedAt: String(root['@_generated_at'] ?? ''),
    markets: asArray(root.odds?.market).map(parseMarket),
  };
}

/**
 * Parses the <summary_response> the event summary endpoint returns.
 */
export function parseEventSummary(xml: string): EventSummary | null {
  const root = xmlParser.parse(xml)?.summary_response;
  if (!root) return null;

  const sportEvent = asArray(root.sport_event)[0];
  const status = root.sport_event_status ?? {};
  const fixture = sportEvent ? parseSportEvent(sportEvent) : null;

  return {
    eventId: fixture?.eventId ?? '',
    status: String(status['@_status'] ?? 'SCHEDULED') as FixtureStatus,
    settled: String(status['@_settled']) === 'true',
    settledMarkets: Number(status['@_settled_markets'] ?? 0),
    lastSettlementAt: optionalText(status['@_last_settlement_at']),
    generatedAt: String(root['@_generated_at'] ?? ''),
    fixture,
    markets: asArray(root.settlements?.market).map(parseSettlementMarket),
  };
}

function parseSportEvent(event: any): Fixture {
  return {
    eventId: String(event['@_id'] ?? ''),
    name: String(event['@_name'] ?? ''),
    scheduledTime: String(event['@_scheduled'] ?? ''),
    status: String(event['@_status'] ?? 'SCHEDULED') as FixtureStatus,
    competitors: asArray(event.competitors?.competitor).map((c: any) => ({
      id: String(c['@_id']),
      name: String(c['@_name'] ?? ''),
      qualifier: c['@_qualifier'] === 'away' ? 'away' : 'home',
    })),
    sport: parseUrn(event.sport),
    card: event.card
      ? { id: String(event.card['@_id']), name: optionalText(event.card['@_name']) }
      : null,
    tournament: parseUrn(event.tournament),
    weightClass: optionalText(event['@_weight_class']),
    plannedRounds: event['@_planned_rounds'] != null ? Number(event['@_planned_rounds']) : null,
    isLiveOdds: String(event['@_is_liveodds']) === 'true',
    imgFightId: parseImgFightId(event),
  };
}

function parseMarket(market: any): Market {
  return {
    id: Number(market['@_id']),
    specifiers: market['@_specifiers'] != null ? String(market['@_specifiers']) : undefined,
    status: Number(market['@_status'] ?? 0),
    outcomes: asArray(market.outcome).map((o: any) => ({
      id: String(o['@_id']),
      odds: o['@_odds'] != null ? Number(o['@_odds']) : undefined,
      active: o['@_active'] === 1 || o['@_active'] === '1',
      probabilities: o['@_probabilities'] != null ? Number(o['@_probabilities']) : undefined,
    })),
  };
}

function parseSettlementMarket(market: any): SettlementMarket {
  return {
    id: Number(market['@_id']),
    specifiers: market['@_specifiers'] != null ? String(market['@_specifiers']) : undefined,
    voidReason: market['@_void_reason'] != null ? String(market['@_void_reason']) : undefined,
    outcomes: asArray(market.outcome).map((o: any) => ({
      id: String(o['@_id']),
      result: toResult(String(o['@_result'])),
      voidFactor: o['@_void_factor'] != null ? Number(o['@_void_factor']) : undefined,
      deadHeatFactor: o['@_dead_heat_factor'] != null ? Number(o['@_dead_heat_factor']) : undefined,
    })),
  };
}

function parseImgFightId(event: any): string | null {
  const references = asArray(event.reference_ids?.reference_id);
  const img = references.find((r: any) => String(r['@_name']) === 'img');
  return img ? String(img['@_value']) : null;
}

function parseUrn(node: any): SportUrn | null {
  if (!node) return null;
  return { id: String(node['@_id'] ?? ''), name: String(node['@_name'] ?? '') };
}

function toResult(code: string): SettlementOutcome['result'] {
  if (code === '1') return 'won';
  if (code === '0') return 'lost';
  if (code === '-1') return 'void';
  return 'undecided';
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function asArray(value: unknown): any[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

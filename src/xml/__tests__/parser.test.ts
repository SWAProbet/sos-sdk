import {
  detectMessageType,
  parseEventSummary,
  parseFixtures,
  parseProbabilities,
  parseUofXml,
} from '../parser';
import { FIXTURES_XML, PROBABILITIES_XML, SUMMARY_XML } from './samples';
import {
  BetCancelEvent,
  BetSettlementEvent,
  BetStopEvent,
  FixtureChangeEvent,
  OddsChangeEvent,
  SnapshotCompleteEvent,
} from '../../types';

const ODDS_CHANGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<odds_change product="1" event_id="sr:match:1" timestamp="1756296000000">
  <sport_event_status status="1" match_status="1" reporting="1">
    <clock match_time="02:30" round="2"/>
  </sport_event_status>
  <odds>
    <market id="186" status="1">
      <outcome id="sr:outcome:4" odds="1.8" active="1" probabilities="0.55"/>
    </market>
  </odds>
</odds_change>`;

describe('parseUofXml', () => {
  it('parses an odds_change', () => {
    const parsed = parseUofXml(ODDS_CHANGE_XML) as OddsChangeEvent;

    expect(parsed).toMatchObject({ productId: 1, eventId: 'sr:match:1' });
    expect(parsed.sportEventStatus.clock).toEqual({ matchTime: '02:30', round: 2 });
    expect(parsed.markets[0].outcomes[0]).toEqual({
      id: 'sr:outcome:4',
      odds: 1.8,
      active: true,
      probabilities: 0.55,
    });
  });

  it('parses a bet_settlement', () => {
    const parsed = parseUofXml(
      '<bet_settlement product="1" event_id="sr:match:1" timestamp="1" certainty="1"><outcomes>' +
        '<market id="186"><outcome id="sr:outcome:4" result="1"/><outcome id="sr:outcome:5" result="-1" void_factor="0.5"/></market>' +
        '</outcomes></bet_settlement>',
    ) as BetSettlementEvent;

    expect(parsed.markets[0].outcomes.map(o => o.result)).toEqual(['won', 'void']);
    expect(parsed.markets[0].outcomes[1].voidFactor).toBe(0.5);
  });

  it('parses a bet_stop and an alive', () => {
    const stop = parseUofXml('<bet_stop product="1" event_id="sr:match:1" timestamp="1"><groups>all</groups></bet_stop>') as BetStopEvent;
    expect(stop.groups).toBe('all');

    expect(parseUofXml('<alive product="1" timestamp="1" subscribed="1"/>')).toEqual({
      productId: 1,
      timestamp: 1,
      subscribed: true,
    });
  });

  it('returns null for anything it does not recognise', () => {
    expect(parseUofXml('<something_else/>')).toBeNull();
  });
});

describe('parseUofXml, this branch\'s extra message types', () => {
  it('parses a fixture_change', () => {
    const parsed = parseUofXml(
      '<fixture_change event_id="sr:match:1" product="1" start_time="1756749900000" timestamp="1756749000000"/>',
    ) as FixtureChangeEvent;

    expect(parsed).toEqual({
      eventId: 'sr:match:1',
      productId: 1,
      startTime: 1756749900000,
      timestamp: 1756749000000,
    });
  });

  it('parses a fixture_change with no start time', () => {
    const parsed = parseUofXml(
      '<fixture_change event_id="sr:match:1" product="1" timestamp="1"/>',
    ) as FixtureChangeEvent;

    expect(parsed.startTime).toBeUndefined();
  });

  it('parses a snapshot_complete', () => {
    const parsed = parseUofXml(
      '<snapshot_complete request_id="acme-1" timestamp="1" product="3"/>',
    ) as SnapshotCompleteEvent;

    expect(parsed).toMatchObject({ requestId: 'acme-1', productId: 3, timestamp: 1 });
  });

  it('parses a bet_cancel with its markets and window', () => {
    const parsed = parseUofXml(
      '<bet_cancel event_id="sr:match:1" product="1" timestamp="1" start_time="10" end_time="20">' +
        '<market id="186" void_reason="4"/><market id="911"/>' +
        '</bet_cancel>',
    ) as BetCancelEvent;

    expect(parsed).toMatchObject({ eventId: 'sr:match:1', startTime: 10, endTime: 20 });
    expect(parsed.markets).toEqual([
      { id: 186, voidReason: 4 },
      { id: 911, voidReason: undefined },
    ]);
  });

  it('parses a bet_cancel with no window and no markets', () => {
    const parsed = parseUofXml(
      '<bet_cancel event_id="sr:match:1" product="1" timestamp="1"/>',
    ) as BetCancelEvent;

    expect(parsed.startTime).toBeUndefined();
    expect(parsed.endTime).toBeUndefined();
    expect(parsed.markets).toEqual([]);
  });
});

describe('detectMessageType', () => {
  it('names each feed message type', () => {
    expect(detectMessageType(ODDS_CHANGE_XML)).toBe('odds_change');
    expect(detectMessageType('<bet_settlement/>')).toBe('bet_settlement');
    expect(detectMessageType('<bet_stop/>')).toBe('bet_stop');
    expect(detectMessageType('<alive/>')).toBe('alive');
    expect(detectMessageType('<fixture_change/>')).toBe('fixture_change');
    expect(detectMessageType('<snapshot_complete/>')).toBe('snapshot_complete');
    expect(detectMessageType('<bet_cancel/>')).toBe('bet_cancel');
    expect(detectMessageType('<fixtures/>')).toBeNull();
  });
});

describe('parseFixtures', () => {
  it('parses a full fixture', () => {
    const [fixture] = parseFixtures(FIXTURES_XML);

    expect(fixture).toEqual({
      eventId: 'sr:match:63471857',
      name: 'JENKINS, JACK vs TAVERAS, RAMON',
      scheduledTime: '2026-09-01T18:00:00.000Z',
      status: 'SCHEDULED',
      competitors: [
        { id: 'sr:competitor:940927', name: 'JENKINS, JACK', qualifier: 'home' },
        { id: 'sr:competitor:1020023', name: 'TAVERAS, RAMON', qualifier: 'away' },
      ],
      sport: { id: 'sr:sport:117', name: 'Mixed Martial Arts' },
      card: { id: '1618', name: 'UFC 320' },
      tournament: { id: 'sr:tournament:4123', name: 'UFC' },
      weightClass: 'Featherweight',
      plannedRounds: 3,
      isLiveOdds: true,
      imgFightId: '9384',
    });
  });

  it('parses a fixture the feed knows little about', () => {
    const [, sparse] = parseFixtures(FIXTURES_XML);

    expect(sparse).toMatchObject({
      eventId: 'sr:match:2',
      competitors: [],
      card: null,
      tournament: null,
      weightClass: null,
      plannedRounds: null,
      isLiveOdds: false,
      imgFightId: null,
    });
  });

  it('returns an empty list for an empty response', () => {
    expect(parseFixtures('<fixtures count="0"/>')).toEqual([]);
    expect(parseFixtures('<something_else/>')).toEqual([]);
  });
});

describe('parseProbabilities', () => {
  it('parses the odds out of the response body', () => {
    const probabilities = parseProbabilities(PROBABILITIES_XML);

    expect(probabilities).toMatchObject({
      eventId: 'sr:match:63471857',
      productId: 1,
      timestamp: 1756296000000,
      generatedAt: '2026-09-01T18:05:00.000Z',
    });
    expect(probabilities?.markets[0].outcomes).toEqual([
      { id: 'sr:outcome:4', odds: 1.8, active: true, probabilities: 0.55 },
      { id: 'sr:outcome:5', odds: undefined, active: false, probabilities: undefined },
    ]);
    expect(probabilities?.markets[1]).toEqual({
      id: 1510,
      specifiers: 'total=2.5|roundnr=1',
      status: -1,
      outcomes: [],
    });
  });

  it('returns null for anything else', () => {
    expect(parseProbabilities('<something_else/>')).toBeNull();
  });
});

describe('parseEventSummary', () => {
  it('parses the result and settlement state', () => {
    const summary = parseEventSummary(SUMMARY_XML);

    expect(summary).toMatchObject({
      eventId: 'sr:match:63471857',
      status: 'FINISHED',
      settled: true,
      settledMarkets: 2,
      lastSettlementAt: '2026-09-01T19:00:00.000Z',
      generatedAt: '2026-09-01T19:05:00.000Z',
    });
    expect(summary?.fixture?.name).toBe('JENKINS, JACK vs TAVERAS, RAMON');
    expect(summary?.markets[0].outcomes.map(o => o.result)).toEqual(['won', 'lost']);
    expect(summary?.markets[1]).toMatchObject({
      id: 1510,
      specifiers: 'total=2.5|roundnr=1',
      voidReason: 'fight_cancelled',
    });
    expect(summary?.markets[1].outcomes[0]).toEqual({
      id: 'sr:outcome:12',
      result: 'void',
      voidFactor: 0.5,
      deadHeatFactor: 0.25,
    });
  });

  it('parses an unsettled summary', () => {
    const summary = parseEventSummary(
      '<summary_response generated_at="t"><sport_event id="sr:match:1"/>' +
        '<sport_event_status status="IN_PROGRESS" settled="false" settled_markets="0"/></summary_response>',
    );

    expect(summary).toMatchObject({
      settled: false,
      settledMarkets: 0,
      lastSettlementAt: null,
      markets: [],
    });
  });

  it('returns null for anything else', () => {
    expect(parseEventSummary('<something_else/>')).toBeNull();
  });
});

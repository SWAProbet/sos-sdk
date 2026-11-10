import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectMessageType, parseSosXml } from '../../src/xml/parser';
import { BetCancelEvent, BetSettlementEvent, BetStopEvent, OddsChangeEvent } from '../../src/types';

// As the server publishes them today, declaration and layout included.
const ODDS_CHANGE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odds_change product="1" event_id="match:76234538" timestamp="1794110509112">
  <sport_event_status status="1" match_status="1" reporting="1" home_score="0" away_score="0">
    <clock match_time="01:29" remaining_time="3:31" stopped="false" round="3"/>
  </sport_event_status>
  <odds>
      <market status="1" id="186">
        <outcome id="4" odds="1.285714286" probabilities="0.7777777776049383" active="1"/>
        <outcome id="5" odds="4.6" probabilities="0.2173913043478261" active="1"/>
      </market>
      <market status="1" id="1511" specifiers="total=4.5|round=3">
        <outcome id="13" odds="2.75" probabilities="0.36363636363636365" active="0"/>
        <outcome id="12" odds="1.5" probabilities="0.6666666666666666" active="1"/>
      </market>
      <market status="-1" id="1511" specifiers="total=14.5|round=3">
        <outcome id="13" probabilities="0" active="0"/>
        <outcome id="12" probabilities="0" active="0"/>
      </market>
  </odds>
</odds_change>`;

const BET_STOP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<bet_stop groups="all" market_status="0" product="1" event_id="match:76234538" timestamp="1794110855027"/>`;

const BET_CANCEL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<bet_cancel event_id="match:76234538" product="1" timestamp="1794238386257">
  <market id="1511" specifiers="total=4.5|round=3" void_reason="NO_RESULT_ASSIGNABLE"/>
  <market id="1511" specifiers="total=9.5|round=3"/>
  <market id="186"/>
</bet_cancel>`;

const statusOf = (attributes: string, clock = '') =>
  (parseSosXml(`<odds_change product="1" event_id="match:1" timestamp="1"><sport_event_status ${attributes}>${clock}</sport_event_status><odds/></odds_change>`) as OddsChangeEvent).sportEventStatus;

describe('detectMessageType', () => {
  it('names each message by its root element, and nothing for anything else', () => {
    for (const type of ['odds_change', 'bet_settlement', 'bet_stop', 'bet_cancel', 'fixture_change', 'snapshot_complete', 'alive']) {
      assert.equal(detectMessageType(`<${type} product="1"/>`), type);
    }
    assert.equal(detectMessageType('<fixtures/>'), null);
  });
});

describe('parseSosXml', () => {
  it('reads an odds change with its markets, outcomes and clock', () => {
    const event = parseSosXml(`<?xml version="1.0"?>
      <odds_change product="1" event_id="sr:match:1" timestamp="1700000000000">
        <sport_event_status status="1" match_status="6" reporting="1"><clock match_time="1:30" round="2"/></sport_event_status>
        <odds>
          <market id="186" status="1"><outcome id="outcome:4" odds="1.5" active="1" probabilities="0.62"/><outcome id="outcome:5" odds="2.6" active="0"/></market>
          <market id="1510" status="1" specifiers="total=3.5|round=1"><outcome id="outcome:12" active="1"/></market>
        </odds>
      </odds_change>`) as OddsChangeEvent;

    assert.equal(event.eventId, 'sr:match:1');
    assert.equal(event.productId, 1);
    assert.deepEqual(event.sportEventStatus, {
      status: 1, matchStatus: 6, reporting: 1, homeScore: undefined, awayScore: undefined,
      clock: { matchTime: '1:30', remainingTime: undefined, stopped: undefined, round: 2 },
    });
    assert.equal(event.markets.length, 2);
    assert.deepEqual(event.markets[0].outcomes[0], { id: 'outcome:4', odds: 1.5, active: true, probabilities: 0.62 });
    assert.equal(event.markets[0].outcomes[1].active, false);
    assert.equal(event.markets[1].specifiers, 'total=3.5|round=1');
    assert.equal(event.markets[1].outcomes[0].odds, undefined);
  });

  it('reads an odds change with no markets and no clock', () => {
    const event = parseSosXml('<odds_change product="1" event_id="sr:match:2" timestamp="1"><odds/></odds_change>') as OddsChangeEvent;
    assert.deepEqual(event.markets, []);
    assert.equal(event.sportEventStatus.clock, undefined);
  });

  it('reads the scores and the whole clock off a published odds change', () => {
    const event = parseSosXml(ODDS_CHANGE) as OddsChangeEvent;

    assert.equal(event.eventId, 'match:76234538');
    assert.equal(event.timestamp, 1794110509112);
    assert.deepEqual(event.sportEventStatus, {
      status: 1, matchStatus: 1, reporting: 1, homeScore: 0, awayScore: 0,
      clock: { matchTime: '01:29', remainingTime: '3:31', stopped: false, round: 3 },
    });
    assert.deepEqual(event.markets.map(m => [m.id, m.specifiers]), [
      [186, undefined], [1511, 'total=4.5|round=3'], [1511, 'total=14.5|round=3'],
    ]);
  });

  it('reads a stopped clock as true, a running one as false, and neither when the feed does not say', () => {
    assert.equal(statusOf('status="1"', '<clock match_time="05:00" remaining_time="0:00" stopped="true" round="1"/>').clock?.stopped, true);
    assert.equal(statusOf('status="1"', '<clock match_time="00:01" remaining_time="4:59" stopped="false" round="2"/>').clock?.stopped, false);
    // The other two spellings an XML boolean has.
    assert.equal(statusOf('status="1"', '<clock match_time="05:00" stopped="1"/>').clock?.stopped, true);
    assert.equal(statusOf('status="1"', '<clock match_time="00:01" stopped="0"/>').clock?.stopped, false);
    assert.equal(statusOf('status="1"', '<clock match_time="00:01" stopped="maybe"/>').clock?.stopped, undefined);

    const before = statusOf('status="0"', '<clock match_time="0:00" remaining_time="5:00" stopped="true"/>');
    assert.deepEqual(before.clock, { matchTime: '0:00', remainingTime: '5:00', stopped: true, round: undefined });
  });

  it('reads a score as a number, zero included, and as nothing when it is missing or not one', () => {
    const live = statusOf('status="1" home_score="2" away_score="0"');
    assert.equal(live.homeScore, 2);
    assert.equal(live.awayScore, 0);

    const unscored = statusOf('status="1" home_score="" away_score="n/a"');
    assert.equal(unscored.homeScore, undefined);
    assert.equal(unscored.awayScore, undefined);
  });

  it('reads a settlement with won, lost, void and undecided outcomes and the factors', () => {
    const event = parseSosXml(`<bet_settlement product="1" event_id="sr:match:1" timestamp="2" certainty="2"><outcomes>
        <market id="186"><outcome id="a" result="1"/><outcome id="b" result="0"/></market>
        <market id="911" specifiers="total=1.5" void_reason="no contest"><outcome id="c" result="-1" void_factor="0.5" dead_heat_factor="1"/><outcome id="d" result="9"/></market>
      </outcomes></bet_settlement>`) as BetSettlementEvent;

    assert.equal(event.certainty, 2);
    assert.deepEqual(event.markets[0].outcomes.map(o => o.result), ['won', 'lost']);
    assert.deepEqual(event.markets[1].outcomes.map(o => o.result), ['void', 'undecided']);
    assert.equal(event.markets[1].outcomes[0].voidFactor, 0.5);
    assert.equal(event.markets[1].outcomes[0].deadHeatFactor, 1);
    assert.equal(event.markets[1].voidReason, 'no contest');
    assert.equal(event.markets[1].specifiers, 'total=1.5');
  });

  it('reads a bet stop, a bet cancel, a fixture change, a snapshot complete and an alive', () => {
    assert.deepEqual(parseSosXml('<bet_stop product="1" event_id="sr:match:1" timestamp="3"><groups>all</groups></bet_stop>'), {
      productId: 1, eventId: 'sr:match:1', timestamp: 3, groups: 'all', marketStatus: undefined,
    });
    const cancel = parseSosXml('<bet_cancel product="1" event_id="sr:match:1" timestamp="4" start_time="1" end_time="2"><market id="186" void_reason="x"/><market id="911"/></bet_cancel>') as BetCancelEvent;
    assert.deepEqual(cancel.markets, [{ id: 186, specifiers: undefined, voidReason: 'x' }, { id: 911, specifiers: undefined, voidReason: undefined }]);
    assert.equal(cancel.startTime, 1);
    assert.deepEqual(parseSosXml('<fixture_change product="1" event_id="sr:match:1" timestamp="5" start_time="6"/>'), {
      productId: 1, eventId: 'sr:match:1', timestamp: 5, startTime: 6,
    });
    assert.deepEqual(parseSosXml('<snapshot_complete product="1" request_id="req-1" timestamp="7"/>'), {
      productId: 1, requestId: 'req-1', timestamp: 7,
    });
    assert.deepEqual(parseSosXml('<alive product="1" timestamp="8" subscribed="1"/>'), { productId: 1, timestamp: 8, subscribed: true });
    assert.equal(parseSosXml('<fixtures/>'), null);
  });

  it('reads the groups and the market status off a published bet stop, where both are attributes', () => {
    assert.deepEqual(parseSosXml(BET_STOP), {
      productId: 1, eventId: 'match:76234538', timestamp: 1794110855027, groups: 'all', marketStatus: 0,
    });

    // Anything but "all" shows the attribute is what was read, not the default.
    const partial = parseSosXml('<bet_stop groups="winner|totals" market_status="-1" product="1" event_id="match:1" timestamp="3"/>') as BetStopEvent;
    assert.equal(partial.groups, 'winner|totals');
    assert.equal(partial.marketStatus, -1);
    assert.equal((parseSosXml('<bet_stop groups="7" product="1" event_id="match:1" timestamp="3"/>') as BetStopEvent).groups, '7');
  });

  it('still reads groups from the child element older servers send, and falls back to all', () => {
    const older = parseSosXml('<bet_stop product="1" event_id="match:1" timestamp="3"><groups>winner</groups></bet_stop>') as BetStopEvent;
    assert.equal(older.groups, 'winner');
    assert.equal(older.marketStatus, undefined);

    const bare = parseSosXml('<bet_stop product="1" event_id="match:1" timestamp="3"/>') as BetStopEvent;
    assert.equal(bare.groups, 'all');
    assert.equal(bare.marketStatus, undefined);

    const empty = parseSosXml('<bet_stop groups="" market_status="" product="1" event_id="match:1" timestamp="3"/>') as BetStopEvent;
    assert.equal(empty.groups, 'all');
    assert.equal(empty.marketStatus, undefined);
  });

  it('says which line of a market a bet cancel reverses', () => {
    const cancel = parseSosXml(BET_CANCEL) as BetCancelEvent;

    assert.equal(cancel.eventId, 'match:76234538');
    assert.deepEqual(cancel.markets, [
      { id: 1511, specifiers: 'total=4.5|round=3', voidReason: 'NO_RESULT_ASSIGNABLE' },
      { id: 1511, specifiers: 'total=9.5|round=3', voidReason: undefined },
      { id: 186, specifiers: undefined, voidReason: undefined },
    ]);

    // The point of it: among the lines an odds change priced, only the cancelled ones match.
    const priced = (parseSosXml(ODDS_CHANGE) as OddsChangeEvent).markets;
    const reversed = priced.filter(market => cancel.markets.some(c => c.id === market.id && c.specifiers === market.specifiers));
    assert.deepEqual(reversed.map(m => [m.id, m.specifiers]), [[186, undefined], [1511, 'total=4.5|round=3']]);
  });

  it('reads a bet cancel of a single line as a list of one', () => {
    const cancel = parseSosXml('<bet_cancel event_id="match:1" product="1" timestamp="4"><market id="1511" specifiers="total=4.5|round=3"/></bet_cancel>') as BetCancelEvent;
    assert.deepEqual(cancel.markets, [{ id: 1511, specifiers: 'total=4.5|round=3', voidReason: undefined }]);
  });
});

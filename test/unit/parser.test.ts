import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectMessageType, parseSosXml } from '../../src/xml/parser';
import { BetCancelEvent, BetSettlementEvent, OddsChangeEvent } from '../../src/types';

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
    assert.deepEqual(event.sportEventStatus, { status: 1, matchStatus: 6, reporting: 1, clock: { matchTime: '1:30', round: 2 } });
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
      productId: 1, eventId: 'sr:match:1', timestamp: 3, groups: 'all',
    });
    const cancel = parseSosXml('<bet_cancel product="1" event_id="sr:match:1" timestamp="4" start_time="1" end_time="2"><market id="186" void_reason="x"/><market id="911"/></bet_cancel>') as BetCancelEvent;
    assert.deepEqual(cancel.markets, [{ id: 186, voidReason: 'x' }, { id: 911, voidReason: undefined }]);
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
});

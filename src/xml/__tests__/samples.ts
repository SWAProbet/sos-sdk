// XML captured from the server's own views, so the parser is tested against
// exactly what a partner receives.

export const FIXTURES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<fixtures count="2">
  <sport_event id="sr:match:63471857" name="JENKINS, JACK vs TAVERAS, RAMON" scheduled="2026-09-01T18:00:00.000Z" status="SCHEDULED" is_liveodds="true" weight_class="Featherweight" planned_rounds="3">
    <sport id="sr:sport:117" name="Mixed Martial Arts"/>
    <tournament id="sr:tournament:4123" name="UFC"/>
    <card id="1618" name="UFC 320"/>
    <competitors>
      <competitor id="sr:competitor:940927" name="JENKINS, JACK" qualifier="home"/>
      <competitor id="sr:competitor:1020023" name="TAVERAS, RAMON" qualifier="away"/>
    </competitors>
    <reference_ids>
      <reference_id name="img" value="9384"/>
    </reference_ids>
  </sport_event>
  <sport_event id="sr:match:2" name="JENKINS, JACK vs TAVERAS, RAMON" scheduled="2026-09-01T18:00:00.000Z" status="SCHEDULED" is_liveodds="false">
    <sport id="sr:sport:117" name="Mixed Martial Arts"/>
  </sport_event>
</fixtures>`;

export const SUMMARY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<summary_response generated_at="2026-09-01T19:05:00.000Z">
  <sport_event id="sr:match:63471857" name="JENKINS, JACK vs TAVERAS, RAMON" scheduled="2026-09-01T18:00:00.000Z" status="FINISHED" is_liveodds="true" weight_class="Featherweight" planned_rounds="3">
    <sport id="sr:sport:117" name="Mixed Martial Arts"/>
  </sport_event>
  <sport_event_status status="FINISHED" settled="true" settled_markets="2" last_settlement_at="2026-09-01T19:00:00.000Z"/>
  <settlements>
    <market id="186">
      <outcome id="sr:outcome:4" result="1"/>
      <outcome id="sr:outcome:5" result="0"/>
    </market>
    <market id="1510" specifiers="total=2.5|roundnr=1" void_reason="fight_cancelled">
      <outcome id="sr:outcome:12" result="-1" void_factor="0.5" dead_heat_factor="0.25"/>
    </market>
  </settlements>
</summary_response>`;

export const PROBABILITIES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<probabilities_response response_code="OK" generated_at="2026-09-01T18:05:00.000Z" product="1" event_id="sr:match:63471857" timestamp="1756296000000">
  <odds>
    <market id="186" status="1">
      <outcome id="sr:outcome:4" active="1" odds="1.8" probabilities="0.55"/>
      <outcome id="sr:outcome:5" active="0"/>
    </market>
    <market id="1510" specifiers="total=2.5|roundnr=1" status="-1"/>
  </odds>
</probabilities_response>`;

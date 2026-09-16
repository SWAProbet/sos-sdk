import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { SosClient } from '../../src/client';

// The API, stubbed at fetch: what the client asks for and how it reads the answer.
type Call = { url: string; headers: Record<string, string> };

function stubFetch(status: number, body: unknown): { calls: Call[] } {
  const calls: Call[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { calls };
}

const client = (sport?: 'boxing' | 'mma') =>
  new SosClient({ accessToken: 'key', amqpHost: 'amqp://unused', apiHost: 'https://api.example', sport });

const FIXTURE = {
  eventId: 'sr:match:72065192',
  sosId: '0b1f6c2e-3a4d-4c5e-9f70-1a2b3c4d5e6f',
  imgFightId: null,
  name: 'Katie Taylor vs Flora Pili',
  scheduledTime: null,
  status: 'SCHEDULED',
  competitors: [
    { id: 'sr:competitor:301560', name: 'TAYLOR, KATIE', qualifier: 'home', gender: 'female' },
    { id: 'sr:competitor:1361688', name: 'PILI, FLORA', qualifier: 'away' },
  ],
  sport: { id: 'sr:sport:10', name: 'Boxing' },
  card: null,
  tournament: null,
  weightClass: 'Jr. Welterweight',
  plannedRounds: null,
  isLiveOdds: true,
  updatedAt: '2026-09-16T18:15:19.780Z',
};

describe('fixtures through the SDK', () => {
  afterEach(() => mock.restoreAll());

  it('lists fixtures for the client sport, writing the wire names for the filters', async () => {
    const { calls } = stubFetch(200, { events: [FIXTURE] });

    const fixtures = await client('boxing').getFixtures({ date: '2026-09-15', status: 'SCHEDULED', isLiveOdds: true });

    assert.equal(calls[0].url, 'https://api.example/sos-api/v1/sports/boxing/events/json?date=2026-09-15&status=SCHEDULED&is_liveodds=true');
    assert.equal(calls[0].headers['X-API-Key'], 'key');
    assert.deepEqual(fixtures, [FIXTURE]);
    assert.equal(fixtures[0].competitors[0].gender, 'female');
    assert.equal(fixtures[0].competitors[1].gender, undefined);
    assert.equal(fixtures[0].scheduledTime, null);
  });

  it('still takes a bare date, as the old signature did, and defaults the sport to mma', async () => {
    const { calls } = stubFetch(200, { events: [] });
    assert.deepEqual(await client().getFixtures('2026-09-01'), []);
    assert.equal(calls[0].url, 'https://api.example/sos-api/v1/sports/mma/events/json?date=2026-09-01');
    await client().getFixtures();
    assert.equal(calls[1].url, 'https://api.example/sos-api/v1/sports/mma/events/json');
  });

  it('reads one fixture, escaping the id in the path, and answers null for one the feed does not hold', async () => {
    const found = stubFetch(200, FIXTURE);
    assert.deepEqual(await client('boxing').getFixture('sr:match:72065192'), FIXTURE);
    assert.equal(found.calls[0].url, 'https://api.example/sos-api/v1/sports/boxing/events/sr%3Amatch%3A72065192');
    mock.restoreAll();

    stubFetch(404, { error: 'Event not found' });
    assert.equal(await client('boxing').getFixture('sr:match:0'), null);
  });

  it('reads an event summary as JSON, and null when there is none', async () => {
    const summary = { fixture: FIXTURE, settled: true, settledMarkets: 2, lastSettlementAt: '2026-09-15T19:12:04.000Z', markets: [], generatedAt: '2026-09-15T19:15:00.000Z' };
    const { calls } = stubFetch(200, summary);
    assert.deepEqual(await client('boxing').getEventSummary('sr:match:72065192'), summary);
    assert.equal(calls[0].url, 'https://api.example/sos-api/v1/sports/boxing/events/sr%3Amatch%3A72065192/summary/json');
    mock.restoreAll();

    stubFetch(404, { error: 'Event not found' });
    assert.equal(await client('boxing').getEventSummary('sr:match:0'), null);
  });

  it('turns any other failure into an error naming the status and the url', async () => {
    stubFetch(500, { error: 'mongo unreachable' });
    await assert.rejects(client('boxing').getFixtures(), { message: /SOS API 500 for https:\/\/api\.example/ });
  });
});

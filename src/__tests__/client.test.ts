import { SwaUofClient } from '../client';
import { FIXTURES_XML, PROBABILITIES_XML, SUMMARY_XML } from '../xml/__tests__/samples';

jest.mock('../amqp/connection');
jest.mock('../amqp/consumer');

function build(): SwaUofClient {
  return new SwaUofClient({
    accessToken: 'swa_key',
    amqpHost: 'amqp://localhost',
    apiHost: 'https://feed.probet.live',
  });
}

function mockFetch(body: string | object): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => String(body),
    json: async () => body,
  });
  (global as any).fetch = fetchMock;
  return fetchMock;
}

function requestedUrl(fetchMock: jest.Mock): string {
  return fetchMock.mock.calls[0][0] as string;
}

describe('SwaUofClient queries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists fixtures as typed objects', async () => {
    const fetchMock = mockFetch(FIXTURES_XML);

    const fixtures = await build().getFixtures();

    expect(requestedUrl(fetchMock)).toBe(
      'https://feed.probet.live/uof-api/v1/sports/mma/events',
    );
    expect(fixtures).toHaveLength(2);
    expect(fixtures[0].card).toEqual({ id: '1618', name: 'UFC 320' });
  });

  it('passes the fixture filters through', async () => {
    const fetchMock = mockFetch(FIXTURES_XML);

    await build().getFixtures({ date: '2026-09-01', status: 'SCHEDULED', isLiveOdds: true });

    const url = requestedUrl(fetchMock);
    expect(url).toContain('date=2026-09-01');
    expect(url).toContain('status=SCHEDULED');
    expect(url).toContain('is_liveodds=true');
  });

  it('fetches one fixture as JSON, which is what that route serves', async () => {
    const fetchMock = mockFetch({ eventId: 'sr:match:63471857', name: 'A vs B' });

    const fixture = await build().getFixture('sr:match:63471857');

    expect(requestedUrl(fetchMock)).toContain('/events/sr%3Amatch%3A63471857');
    expect(fixture.eventId).toBe('sr:match:63471857');
  });

  it('fetches an event summary', async () => {
    const fetchMock = mockFetch(SUMMARY_XML);

    const summary = await build().getEventSummary('sr:match:63471857');

    expect(requestedUrl(fetchMock)).toContain('/summary');
    expect(summary?.settled).toBe(true);
  });

  it('fetches probabilities for a whole event', async () => {
    const fetchMock = mockFetch(PROBABILITIES_XML);

    const probabilities = await build().getProbabilities('sr:match:63471857');

    expect(requestedUrl(fetchMock)).toBe(
      'https://feed.probet.live/uof-api/v1/probabilities/sr%3Amatch%3A63471857',
    );
    expect(probabilities?.markets).toHaveLength(2);
  });

  it('narrows probabilities to a market and a specifier set', async () => {
    const fetchMock = mockFetch(PROBABILITIES_XML);

    await build().getProbabilities('sr:match:1', 1510, 'total=2.5|roundnr=1');

    expect(requestedUrl(fetchMock)).toContain('/1510/total%3D2.5%7Croundnr%3D1');
  });

  it('requests an odds recovery for one event', async () => {
    const fetchMock = mockFetch({ requestId: 'r1', kind: 'odds' });

    const result = await build().recoverEvent('sr:match:1');

    expect(requestedUrl(fetchMock)).toContain('/recovery/odds/events/sr%3Amatch%3A1/initiate_request');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(result.kind).toBe('odds');
  });

  it('requests a stateful messages recovery for one event', async () => {
    const fetchMock = mockFetch({ requestId: 'r2', kind: 'stateful_messages' });

    await build().recoverStatefulMessages('sr:match:1');

    expect(requestedUrl(fetchMock)).toContain(
      '/recovery/stateful_messages/events/sr%3Amatch%3A1/initiate_request',
    );
  });

  it('fetches the market descriptions as JSON', async () => {
    const fetchMock = mockFetch({ markets: [] });

    await build().getMarketDescriptions();

    expect(requestedUrl(fetchMock)).toContain('/v1/descriptions/markets/json');
  });
});

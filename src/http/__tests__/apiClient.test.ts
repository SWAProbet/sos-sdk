import { UofApiClient } from '../apiClient';

function mockFetch(response: Partial<Response>): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, ...response });
  (global as any).fetch = fetchMock;
  return fetchMock;
}

describe('UofApiClient', () => {
  const client = new UofApiClient('https://feed.probet.live', 'swa_key');

  afterEach(() => jest.restoreAllMocks());

  it('builds a URL under the API base path', () => {
    expect(client.url('v1/sports/mma/events')).toBe(
      'https://feed.probet.live/uof-api/v1/sports/mma/events',
    );
  });

  it('encodes the colons in a Sportradar event id', () => {
    expect(client.url('v1/probabilities/sr:match:1')).toBe(
      'https://feed.probet.live/uof-api/v1/probabilities/sr%3Amatch%3A1',
    );
  });

  it('encodes the pipe in a specifier segment', () => {
    expect(client.url('v1/probabilities/sr:match:1/1510/total=2.5|roundnr=1')).toContain(
      '1510/total%3D2.5%7Croundnr%3D1',
    );
  });

  it('adds only the query parameters that have a value', () => {
    const url = client.url('v1/sports/mma/events', { date: '2026-09-01', status: undefined });
    expect(url).toBe('https://feed.probet.live/uof-api/v1/sports/mma/events?date=2026-09-01');
  });

  it('sends the partner key on every request', async () => {
    const fetchMock = mockFetch({ text: async () => '<fixtures/>' } as Partial<Response>);

    await client.getXml('v1/sports/mma/events');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://feed.probet.live/uof-api/v1/sports/mma/events',
      { method: 'GET', headers: { 'X-API-Key': 'swa_key' } },
    );
  });

  it('returns parsed JSON from a GET', async () => {
    mockFetch({ json: async () => ({ events: [] }) } as Partial<Response>);
    expect(await client.getJson('v1/sports/mma/events/json')).toEqual({ events: [] });
  });

  it('posts and returns the accepted body', async () => {
    const fetchMock = mockFetch({ json: async () => ({ requestId: 'r1' }) } as Partial<Response>);

    const result = await client.post('recovery/odds/events/sr:match:1/initiate_request');

    expect(result).toEqual({ requestId: 'r1' });
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('throws with the status when the server refuses', async () => {
    mockFetch({ ok: false, status: 401, statusText: 'Unauthorized' });

    await expect(client.getXml('v1/sports/mma/events')).rejects.toThrow(
      'failed: 401 Unauthorized',
    );
  });

  it('honours a non-default base path', () => {
    const other = new UofApiClient('https://feed.probet.live', 'k', '/uof');
    expect(other.url('health')).toBe('https://feed.probet.live/uof/health');
  });
});

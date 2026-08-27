/**
 * Thin wrapper over the SWA UOF REST API. Holds the base URL and the partner
 * key so no caller has to assemble a request by hand.
 */
export class UofApiClient {
  constructor(
    private readonly apiHost: string,
    private readonly accessToken: string,
    private readonly basePath: string = '/uof-api',
  ) {}

  async getXml(path: string, query?: Record<string, string | undefined>): Promise<string> {
    const response = await this.request('GET', path, query);
    return response.text();
  }

  async getJson<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const response = await this.request('GET', path, query);
    return response.json() as Promise<T>;
  }

  async post<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const response = await this.request('POST', path, query);
    return response.json() as Promise<T>;
  }

  url(path: string, query?: Record<string, string | undefined>): string {
    const segments = path.split('/').filter(Boolean).map(encodeURIComponent);
    const url = new URL(`${this.basePath}/${segments.join('/')}`, this.apiHost);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private async request(
    method: string,
    path: string,
    query?: Record<string, string | undefined>,
  ): Promise<Response> {
    const url = this.url(path, query);

    const response = await fetch(url, {
      method,
      headers: { 'X-API-Key': this.accessToken },
    });

    if (!response.ok) {
      throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }
}

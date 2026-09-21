import { EventEmitter } from 'events';
import { AliveEvent } from '../types';

// The producer asked when no alive has named one yet: the live producer.
const DEFAULT_PRODUCER_ID = 1;

interface RecoveryRequest {
  producerId: number;
  requestId: string;
  estimatedMessages: number;
}

export class RecoveryManager extends EventEmitter {
  // Local clock, for the silence timer only. Restarted on every connect.
  private lastAliveAt: number = Date.now();
  // Per producer, the feed's own timestamp on its last alive: where a replay starts.
  private checkpoints = new Map<number, number>();
  // What a replay in flight, or one that failed, still has to start from.
  private owed: Map<number, number> | null = null;
  private monitoringSince: number | null = null;
  private lastAttemptAt = 0;
  private consumerQueue: string | null = null;
  private monitorTimer: NodeJS.Timeout | null = null;
  private isRecovering = false;

  constructor(
    private apiHost: string,
    private accessToken: string,
    private aliveTimeoutMs: number,
    private autoRecover: boolean,
    private apiBasePath: string = '/sos-api',
  ) {
    super();
  }

  /**
   * Start monitoring alive messages. The silence timer restarts on each connect; the
   * checkpoints do not, because they say where the feed was last heard from.
   */
  startMonitoring(): void {
    this.lastAliveAt = Date.now();
    this.monitoringSince ??= Date.now();
    if (this.monitorTimer) return;

    this.monitorTimer = setInterval(() => {
      if (!this.autoRecover || this.isRecovering) return;
      if (Date.now() - this.lastAttemptAt < this.aliveTimeoutMs) return;

      const elapsed = Date.now() - this.lastAliveAt;
      if (elapsed > this.aliveTimeoutMs) {
        console.warn(`[SosSDK:Recovery] No alive for ${elapsed}ms, triggering recovery`);
        void this.triggerRecovery();
      } else if (this.owed) {
        console.warn('[SosSDK:Recovery] Retrying the recovery that failed');
        void this.triggerRecovery();
      }
    }, 5000);
  }

  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  // The queue this connection consumes from, so the server can replay into it.
  setConsumerQueue(queue: string | null): void {
    this.consumerQueue = queue;
  }

  /**
   * Called when an alive message is received.
   */
  onAlive(event: AliveEvent): void {
    this.lastAliveAt = Date.now();
    const feedTime = Number.isFinite(event.timestamp) && event.timestamp > 0 ? event.timestamp : Date.now();
    this.checkpoints.set(event.productId, feedTime);
  }

  /**
   * Called on reconnect: requests everything since the last alive before the drop.
   */
  async onReconnect(): Promise<void> {
    if (!this.autoRecover) return;
    await this.triggerRecovery();
  }

  private async triggerRecovery(): Promise<void> {
    if (this.isRecovering) return;
    this.isRecovering = true;
    this.lastAttemptAt = Date.now();
    // Held until a replay succeeds, so alives arriving meanwhile cannot move the start.
    this.owed ??= this.recoveryPoints();

    try {
      const requests: RecoveryRequest[] = [];
      for (const [producerId, after] of this.owed) {
        requests.push(await this.initiate(producerId, after));
      }
      this.emit('recoveryStarted', {
        estimatedMessages: requests.reduce((total, request) => total + request.estimatedMessages, 0),
      });

      for (const request of requests) {
        await this.pollRecoveryStatus(request);
      }
      this.owed = null;
      this.emit('recoveryCompleted');
    } catch (err) {
      console.error('[SosSDK:Recovery] Error:', err);
      this.emit('error', err);
    } finally {
      this.isRecovering = false;
    }
  }

  // Every producer heard from, or the live producer from the first connect when none was.
  private recoveryPoints(): Map<number, number> {
    if (this.checkpoints.size > 0) return new Map(this.checkpoints);
    return new Map([[DEFAULT_PRODUCER_ID, this.monitoringSince ?? this.lastAliveAt]]);
  }

  private async initiate(producerId: number, after: number): Promise<RecoveryRequest> {
    const params = `after=${encodeURIComponent(new Date(after).toISOString())}`;
    const queue = this.consumerQueue ? `&consumer_queue=${encodeURIComponent(this.consumerQueue)}` : '';
    const url = `${this.apiHost}${this.apiBasePath}/recovery/${producerId}/initiate_request?${params}${queue}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': this.accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Recovery request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { requestId: string; estimatedMessages: number };
    return { producerId, requestId: result.requestId, estimatedMessages: result.estimatedMessages };
  }

  private async pollRecoveryStatus(request: RecoveryRequest): Promise<void> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));

      let status: { status: string };
      try {
        const url = `${this.apiHost}${this.apiBasePath}/recovery/${request.producerId}/status?request_id=${encodeURIComponent(request.requestId)}`;
        const response = await fetch(url, {
          headers: { 'X-API-Key': this.accessToken },
        });

        if (!response.ok) continue;
        status = await response.json() as { status: string };
      } catch {
        continue;
      }

      if (status.status === 'completed') return;
      if (status.status === 'failed') throw new Error('Recovery failed on server');
    }

    throw new Error('Recovery polling timed out');
  }
}

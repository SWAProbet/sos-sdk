import { EventEmitter } from 'events';
import { AliveEvent } from '../types';

export class RecoveryManager extends EventEmitter {
  private lastAliveAt: number = Date.now();
  private monitorTimer: NodeJS.Timeout | null = null;
  private isRecovering = false;

  constructor(
    private apiHost: string,
    private accessToken: string,
    private aliveTimeoutMs: number,
    private autoRecover: boolean,
  ) {
    super();
  }

  /**
   * Start monitoring alive messages.
   */
  startMonitoring(): void {
    this.lastAliveAt = Date.now();
    if (this.monitorTimer) return;

    this.monitorTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastAliveAt;
      if (elapsed > this.aliveTimeoutMs && !this.isRecovering && this.autoRecover) {
        console.warn(`[SwaUofSDK:Recovery] No alive for ${elapsed}ms, triggering recovery`);
        this.triggerRecovery();
      }
    }, 5000);
  }

  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /**
   * Called when an alive message is received.
   */
  onAlive(_event: AliveEvent): void {
    this.lastAliveAt = Date.now();
  }

  /**
   * Called on reconnect: requests recovery from the server.
   */
  async onReconnect(): Promise<void> {
    if (!this.autoRecover) return;
    await this.triggerRecovery();
  }

  private async triggerRecovery(): Promise<void> {
    if (this.isRecovering) return;
    this.isRecovering = true;

    try {
      const after = new Date(this.lastAliveAt).toISOString();
      const url = `${this.apiHost}/uof-api/recovery/1/initiate_request?after=${encodeURIComponent(after)}`;

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
      this.emit('recoveryStarted', { estimatedMessages: result.estimatedMessages });

      // Poll for completion
      await this.pollRecoveryStatus(result.requestId);
    } catch (err) {
      console.error('[SwaUofSDK:Recovery] Error:', err);
      this.emit('error', err);
    } finally {
      this.isRecovering = false;
    }
  }

  private async pollRecoveryStatus(requestId: string): Promise<void> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const url = `${this.apiHost}/uof-api/recovery/1/status?request_id=${encodeURIComponent(requestId)}`;
        const response = await fetch(url, {
          headers: { 'X-API-Key': this.accessToken },
        });

        if (!response.ok) continue;

        const status = await response.json() as { status: string };
        if (status.status === 'completed') {
          this.emit('recoveryCompleted');
          return;
        }
        if (status.status === 'failed') {
          this.emit('error', new Error('Recovery failed on server'));
          return;
        }
      } catch {
        // retry
      }
    }

    this.emit('error', new Error('Recovery polling timed out'));
  }
}

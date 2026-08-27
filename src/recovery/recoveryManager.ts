import { EventEmitter } from 'events';
import { AliveEvent } from '../types';
import { UofApiClient } from '../http/apiClient';

export class RecoveryManager extends EventEmitter {
  private lastAliveAt: number = Date.now();
  private monitorTimer: NodeJS.Timeout | null = null;
  private isRecovering = false;

  constructor(
    private api: UofApiClient,
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

      const result = await this.api.post<{ requestId: string; estimatedMessages: number }>(
        'recovery/1/initiate_request',
        { after },
      );
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
        const status = await this.api.getJson<{ status: string }>('recovery/1/status', {
          request_id: requestId,
        });

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

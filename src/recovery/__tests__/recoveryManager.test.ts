import { RecoveryManager } from '../recoveryManager';
import { UofApiClient } from '../../http/apiClient';

function build(autoRecover = true) {
  const api = {
    post: jest.fn().mockResolvedValue({ requestId: 'r1', estimatedMessages: 12 }),
    getJson: jest.fn().mockResolvedValue({ status: 'completed' }),
  };
  return {
    api,
    manager: new RecoveryManager(api as unknown as UofApiClient, 30_000, autoRecover),
  };
}

describe('RecoveryManager', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not recover while alive messages keep arriving', () => {
    jest.useFakeTimers();
    const { api, manager } = build();

    manager.startMonitoring();
    jest.advanceTimersByTime(20_000);
    manager.onAlive({ productId: 1, timestamp: 1, subscribed: true });
    jest.advanceTimersByTime(20_000);

    expect(api.post).not.toHaveBeenCalled();
    manager.stopMonitoring();
  });

  it('recovers once the alive timeout passes', () => {
    jest.useFakeTimers();
    const { api, manager } = build();

    manager.startMonitoring();
    jest.advanceTimersByTime(35_000);

    expect(api.post).toHaveBeenCalledWith(
      'recovery/1/initiate_request',
      { after: expect.any(String) },
    );
    manager.stopMonitoring();
  });

  it('stays quiet when auto recovery is off', () => {
    jest.useFakeTimers();
    const { api, manager } = build(false);

    manager.startMonitoring();
    jest.advanceTimersByTime(35_000);

    expect(api.post).not.toHaveBeenCalled();
    manager.stopMonitoring();
  });

  it('announces the recovery and its completion', async () => {
    const { manager } = build();
    const started = jest.fn();
    const completed = jest.fn();
    manager.on('recoveryStarted', started);
    manager.on('recoveryCompleted', completed);

    await manager.onReconnect();

    expect(started).toHaveBeenCalledWith({ estimatedMessages: 12 });
    expect(completed).toHaveBeenCalled();
  });

  it('does nothing on reconnect when auto recovery is off', async () => {
    const { api, manager } = build(false);
    await manager.onReconnect();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reports a server-side failure', async () => {
    const { api, manager } = build();
    api.getJson.mockResolvedValue({ status: 'failed' });
    const errors: Error[] = [];
    manager.on('error', err => errors.push(err));

    await manager.onReconnect();

    expect(errors[0].message).toBe('Recovery failed on server');
  });

  it('reports a request that never gets through', async () => {
    const { api, manager } = build();
    api.post.mockRejectedValue(new Error('502 Bad Gateway'));
    const errors: Error[] = [];
    manager.on('error', err => errors.push(err));

    await manager.onReconnect();

    expect(errors).toHaveLength(1);
  });

  it('keeps polling past a transient status failure', async () => {
    const { api, manager } = build();
    api.getJson
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ status: 'completed' });
    const completed = jest.fn();
    manager.on('recoveryCompleted', completed);

    await manager.onReconnect();

    expect(completed).toHaveBeenCalled();
  });

  it('ignores a second startMonitoring call', () => {
    jest.useFakeTimers();
    const { api, manager } = build();

    manager.startMonitoring();
    manager.startMonitoring();
    jest.advanceTimersByTime(35_000);

    expect(api.post).toHaveBeenCalledTimes(1);
    manager.stopMonitoring();
    expect(() => manager.stopMonitoring()).not.toThrow();
  });
});

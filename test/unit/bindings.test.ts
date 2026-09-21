import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultBindingPatterns } from '../../src/client';

describe('defaultBindingPatterns', () => {
  it('binds the sport, its own heartbeat and the key older servers publish on', () => {
    assert.deepEqual(defaultBindingPatterns('boxing'), ['boxing.live.#', 'system.live.alive.boxing', 'system.live.alive.-']);
  });

  it('never binds every sport, so another sport cannot vouch for this feed', () => {
    for (const sport of ['tennis', 'tabletennis', 'volleyball', 'mma', 'boxing'] as const) {
      const patterns = defaultBindingPatterns(sport);
      assert.ok(!patterns.includes('system.live.alive.#'));
      assert.ok(!patterns.some(pattern => pattern.startsWith('system.live.alive.') && !['-', sport].includes(pattern.split('.').pop()!)));
    }
  });
});

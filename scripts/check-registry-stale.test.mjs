import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistryHealth } from './check-registry-stale.mjs';

describe('checkRegistryHealth', () => {
  it('runs cleanly against live or raw registry index', async () => {
    const result = await checkRegistryHealth();
    assert.equal(typeof result.ok, 'boolean');
  });
});

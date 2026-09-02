import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RetentionPolicySchema,
  DEFAULT_RETENTION_POLICY,
  calculateExpirationDate,
  isMeetingExpired,
  getMeetingMediaRelativeDir,
  MEETING_MEDIA_FILES,
} from './retention.js';

describe('Retention Policy & Helpers', () => {
  it('validates default and custom retention policies', () => {
    const defaultParsed = RetentionPolicySchema.parse(DEFAULT_RETENTION_POLICY);
    assert.equal(defaultParsed.enabled, true);
    assert.equal(defaultParsed.retention_days, 90);
    assert.equal(defaultParsed.consent_acknowledged, false);

    const custom = {
      enabled: true,
      retention_days: 30,
      purge_media_only: true,
      consent_acknowledged: true,
      consent_acknowledged_at: '2026-08-31T12:00:00Z',
    };
    const customParsed = RetentionPolicySchema.parse(custom);
    assert.equal(customParsed.retention_days, 30);
    assert.equal(customParsed.consent_acknowledged, true);
  });

  it('calculates expiration date and verifies expiration status', () => {
    const created = '2026-01-01T00:00:00Z';
    const expiry = calculateExpirationDate(created, 30);
    assert.equal(expiry.toISOString().startsWith('2026-01-31'), true);

    // Before expiration
    const nowBefore = new Date('2026-01-15T00:00:00Z');
    assert.equal(isMeetingExpired(created, 30, nowBefore), false);

    // After expiration
    const nowAfter = new Date('2026-02-05T00:00:00Z');
    assert.equal(isMeetingExpired(created, 30, nowAfter), true);

    // Indefinite retention (null retention days)
    assert.equal(isMeetingExpired(created, null, nowAfter), false);
  });

  it('provides standard media paths and filenames', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(getMeetingMediaRelativeDir(id), `meetings/${id}`);
    assert.equal(MEETING_MEDIA_FILES.VIDEO, 'video.mp4');
    assert.equal(MEETING_MEDIA_FILES.AUDIO, 'audio.wav');
  });
});

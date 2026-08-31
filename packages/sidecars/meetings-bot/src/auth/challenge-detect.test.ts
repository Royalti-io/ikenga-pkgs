import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectGoogleChallenge } from './challenge-detect.js';

describe('Google Authentication Challenge Detection', () => {
  it('detects 2-step verification challenge', () => {
    const res = detectGoogleChallenge(
      'https://accounts.google.com/signin/v2/challenge/ipp',
      '2-Step Verification: Check your phone to verify your identity.'
    );
    assert.equal(res.hasChallenge, true);
    assert.equal(res.type, '2fa_prompt');
  });

  it('detects CAPTCHA verification prompt', () => {
    const res = detectGoogleChallenge(
      'https://accounts.google.com/signin/challenge/captcha',
      'Type the characters you see in the picture.'
    );
    assert.equal(res.hasChallenge, true);
    assert.equal(res.type, 'captcha');
  });

  it('returns clean status on standard pages', () => {
    const res = detectGoogleChallenge('https://meet.google.com/abc-defg-hij', 'Ready to join?');
    assert.equal(res.hasChallenge, false);
  });
});

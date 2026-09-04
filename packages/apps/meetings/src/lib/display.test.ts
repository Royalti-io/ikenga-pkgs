import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_SPEAKERS,
  speakerLabel,
  speakerColor,
  initials,
  groupIntoTurns,
} from './display.js';
import type { TranscriptSegment } from '@ikenga/meetings-contract';

const seg = (over: Partial<TranscriptSegment>): TranscriptSegment =>
  ({
    id: crypto.randomUUID(),
    meeting_id: 'm1',
    start_ms: 0,
    end_ms: 1000,
    text: 'hi',
    ...over,
  }) as TranscriptSegment;

describe('channel-derived speaker identities (WP-21 / D-15)', () => {
  it('labels the two channels as You and Them', () => {
    assert.equal(speakerLabel('local', undefined), 'You');
    assert.equal(speakerLabel('remote', undefined), 'Them');
  });

  it('prefers a real speaker name over the channel label', () => {
    // Once manual tagging or a real model exists, it must win.
    assert.equal(speakerLabel('local', 'Chinedum'), 'Chinedum');
  });

  it('falls back to Speaker for an unattributed segment', () => {
    assert.equal(speakerLabel(undefined, undefined), 'Speaker');
  });

  it('gives each channel a fixed colour, not a hashed one', () => {
    // Hashing would let "You" change colour between meetings.
    assert.equal(speakerColor('local'), CHANNEL_SPEAKERS.local!.color);
    assert.equal(speakerColor('remote'), CHANNEL_SPEAKERS.remote!.color);
    assert.notEqual(speakerColor('local'), speakerColor('remote'));
  });

  it('uses two-letter initials for the channel labels', () => {
    // "You" would otherwise initial to a single letter and read as noise.
    assert.equal(initials('You'), 'YO');
    assert.equal(initials('Them'), 'TH');
  });

  it('separates turns when the channel changes', () => {
    const turns = groupIntoTurns(
      [
        seg({ speaker_id: 'remote', start_ms: 0, end_ms: 900, text: 'their line' }),
        seg({ speaker_id: 'local', start_ms: 900, end_ms: 1800, text: 'my reply' }),
      ],
      []
    );
    assert.equal(turns.length, 2, 'a channel change must start a new turn');
    assert.equal(turns[0]?.speakerName, 'Them');
    assert.equal(turns[1]?.speakerName, 'You');
  });

  it('keeps consecutive same-channel segments in one turn', () => {
    const turns = groupIntoTurns(
      [
        seg({ speaker_id: 'local', start_ms: 0, end_ms: 900, text: 'one' }),
        seg({ speaker_id: 'local', start_ms: 950, end_ms: 1800, text: 'two' }),
      ],
      []
    );
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.segments.length, 2);
  });
});

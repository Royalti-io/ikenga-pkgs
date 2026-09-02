import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from './cli.js';

describe('CLI arg parsing', () => {
  it('reads a command with no flags', () => {
    assert.deepEqual(parseArgs(['preflight']), { command: 'preflight', flags: {} });
  });

  it('reads value flags', () => {
    const { command, flags } = parseArgs(['start', '--meeting-id', 'abc-123']);
    assert.equal(command, 'start');
    assert.equal(flags['meeting-id'], 'abc-123');
  });

  it('reads several flags together', () => {
    const { flags } = parseArgs([
      'transcribe',
      '--meeting-id', 'm1',
      '--model', 'base.en',
      '--language', 'en',
    ]);
    assert.equal(flags['meeting-id'], 'm1');
    assert.equal(flags.model, 'base.en');
    assert.equal(flags.language, 'en');
  });

  it('treats a valueless trailing flag as a boolean', () => {
    const { flags } = parseArgs(['status', '--verbose']);
    assert.equal(flags.verbose, 'true');
  });

  it('treats a flag followed by another flag as a boolean', () => {
    const { flags } = parseArgs(['status', '--verbose', '--meeting-id', 'm1']);
    assert.equal(flags.verbose, 'true');
    assert.equal(flags['meeting-id'], 'm1');
  });

  it('defaults to help when argv is empty', () => {
    assert.equal(parseArgs([]).command, 'help');
  });

  it('keeps a path value containing dashes intact', () => {
    const { flags } = parseArgs(['stop', '--output-dir', '/home/u/.ikenga/media-2']);
    assert.equal(flags['output-dir'], '/home/u/.ikenga/media-2');
  });
});

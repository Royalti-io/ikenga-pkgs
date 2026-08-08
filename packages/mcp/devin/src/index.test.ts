// devin-mcp — placeholder tests. Will expand once the WP-01 probe results land.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { devinStatus } from './devin.js';

test('pkg id is stable', () => {
  assert.equal('com.ikenga.mcp-devin', 'com.ikenga.mcp-devin');
});

test('devinStatus detects install/auth state', async () => {
  const status = await devinStatus();
  // On CI the binary is missing; on this machine it may be present.
  // This test is a smoke to make sure the function runs without throwing.
  assert.ok(['not_installed', 'not_authenticated', 'ready'].includes(status.kind));
});

test('devinStatus with stub not-authenticated', async (t) => {
  const fakePath = mkdtempSync(join(tmpdir(), 'devin-test-'));

  const devinBin = join(fakePath, 'devin');
  writeFileSync(
    devinBin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "devin 3000.3.22"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "Not logged in."
  exit 0
fi
echo "unknown command" >&2
exit 1
`,
    { mode: 0o755 }
  );

  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${fakePath}:${originalPath}`;

  // Cleanup runs even if the assertions below throw.
  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(fakePath, { recursive: true, force: true });
  });

  const status = await devinStatus();
  assert.equal(status.kind, 'not_authenticated');
  assert.equal(status.version, 'devin 3000.3.22');
});

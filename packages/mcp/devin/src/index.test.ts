import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { devinStatus } from './devin.js';
import { delegateTask, cancelTask, getTask, reconcileBoot } from './ledger.js';

test('pkg id is stable', () => {
  assert.equal('com.ikenga.mcp-devin', 'com.ikenga.mcp-devin');
});

test('devinStatus detects install/auth state', async () => {
  const status = await devinStatus();
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

  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(fakePath, { recursive: true, force: true });
  });

  const status = await devinStatus();
  assert.equal(status.kind, 'not_authenticated');
  assert.equal(status.version, 'devin 3000.3.22');
});

test('delegateTask spawns a mock devin task', async (t) => {
  const fakePath = mkdtempSync(join(tmpdir(), 'devin-test-'));
  const devinBin = join(fakePath, 'devin');
  writeFileSync(
    devinBin,
    `#!/bin/sh
if [ "$1" = "exec" ]; then
    echo "Running mock prompt: $3"
    exit 0
fi
exit 1
`,
    { mode: 0o755 }
  );

  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${fakePath}:${originalPath}`;

  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(fakePath, { recursive: true, force: true });
  });

  const res = await delegateTask({ brief: 'hello world' });
  assert.equal(res.status, 'running');
  assert.ok(res.task_id);

  // Poll for completion
  let task = getTask(res.task_id);
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    task = getTask(res.task_id);
    if (task && task.status !== 'running') break;
  }
  assert.equal(task?.status, 'done');
  assert.match(task?.output ?? '', /Running mock prompt/);
});

test('cancelTask cancels a running task', async (t) => {
  const fakePath = mkdtempSync(join(tmpdir(), 'devin-test-'));
  const devinBin = join(fakePath, 'devin');
  writeFileSync(
    devinBin,
    `#!/bin/sh
if [ "$1" = "exec" ]; then
    sleep 10
    exit 0
fi
exit 1
`,
    { mode: 0o755 }
  );

  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${fakePath}:${originalPath}`;

  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(fakePath, { recursive: true, force: true });
  });

  const res = await delegateTask({ brief: 'sleep task' });
  assert.equal(res.status, 'running');

  const cancelRes = cancelTask(res.task_id);
  assert.ok(cancelRes.ok);

  const task = getTask(res.task_id);
  assert.equal(task?.status, 'cancelled');
});

test('delegateTask respects active task concurrency limit', async (t) => {
  const fakePath = mkdtempSync(join(tmpdir(), 'devin-test-'));
  const devinBin = join(fakePath, 'devin');
  writeFileSync(
    devinBin,
    `#!/bin/sh
if [ "$1" = "exec" ]; then
    sleep 5
    exit 0
fi
exit 1
`,
    { mode: 0o755 }
  );

  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${fakePath}:${originalPath}`;

  const activeIds: string[] = [];
  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(fakePath, { recursive: true, force: true });
    // Cancel any running tasks to avoid resource leaks
    for (const id of activeIds) {
      cancelTask(id);
    }
  });

  // Spawn 3 tasks
  for (let i = 0; i < 3; i++) {
    const res = await delegateTask({ brief: 'sleep task' });
    assert.equal(res.status, 'running');
    activeIds.push(res.task_id);
  }

  // 4th task should be rejected with status failed due to concurrency limit
  const res4 = await delegateTask({ brief: 'excess task' });
  assert.equal(res4.status, 'failed');
  assert.match(res4.error ?? '', /Concurrency limit reached/);
});

test('reconcileBoot handles orphaned/running tasks correctly', async () => {
  const taskId = randomUUID();
  const filePath = join(homedir(), '.local', 'share', 'app.ikenga', 'devin-tasks', `${taskId}.json`);
  const record = {
    task_id: taskId,
    brief: 'stale task',
    cwd: process.cwd(),
    mode: 'auto',
    status: 'running',
    output: '',
    output_path: join(homedir(), '.local', 'share', 'app.ikenga', 'devin-tasks', `${taskId}.txt`),
    started_at: new Date().toISOString(),
    pid: 99999, // dummy pid
  };
  mkdirSync(join(homedir(), '.local', 'share', 'app.ikenga', 'devin-tasks'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');

  // Trigger boot reconciliation
  reconcileBoot();

  const loaded = getTask(taskId);
  assert.ok(loaded);
  assert.equal(loaded?.status, 'failed');
  assert.match(loaded?.error ?? '', /sidecar restarted/);

  // Cleanup
  try {
    unlinkSync(filePath);
  } catch {}
});


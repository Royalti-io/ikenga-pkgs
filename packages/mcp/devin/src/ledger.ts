/**
 * Devin task ledger — durable in-memory + JSON disk store for long-running
 * Devin delegate tasks.
 *
 * Lifecycle: QUEUED → RUNNING → (DONE | FAILED | CANCELLED | TIMED_OUT)
 *
 * Each task maps a local `task_id` (UUID) to a spawned `devin` child process.
 * Output is streamed into an in-memory buffer (capped at TAIL_BYTES) and also
 * written to `<output_dir>/<task_id>.txt` for the `iyke chi status` surface.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_auth'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface TaskRecord {
  task_id: string;
  /** Maps to chi_cache.external_id for iyke chi status cross-referencing. */
  chi_run_id?: string;
  brief: string;
  cwd: string;
  mode: string;
  model?: string;
  session_id?: string;
  status: TaskStatus;
  output: string;       // tail of stdout+stderr, capped at TAIL_BYTES
  output_path: string;  // absolute path on disk
  error?: string;
  started_at: string;
  ended_at?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TAIL_BYTES = 32_000;
const DEFAULT_TIMEOUT_S = 900;
const MIN_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 7_200;

const OUTPUT_DIR = join(
  homedir(),
  '.local', 'share', 'app.ikenga', 'devin-tasks'
);

// ── In-memory registry ───────────────────────────────────────────────────────

const tasks = new Map<string, TaskRecord>();
const children = new Map<string, ChildProcess>();
const timers = new Map<string, NodeJS.Timeout>();

function ensureOutputDir(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function persistRecord(record: TaskRecord): void {
  try {
    ensureOutputDir();
    writeFileSync(
      join(OUTPUT_DIR, `${record.task_id}.json`),
      JSON.stringify(record, null, 2),
      'utf8'
    );
  } catch {
    // best-effort; not fatal
  }
}

export function getTask(taskId: string): TaskRecord | undefined {
  return tasks.get(taskId);
}

export function listTasks(): TaskRecord[] {
  return [...tasks.values()].sort((a, b) =>
    b.started_at.localeCompare(a.started_at)
  );
}

// ── Delegate spawn ───────────────────────────────────────────────────────────

export interface DelegateOpts {
  brief: string;
  cwd?: string;
  mode?: string;
  model?: string;
  session_id?: string;
  attach_files?: string[];
  timeout_seconds?: number;
  chi_run_id?: string;
}

export interface DelegateResult {
  task_id: string;
  status: TaskStatus;
}

export async function delegateTask(opts: DelegateOpts): Promise<DelegateResult> {
  ensureOutputDir();

  const task_id = randomUUID();
  const cwd = opts.cwd ?? process.cwd();
  const mode = opts.mode ?? 'auto';
  const timeoutS = Math.min(
    Math.max(opts.timeout_seconds ?? DEFAULT_TIMEOUT_S, MIN_TIMEOUT_S),
    MAX_TIMEOUT_S
  );
  const output_path = join(OUTPUT_DIR, `${task_id}.txt`);

  const record: TaskRecord = {
    task_id,
    chi_run_id: opts.chi_run_id,
    brief: opts.brief,
    cwd,
    mode,
    model: opts.model,
    session_id: opts.session_id,
    status: 'running',
    output: '',
    output_path,
    started_at: new Date().toISOString(),
  };

  tasks.set(task_id, record);

  // Build devin CLI args
  const args: string[] = ['exec', '--prompt', opts.brief, '--permission-mode', mode];
  if (opts.session_id) args.push('--session-id', opts.session_id);
  if (opts.model) args.push('--model', opts.model);
  if (opts.attach_files?.length) {
    for (const f of opts.attach_files) {
      if (!f.startsWith('/')) continue; // reject non-absolute
      args.push('--attach', f);
    }
  }

  const fileStream = createWriteStream(output_path, { flags: 'a' });

  let child: ChildProcess;
  try {
    child = spawn('devin', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (spawnErr) {
    const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
    record.status = 'failed';
    record.error = `spawn failed: ${msg}`;
    record.ended_at = new Date().toISOString();
    persistRecord(record);
    return { task_id, status: 'failed' };
  }

  children.set(task_id, child);

  function appendOutput(chunk: string) {
    record.output = (record.output + chunk).slice(-TAIL_BYTES);
    fileStream.write(chunk);
    // Detect awaiting_auth heuristic
    if (record.status === 'running' && /awaiting.auth|login required|authenticate/i.test(chunk)) {
      record.status = 'awaiting_auth';
    }
    persistRecord(record);
  }

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);

  // Timeout
  const timer = setTimeout(() => {
    if (record.status === 'running' || record.status === 'awaiting_auth') {
      record.status = 'timed_out';
      record.ended_at = new Date().toISOString();
      record.error = `timed out after ${timeoutS}s`;
      persistRecord(record);
      child.kill('SIGTERM');
    }
  }, timeoutS * 1000);
  timers.set(task_id, timer);

  child.on('close', (code) => {
    clearTimeout(timers.get(task_id));
    timers.delete(task_id);
    children.delete(task_id);
    fileStream.end();

    if (record.status === 'cancelled' || record.status === 'timed_out') return;
    record.status = code === 0 ? 'done' : 'failed';
    if (code !== 0) record.error = `exited with code ${code}`;
    record.ended_at = new Date().toISOString();
    persistRecord(record);
  });

  child.on('error', (err) => {
    clearTimeout(timers.get(task_id));
    timers.delete(task_id);
    children.delete(task_id);
    fileStream.end();
    record.status = 'failed';
    record.error = err.message;
    record.ended_at = new Date().toISOString();
    persistRecord(record);
  });

  persistRecord(record);
  return { task_id, status: 'running' };
}

export function cancelTask(taskId: string): { ok: boolean; error?: string } {
  const record = tasks.get(taskId);
  if (!record) return { ok: false, error: 'task_not_found' };
  if (record.status === 'done' || record.status === 'failed' || record.status === 'cancelled' || record.status === 'timed_out') {
    return { ok: false, error: `task already ${record.status}` };
  }

  const child = children.get(taskId);
  if (child) {
    child.kill('SIGTERM');
    children.delete(taskId);
  }
  clearTimeout(timers.get(taskId));
  timers.delete(taskId);

  record.status = 'cancelled';
  record.ended_at = new Date().toISOString();
  persistRecord(record);
  return { ok: true };
}

// Boot: re-hydrate any task JSONs from a previous process (best-effort)
try {
  ensureOutputDir();
} catch { /* ignore */ }

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
import { mkdirSync, createWriteStream, writeFileSync, renameSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
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
  output_truncated?: boolean;
  output_path: string;  // absolute path on disk
  pid?: number;         // child process PID
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
    const tmpPath = join(OUTPUT_DIR, `${record.task_id}.json.tmp`);
    const finalPath = join(OUTPUT_DIR, `${record.task_id}.json`);
    writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tmpPath, finalPath);
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
  error?: string;
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

  // Enforce concurrency limit (default 3 active tasks max)
  const activeCount = [...tasks.values()].filter(
    (t) => t.status === 'running' || t.status === 'awaiting_auth'
  ).length;
  if (activeCount >= 3) {
    const errorMsg = 'Concurrency limit reached: maximum 3 active tasks allowed.';
    const record: TaskRecord = {
      task_id,
      chi_run_id: opts.chi_run_id,
      brief: opts.brief,
      cwd,
      mode,
      model: opts.model,
      session_id: opts.session_id,
      status: 'failed',
      output: '',
      output_path,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      error: errorMsg,
    };
    tasks.set(task_id, record);
    persistRecord(record);
    return { task_id, status: 'failed', error: errorMsg };
  }

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
    return { task_id, status: 'failed', error: record.error };
  }

  children.set(task_id, child);
  record.pid = child.pid;
  persistRecord(record);

  function appendOutput(chunk: string) {
    const newOutput = record.output + chunk;
    if (newOutput.length > TAIL_BYTES) {
      record.output_truncated = true;
      record.output = newOutput.slice(-TAIL_BYTES);
    } else {
      record.output = newOutput;
    }
    fileStream.write(chunk);
    // Detect awaiting_auth heuristic
    if (
      (record.status === 'running' || record.status === 'awaiting_auth') &&
      /awaiting.auth|login required|authenticate/i.test(chunk)
    ) {
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
  if (!child) {
    if (record.status === 'running' || record.status === 'awaiting_auth') {
      return { ok: false, error: 'Task is not owned by this sidecar process (cannot cancel adopted task).' };
    }
    return { ok: false, error: 'task_not_running' };
  }

  child.kill('SIGTERM');
  children.delete(taskId);
  clearTimeout(timers.get(taskId));
  timers.delete(taskId);

  record.status = 'cancelled';
  record.ended_at = new Date().toISOString();
  persistRecord(record);
  return { ok: true };
}

// ── Boot Reconciliation & Pruning ───────────────────────────────────────────

export function reconcileBoot(): void {
  try {
    ensureOutputDir();
    const files = readdirSync(OUTPUT_DIR);
    const now = new Date();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(OUTPUT_DIR, file);
      try {
        const stats = statSync(filePath);
        // Age pruning: check if file is older than 7 days
        if (now.getTime() - stats.mtime.getTime() > maxAgeMs) {
          try { unlinkSync(filePath); } catch {}
          const txtPath = join(OUTPUT_DIR, file.replace('.json', '.txt'));
          try { unlinkSync(txtPath); } catch {}
          continue;
        }

        const record = JSON.parse(readFileSync(filePath, 'utf8')) as TaskRecord;

        // Boot reconciliation for running/queued tasks
        if (record.status === 'running' || record.status === 'queued' || record.status === 'awaiting_auth') {
          let live = false;
          if (record.pid) {
            try {
              process.kill(record.pid, 0);
              live = true;
            } catch {
              live = false;
            }
          }
          if (live) {
            // Adopt as unmanaged running task
            tasks.set(record.task_id, record);
          } else {
            record.status = 'failed';
            record.ended_at = new Date().toISOString();
            record.error = 'sidecar restarted while task was in flight';
            tasks.set(record.task_id, record);
            persistRecord(record);
          }
        } else {
          tasks.set(record.task_id, record);
        }
      } catch {
        // Skip corrupt files
      }
    }
  } catch {
    // Ignore errors during boot scan
  }
}

function setupShutdownHandlers(): void {
  const cleanup = () => {
    for (const child of children.values()) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

// Perform boot tasks and setup handlers
try {
  reconcileBoot();
  setupShutdownHandlers();
} catch { /* ignore */ }

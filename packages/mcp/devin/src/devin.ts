import { spawn } from 'node:child_process';

export type DevinInstallState =
  | { kind: 'not_installed' }
  | { kind: 'not_authenticated'; version: string }
  | { kind: 'ready'; version: string };

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function run(cmd: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error: Error) => {
      resolve({ exitCode: null, stdout, stderr, error });
    });

    child.on('close', (exitCode: number | null) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export async function devinStatus(): Promise<DevinInstallState> {
  const versionResult = await run('devin', ['--version']);

  if (versionResult.error?.message.includes('ENOENT') || versionResult.exitCode !== 0) {
    return { kind: 'not_installed' };
  }

  const version = versionResult.stdout.trim() || 'unknown';

  const authResult = await run('devin', ['auth', 'status']);
  const authOutput = (authResult.stdout + authResult.stderr).toLowerCase();

  if (authOutput.includes('not logged in')) {
    return { kind: 'not_authenticated', version };
  }

  if (authResult.exitCode === 0 && authOutput.includes('logged in')) {
    return { kind: 'ready', version };
  }

  // Conservative fallback: if we can't tell, treat as not authenticated so the
  // user sees the onboarding panel rather than a silent failure.
  return { kind: 'not_authenticated', version };
}

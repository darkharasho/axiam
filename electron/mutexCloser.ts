import path from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

export interface MutexCloserResult {
  ok: boolean;
  closedCount: number;
  reason?: string;
}

const MUTEX_NAME = 'AN-Mutex-Window-Guild Wars 2';
const PROCESS_NAME = 'Gw2-64.exe';

export function interpretHelperResult(result: SpawnResult): MutexCloserResult {
  if (result.error) {
    return { ok: false, closedCount: 0, reason: result.error.message };
  }
  switch (result.status) {
    case 0: {
      const parsed = parseJsonClosedCount(result.stdout);
      return { ok: true, closedCount: parsed ?? 1 };
    }
    case 2:
    case 3:
      return { ok: true, closedCount: 0 };
    case 4:
      return { ok: false, closedCount: 0, reason: (result.stderr || 'helper reported failure').trim() };
    default:
      return {
        ok: false,
        closedCount: 0,
        reason: `helper exited with status ${result.status ?? 'null'}`,
      };
  }
}

function parseJsonClosedCount(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed?.closed === 'number') return parsed.closed;
  } catch {
    // fall through
  }
  return null;
}

export function getHelperPath(): string {
  // process.resourcesPath in packaged builds; fall back to repo path in dev.
  const packagedPath = path.join(process.resourcesPath || '', 'mutex-closer', 'axiam-mutex-closer.exe');
  if (fs.existsSync(packagedPath)) return packagedPath;
  return path.join(process.cwd(), 'build', 'win', 'axiam-mutex-closer.exe');
}

export function runMutexCloserDirect(helperPath: string): MutexCloserResult {
  const result = spawnSync(helperPath, [
    '--process-name', PROCESS_NAME,
    '--mutex-name', MUTEX_NAME,
    '--json',
  ], { encoding: 'utf8', timeout: 5000 });
  return interpretHelperResult({
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ?? null,
  });
}

export interface ProtonContext {
  protonPath: string;          // .../proton
  compatDataPath: string;       // .../steamapps/compatdata/1284210
  clientInstallPath: string;    // $HOME/.local/share/Steam
}

export function runMutexCloserUnderProton(helperPath: string, ctx: ProtonContext): MutexCloserResult {
  const env = {
    ...process.env,
    STEAM_COMPAT_DATA_PATH: ctx.compatDataPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: ctx.clientInstallPath,
  };
  const result = spawnSync(ctx.protonPath, [
    'run',
    helperPath,
    '--process-name', PROCESS_NAME,
    '--mutex-name', MUTEX_NAME,
    '--json',
  ], { encoding: 'utf8', timeout: 15000, env });
  return interpretHelperResult({
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ?? null,
  });
}

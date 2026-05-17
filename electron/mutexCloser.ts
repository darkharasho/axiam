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

export interface Filesystem {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding?: BufferEncoding) => string;
  readdirSync: (path: string) => string[];
}

const STEAM_GW2_APP_ID = '1284210';

export function resolveProtonContext(
  home: string,
  steamLibraryPaths: string[],
  filesystem: Filesystem,
): ProtonContext | null {
  const compatToolsRoots = [
    path.join(home, '.steam', 'root', 'compatibilitytools.d'),
    path.join(home, '.local', 'share', 'Steam', 'compatibilitytools.d'),
  ];

  for (const lib of steamLibraryPaths) {
    const compat = path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID);
    if (!filesystem.existsSync(compat)) continue;
    const proton = findProtonInLibrary(compat, lib, compatToolsRoots, filesystem);
    if (!proton) continue;
    return {
      compatDataPath: compat,
      protonPath: proton,
      clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
    };
  }
  return null;
}

function findProtonInLibrary(
  compatDataPath: string,
  libraryPath: string,
  compatToolsRoots: string[],
  filesystem: Filesystem,
): string | null {
  // Strategy 1: read config_info to find the Proton tool actually used for this app
  const configInfoPath = path.join(compatDataPath, 'config_info');
  if (filesystem.existsSync(configInfoPath)) {
    const content = filesystem.readFileSync(configInfoPath, 'utf-8');
    for (const rawLine of content.split('\n').map((s) => s.trim()).filter(Boolean)) {
      // Some installs store an absolute path ending with the Proton dir name (no /proton suffix).
      // Try "<line>/proton" and "<line>" itself (if it already ends with /proton).
      const candidate = rawLine.endsWith('/proton') ? rawLine : path.join(rawLine, 'proton');
      if (filesystem.existsSync(candidate)) return candidate;
    }
  }

  // Strategy 2: scan steamapps/common for Proton-* installs
  const commonDir = path.join(libraryPath, 'steamapps', 'common');
  let entries: string[];
  try {
    entries = filesystem.readdirSync(commonDir);
  } catch {
    entries = [];
  }
  const protonDirs = entries
    .filter((name) => /^Proton(\s|-)/i.test(name))
    .sort()
    .reverse(); // newest by name comes first
  for (const dir of protonDirs) {
    const candidate = path.join(commonDir, dir, 'proton');
    if (filesystem.existsSync(candidate)) return candidate;
  }

  // Strategy 3: scan compatibilitytools.d for Proton-GE and other custom installs
  for (const root of compatToolsRoots) {
    try {
      const dirs = filesystem.readdirSync(root);
      for (const dir of dirs.sort().reverse()) {
        const candidate = path.join(root, dir, 'proton');
        if (filesystem.existsSync(candidate)) return candidate;
      }
    } catch {
      // directory missing — skip
    }
  }

  return null;
}

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const STEAM_APP_ID = '1284210';

/**
 * Parse Steam's libraryfolders.vdf to get all Steam library paths.
 * Used by mutex-closer for Proton resolution and main.ts for auto-locate.
 */
export function getSteamLibraryPaths(): string[] {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    candidates.push(
      path.join(programFilesX86, 'Steam', 'steamapps', 'libraryfolders.vdf'),
      path.join(programFiles, 'Steam', 'steamapps', 'libraryfolders.vdf'),
    );
  } else {
    const home = app.getPath('home');
    candidates.push(path.join(home, '.local', 'share', 'Steam', 'steamapps', 'libraryfolders.vdf'));
  }

  const vdfPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!vdfPath) return [];

  const content = fs.readFileSync(vdfPath, 'utf-8');
  const paths: string[] = [];
  const pathRegex = /"path"\s+"([^"]+)"/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    paths.push(match[1].replace(/\\\\/g, '\\'));
  }
  return paths;
}

/**
 * Returns the live GW2 data directory the host OS resolves at runtime.
 * Used only by the Linux Local.dat handling now (mutex-closer's Proton resolver
 * doesn't depend on this).
 */
export function getGw2DataDirectory(): string | null {
  if (process.platform === 'linux') {
    const libraryPaths = getSteamLibraryPaths();
    const home = app.getPath('home');
    const defaultPath = path.join(home, '.local', 'share', 'Steam');
    if (!libraryPaths.includes(defaultPath)) {
      libraryPaths.unshift(defaultPath);
    }
    for (const libPath of libraryPaths) {
      const candidate = path.join(
        libPath, 'steamapps', 'compatdata',
        STEAM_APP_ID, 'pfx', 'drive_c', 'users', 'steamuser',
        'AppData', 'Roaming', 'Guild Wars 2',
      );
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const candidate = path.join(appData, 'Guild Wars 2');
    return fs.existsSync(candidate) ? candidate : null;
  }
  return null;
}

/**
 * Returns the per-account AppData root we point GW2 at via the APPDATA env var.
 * Creates the directory on demand. GW2 will write its own `Guild Wars 2/`
 * subdirectory inside.
 */
export function getAccountAppDataDir(accountId: string): string {
  const dir = path.join(app.getPath('userData'), 'profiles', accountId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Path to where Local.dat will land once GW2 writes it for this account.
 * Internal helper — exposed only so tests and migration code can reuse it.
 */
export function getAccountLocalDatPath(accountId: string): string {
  return path.join(
    app.getPath('userData'),
    'profiles',
    accountId,
    'Guild Wars 2',
    'Local.dat',
  );
}

/**
 * True iff this account has a Local.dat inside its profile directory.
 * Drives the "Saved" badge in the UI.
 */
export function hasLocalDat(accountId: string): boolean {
  return fs.existsSync(getAccountLocalDatPath(accountId));
}

/**
 * Remove this account's entire profile directory (`userData/profiles/<id>/`)
 * along with everything GW2 wrote inside. Idempotent — no throw if missing.
 */
export function deleteLocalDat(accountId: string): void {
  const dir = path.join(app.getPath('userData'), 'profiles', accountId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Filesystem facade for migration tests. Real callers pass node:fs directly.
 */
export interface MigrationFs {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts: { recursive: boolean }) => void;
  renameSync: (from: string, to: string) => void;
  readdirSync: (p: string) => string[];
  rmdirSync: (p: string) => void;
}

export interface MigrationResult {
  migratedAccountIds: string[];
  legacyDirRemoved: boolean;
  orphanedFilesLeft: number;
  errors: Array<{ accountId: string; reason: string }>;
}

/**
 * Move legacy `userData/local-dat/<id>.dat` files into the per-account profile
 * layout. Idempotent: re-running after a successful migration is a no-op.
 *
 * Layout transform (per account):
 *   userData/local-dat/<id>.dat
 *     →  userData/profiles/<id>/Guild Wars 2/Local.dat
 */
export function migrateLegacyLocalDat(
  args: { userDataDir: string; accountIds: string[] },
  filesystem: MigrationFs,
): MigrationResult {
  const result: MigrationResult = {
    migratedAccountIds: [],
    legacyDirRemoved: false,
    orphanedFilesLeft: 0,
    errors: [],
  };

  const legacyDir = path.join(args.userDataDir, 'local-dat');

  for (const accountId of args.accountIds) {
    const newPath = path.join(args.userDataDir, 'profiles', accountId, 'Guild Wars 2', 'Local.dat');
    if (filesystem.existsSync(newPath)) continue; // already migrated; idempotent

    const oldPath = path.join(legacyDir, `${accountId}.dat`);
    if (!filesystem.existsSync(oldPath)) continue; // nothing to migrate for this account

    try {
      const newDir = path.dirname(newPath);
      filesystem.mkdirSync(newDir, { recursive: true });
      filesystem.renameSync(oldPath, newPath);
      result.migratedAccountIds.push(accountId);
    } catch (err: any) {
      result.errors.push({ accountId, reason: err?.message ?? String(err) });
    }
  }

  if (filesystem.existsSync(legacyDir)) {
    let remaining: string[];
    try {
      remaining = filesystem.readdirSync(legacyDir);
    } catch {
      remaining = [];
    }
    if (remaining.length === 0) {
      try {
        filesystem.rmdirSync(legacyDir);
        result.legacyDirRemoved = true;
      } catch {
        // leave the empty directory; harmless.
      }
    } else {
      result.orphanedFilesLeft = remaining.length;
    }
  }

  return result;
}

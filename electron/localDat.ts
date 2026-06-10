import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { resolveGw2CompatDataDir } from './protonPaths.js';

export class HostUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostUnavailableError';
  }
}

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
 * Path to where the per-account Local.dat snapshot lives on disk.
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
 * True iff this account has a saved Local.dat snapshot in its profile directory.
 */
export function hasLocalDat(accountId: string): boolean {
  return fs.existsSync(getAccountLocalDatPath(accountId));
}

/**
 * Remove this account's entire profile directory and everything inside it.
 * Idempotent — no throw if missing.
 */
export function deleteLocalDat(accountId: string): void {
  const dir = path.join(app.getPath('userData'), 'profiles', accountId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Internal: path to the host's GW2 Local.dat (where the running game reads/writes).
 * On Windows reads APPDATA; on Linux resolves the path inside the GW2 Proton prefix.
 * Throws HostUnavailableError when the Proton prefix hasn't been created yet.
 */
function getHostLocalDatPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error('APPDATA env var is not set; cannot resolve host Local.dat path');
    }
    return path.join(appData, 'Guild Wars 2', 'Local.dat');
  }
  if (process.platform === 'linux') {
    const compatDir = resolveGw2CompatDataDir(getSteamLibraryPaths());
    if (!compatDir) {
      throw new HostUnavailableError('no GW2 compatdata found in any Steam library');
    }
    return path.join(
      compatDir,
      'pfx', 'drive_c', 'users', 'steamuser',
      'AppData', 'Roaming', 'Guild Wars 2', 'Local.dat',
    );
  }
  throw new HostUnavailableError(`unsupported platform: ${process.platform}`);
}

export interface CopyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Inject the dependencies for testability. Real callers pass `node:fs` directly.
 */
export interface CopyFs {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts: { recursive: boolean }) => void;
  copyFileSync: (src: string, dest: string) => void;
}

/**
 * Copy the account's per-profile Local.dat snapshot over the host file so the
 * about-to-be-spawned Gw2-64.exe will read it via -autologin.
 *
 * Caller is expected to gate on `hasLocalDat(accountId)` first. Calling without
 * a snapshot returns `{ ok: false, reason: 'no-snapshot' }` defensively.
 *
 * Returns `{ ok: false, reason: 'EBUSY' | 'EACCES' | 'EPERM' | <other> }` on
 * filesystem failures. The caller decides whether to retry or proceed without
 * -autologin.
 */
export function installSnapshotToHost(
  accountId: string,
  filesystem: CopyFs = fs,
): CopyResult {
  const src = getAccountLocalDatPath(accountId);
  if (!filesystem.existsSync(src)) {
    return { ok: false, reason: 'no-snapshot' };
  }
  try {
    const dest = getHostLocalDatPath();
    const destDir = path.dirname(dest);
    if (!filesystem.existsSync(destDir)) {
      filesystem.mkdirSync(destDir, { recursive: true });
    }
    filesystem.copyFileSync(src, dest);
    return { ok: true };
  } catch (err: any) {
    if (err instanceof HostUnavailableError) return { ok: false, reason: 'host-unavailable' };
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
  }
}

/**
 * Copy the host Local.dat back into the account's profile directory so future
 * launches and the "Saved" badge reflect the latest state (credentials +
 * settings GW2 wrote during the session).
 *
 * Returns `{ ok: false, reason: 'no-host-file' }` if the host Local.dat doesn't
 * exist (rare; warrants a warning at the call site).
 */
export function snapshotHostToAccount(
  accountId: string,
  filesystem: CopyFs = fs,
): CopyResult {
  try {
    const src = getHostLocalDatPath();
    if (!filesystem.existsSync(src)) {
      return { ok: false, reason: 'no-host-file' };
    }
    const dest = getAccountLocalDatPath(accountId);
    const destDir = path.dirname(dest);
    if (!filesystem.existsSync(destDir)) {
      filesystem.mkdirSync(destDir, { recursive: true });
    }
    filesystem.copyFileSync(src, dest);
    return { ok: true };
  } catch (err: any) {
    if (err instanceof HostUnavailableError) return { ok: false, reason: 'host-unavailable' };
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
  }
}

/**
 * Seed the per-account Local.dat from the host file IFF the per-account
 * file does not yet exist. Used by the DLL-redirect path so a fresh
 * account's profile starts with a valid patcher cache copied from the
 * host — Local.dat is not just credentials, it's also ~70MB of
 * launcher / patcher state, and an empty file makes the launcher refuse
 * to progress past its update check.
 *
 * Whatever credentials the host file held will appear pre-filled on the
 * first launch of this account. They get overwritten the first time the
 * user logs in as this account and ticks Remember Account Information.
 *
 * Idempotent: if the per-account file already exists, this is a no-op
 * that returns `{ ok: true }`. If the host file is missing too, returns
 * `{ ok: false, reason: 'no-host-file' }` and the caller can choose to
 * launch GW2 anyway (the launcher will just have to rebuild its cache).
 */
export function seedAccountLocalDatFromHost(
  accountId: string,
  filesystem: CopyFs = fs,
): CopyResult {
  const dest = getAccountLocalDatPath(accountId);
  if (filesystem.existsSync(dest)) {
    return { ok: true };
  }
  try {
    const src = getHostLocalDatPath();
    if (!filesystem.existsSync(src)) {
      return { ok: false, reason: 'no-host-file' };
    }
    const destDir = path.dirname(dest);
    if (!filesystem.existsSync(destDir)) {
      filesystem.mkdirSync(destDir, { recursive: true });
    }
    filesystem.copyFileSync(src, dest);
    return { ok: true };
  } catch (err: any) {
    if (err instanceof HostUnavailableError) return { ok: false, reason: 'host-unavailable' };
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
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
    if (filesystem.existsSync(newPath)) continue;

    const oldPath = path.join(legacyDir, `${accountId}.dat`);
    if (!filesystem.existsSync(oldPath)) continue;

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

import * as fs from 'fs';
import * as path from 'path';

/**
 * Filesystem facade for testability. Real callers use `node:fs`.
 */
export interface JunctionFs {
  existsSync: (p: string) => boolean;
  lstatSync: (p: string) => { isSymbolicLink: () => boolean; isDirectory: () => boolean };
  readlinkSync: (p: string) => string;
  rmSync: (p: string, opts?: { recursive?: boolean; force?: boolean }) => void;
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  symlinkSync: (target: string, p: string, type?: 'junction' | 'dir' | 'file') => void;
  renameSync: (from: string, to: string) => void;
  readdirSync: (p: string) => string[];
}

const defaultFs: JunctionFs = fs as unknown as JunctionFs;

/**
 * True iff `p` exists and is a junction or symlink. On Windows, directory
 * symlinks and junctions both surface as symbolic links from Node's API.
 */
export function isJunction(p: string, filesystem: JunctionFs = defaultFs): boolean {
  try {
    if (!filesystem.existsSync(p)) return false;
    return filesystem.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Read where the junction at `p` points. Returns `null` if `p` isn't a
 * junction or can't be read.
 */
export function getJunctionTarget(p: string, filesystem: JunctionFs = defaultFs): string | null {
  try {
    if (!isJunction(p, filesystem)) return null;
    return filesystem.readlinkSync(p);
  } catch {
    return null;
  }
}

/**
 * Atomically re-point a junction at `target`. If `junctionPath` already exists
 * as a junction or empty directory, replace it. Throws if it's a non-empty
 * real directory (callers must run migrateGw2DirToJunction first) or if
 * `target` doesn't exist.
 */
export function repointJunction(
  junctionPath: string,
  target: string,
  filesystem: JunctionFs = defaultFs,
): void {
  if (!filesystem.existsSync(target)) {
    throw new Error(`repointJunction: target does not exist: ${target}`);
  }

  if (filesystem.existsSync(junctionPath)) {
    const stat = filesystem.lstatSync(junctionPath);
    if (stat.isSymbolicLink()) {
      filesystem.rmSync(junctionPath, { force: true, recursive: false });
    } else if (stat.isDirectory()) {
      const contents = filesystem.readdirSync(junctionPath);
      if (contents.length > 0) {
        throw new Error(
          `repointJunction: refusing to replace non-empty directory ${junctionPath} ` +
          `(call migrateGw2DirToJunction first)`,
        );
      }
      filesystem.rmSync(junctionPath, { force: true, recursive: false });
    } else {
      filesystem.rmSync(junctionPath, { force: true });
    }
  }

  filesystem.symlinkSync(target, junctionPath, 'junction');
}

export interface MigrationResult {
  status: 'already-migrated' | 'migrated' | 'created-empty' | 'refused-gw2-running';
  movedFiles: number;
}

/**
 * One-time migration: if the real `%APPDATA%\Guild Wars 2` directory exists,
 * move its contents into `defaultProfileDir` and replace the original path
 * with a junction pointing at it. Idempotent — subsequent runs detect the
 * existing junction and no-op.
 *
 * Callers pass `isGw2Running` so we can refuse to migrate while Gw2-64.exe has
 * handles into the directory.
 */
export function migrateGw2DirToJunction(args: {
  hostPath: string;
  defaultProfileDir: string;
  isGw2Running: () => boolean;
  filesystem?: JunctionFs;
}): MigrationResult {
  const fsx = args.filesystem ?? defaultFs;

  if (isJunction(args.hostPath, fsx)) {
    return { status: 'already-migrated', movedFiles: 0 };
  }

  if (!fsx.existsSync(args.hostPath)) {
    fsx.mkdirSync(args.defaultProfileDir, { recursive: true });
    fsx.symlinkSync(args.defaultProfileDir, args.hostPath, 'junction');
    return { status: 'created-empty', movedFiles: 0 };
  }

  if (args.isGw2Running()) {
    return { status: 'refused-gw2-running', movedFiles: 0 };
  }

  fsx.mkdirSync(args.defaultProfileDir, { recursive: true });
  const entries = fsx.readdirSync(args.hostPath);
  for (const entry of entries) {
    fsx.renameSync(
      path.join(args.hostPath, entry),
      path.join(args.defaultProfileDir, entry),
    );
  }
  fsx.rmSync(args.hostPath, { force: true, recursive: false });
  fsx.symlinkSync(args.defaultProfileDir, args.hostPath, 'junction');
  return { status: 'migrated', movedFiles: entries.length };
}

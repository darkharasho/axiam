import { describe, it, expect } from 'vitest';
import {
  migrateLegacyLocalDat,
  type MigrationFs,
  type MigrationResult,
} from './localDat.js';
import * as path from 'path';

type FsSpy = {
  fs: MigrationFs;
  existing: Set<string>;
  renames: Array<{ from: string; to: string }>;
  mkdirs: string[];
  rmdirs: string[];
};

function fakeFs(initialFiles: string[]): FsSpy {
  const existing = new Set<string>(initialFiles);
  // Pre-populate any directory prefixes so existsSync(dir) is true when files inside exist.
  for (const file of initialFiles) {
    let dir = path.dirname(file);
    while (dir && dir !== path.dirname(dir)) {
      existing.add(dir);
      dir = path.dirname(dir);
    }
  }
  const renames: Array<{ from: string; to: string }> = [];
  const mkdirs: string[] = [];
  const rmdirs: string[] = [];
  const fs: MigrationFs = {
    existsSync: (p) => existing.has(p),
    mkdirSync: (p, _opts) => {
      mkdirs.push(p);
      let dir = p;
      while (dir && dir !== path.dirname(dir)) {
        existing.add(dir);
        dir = path.dirname(dir);
      }
    },
    renameSync: (from, to) => {
      renames.push({ from, to });
      existing.delete(from);
      existing.add(to);
    },
    readdirSync: (p) => {
      const prefix = p.endsWith(path.sep) ? p : p + path.sep;
      return Array.from(existing)
        .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes(path.sep))
        .map((entry) => entry.slice(prefix.length));
    },
    rmdirSync: (p) => {
      rmdirs.push(p);
      existing.delete(p);
    },
  };
  return { fs, existing, renames, mkdirs, rmdirs };
}

const USER = '/u';
const legacyPath = (id: string) => path.join(USER, 'local-dat', `${id}.dat`);
const newPath = (id: string) =>
  path.join(USER, 'profiles', id, 'Guild Wars 2', 'Local.dat');

describe('migrateLegacyLocalDat', () => {
  it('moves legacy Local.dat into the per-account profile directory', () => {
    const spy = fakeFs([legacyPath('a')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual(['a']);
    expect(spy.renames).toEqual([{ from: legacyPath('a'), to: newPath('a') }]);
    expect(spy.mkdirs).toContain(path.dirname(newPath('a')));
    expect(result.errors).toEqual([]);
  });

  it('skips accounts whose new Local.dat already exists', () => {
    const spy = fakeFs([legacyPath('a'), newPath('a')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual([]);
    expect(spy.renames).toEqual([]);
  });

  it('skips accounts with neither old nor new file', () => {
    const spy = fakeFs([]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['fresh-account'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual([]);
    expect(spy.renames).toEqual([]);
  });

  it('removes the legacy directory when it is empty after migration', () => {
    const spy = fakeFs([legacyPath('a')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.legacyDirRemoved).toBe(true);
    expect(spy.rmdirs).toEqual([path.join(USER, 'local-dat')]);
  });

  it('leaves the legacy directory in place when orphaned files remain', () => {
    // 'b' is not in accountIds, so its .dat is orphaned and untouched.
    const spy = fakeFs([legacyPath('a'), legacyPath('b')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.legacyDirRemoved).toBe(false);
    expect(result.orphanedFilesLeft).toBe(1);
    expect(spy.rmdirs).toEqual([]);
  });

  it('continues with other accounts when one rename throws', () => {
    const spy = fakeFs([legacyPath('a'), legacyPath('b')]);
    const originalRename = spy.fs.renameSync;
    spy.fs.renameSync = (from, to) => {
      if (from === legacyPath('a')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      originalRename(from, to);
    };
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a', 'b'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual(['b']);
    expect(result.errors).toEqual([
      { accountId: 'a', reason: expect.stringContaining('EBUSY') },
    ]);
  });

  it('is idempotent on a second run after a successful first run', () => {
    const spy = fakeFs([legacyPath('a')]);
    const first: MigrationResult = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(first.migratedAccountIds).toEqual(['a']);
    const renamesAfterFirst = spy.renames.length;

    const second = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(second.migratedAccountIds).toEqual([]);
    expect(spy.renames.length).toBe(renamesAfterFirst); // no new renames
  });
});

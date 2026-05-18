import { vi, describe, it, expect } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return '/test-userdata';
      if (key === 'home') return '/test-home';
      return '/tmp';
    },
  },
}));
import {
  migrateLegacyLocalDat,
  type MigrationFs,
  type MigrationResult,
} from './localDat.js';
import { installSnapshotToHost, snapshotHostToAccount, type CopyFs } from './localDat.js';
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

type CopyFsSpy = {
  fs: CopyFs;
  existing: Set<string>;
  copies: Array<{ src: string; dest: string }>;
  mkdirs: string[];
  failNextCopyWith?: NodeJS.ErrnoException;
};

function fakeCopyFs(initialFiles: string[]): CopyFsSpy {
  const existing = new Set<string>(initialFiles);
  for (const file of initialFiles) {
    let dir = path.dirname(file);
    while (dir && dir !== path.dirname(dir)) {
      existing.add(dir);
      dir = path.dirname(dir);
    }
  }
  const copies: Array<{ src: string; dest: string }> = [];
  const mkdirs: string[] = [];
  const spy: CopyFsSpy = {
    fs: {
      existsSync: (p) => existing.has(p),
      mkdirSync: (p, _opts) => {
        mkdirs.push(p);
        let dir = p;
        while (dir && dir !== path.dirname(dir)) {
          existing.add(dir);
          dir = path.dirname(dir);
        }
      },
      copyFileSync: (src, dest) => {
        if (spy.failNextCopyWith) {
          const err = spy.failNextCopyWith;
          spy.failNextCopyWith = undefined;
          throw err;
        }
        copies.push({ src, dest });
        existing.add(dest);
        let dir = path.dirname(dest);
        while (dir && dir !== path.dirname(dir)) {
          existing.add(dir);
          dir = path.dirname(dir);
        }
      },
    },
    existing,
    copies,
    mkdirs,
  };
  return spy;
}

// `installSnapshotToHost` resolves the host path via APPDATA env. Tests set it
// before calling and restore it afterward so we don't pollute other tests.
function withAppData<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.APPDATA;
  if (value === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previous;
    }
  }
}

describe('installSnapshotToHost', () => {
  it('returns no-snapshot when the per-account snapshot does not exist', () => {
    const spy = fakeCopyFs([]);
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-snapshot');
    expect(spy.copies).toEqual([]);
  });

  it('copies the snapshot over the host Local.dat on success', () => {
    const spy = fakeCopyFs([]);
    // The function will call existsSync(getAccountLocalDatPath('acc-a')) — return true
    // for the source so the function proceeds, capture the exact src path from the copies log.
    spy.fs.existsSync = (p) => p.includes('Local.dat') ? true : spy.existing.has(p);
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result).toEqual({ ok: true });
    expect(spy.copies.length).toBe(1);
    expect(spy.copies[0].dest).toBe(path.join('/host', 'Guild Wars 2', 'Local.dat'));
    expect(spy.copies[0].src.endsWith(path.join('Guild Wars 2', 'Local.dat'))).toBe(true);
  });

  it('creates the host Guild Wars 2 directory when missing', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.endsWith(path.join('Guild Wars 2', 'Local.dat')) && !p.startsWith('/host');
    // The destination dir does NOT exist yet; force mkdir.
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result.ok).toBe(true);
    expect(spy.mkdirs).toContain(path.join('/host', 'Guild Wars 2'));
  });

  it('returns the error code on copy failure', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = () => true;
    spy.failNextCopyWith = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }) as NodeJS.ErrnoException;
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EBUSY');
  });
});

describe('snapshotHostToAccount', () => {
  it('returns no-host-file when the host Local.dat does not exist', () => {
    const spy = fakeCopyFs([]);
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-host-file');
    expect(spy.copies).toEqual([]);
  });

  it('copies the host Local.dat into the per-account profile dir on success', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.startsWith('/host');
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result).toEqual({ ok: true });
    expect(spy.copies.length).toBe(1);
    expect(spy.copies[0].src).toBe(path.join('/host', 'Guild Wars 2', 'Local.dat'));
    expect(spy.copies[0].dest.endsWith(path.join('profiles', 'acc-a', 'Guild Wars 2', 'Local.dat'))).toBe(true);
  });

  it('creates the per-account Guild Wars 2 directory when missing', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.startsWith('/host');
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result.ok).toBe(true);
    expect(spy.mkdirs.some((dir) => dir.endsWith(path.join('profiles', 'acc-a', 'Guild Wars 2')))).toBe(true);
  });

  it('returns the error code on copy failure', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.startsWith('/host');
    spy.failNextCopyWith = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) as NodeJS.ErrnoException;
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EACCES');
  });
});

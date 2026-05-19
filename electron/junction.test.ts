import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  isJunction,
  getJunctionTarget,
  repointJunction,
  migrateGw2DirToJunction,
  unmigrateJunctionToRealDir,
  type JunctionFs,
} from './junction.js';

type Entry =
  | { kind: 'dir' }
  | { kind: 'junction'; target: string }
  | { kind: 'file' };

type FakeFs = JunctionFs & {
  entries: Map<string, Entry>;
  parent: (p: string) => string;
  childrenOf: (p: string) => string[];
};

function fakeFs(initial: Record<string, Entry> = {}): FakeFs {
  const entries = new Map<string, Entry>(Object.entries(initial));

  const parent = (p: string) => path.dirname(p);
  const childrenOf = (p: string): string[] => {
    const prefix = p.endsWith(path.sep) ? p : p + path.sep;
    const direct: string[] = [];
    for (const key of entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const tail = key.slice(prefix.length);
      if (!tail || tail.includes(path.sep)) continue;
      direct.push(tail);
    }
    return direct;
  };

  const filesystem: JunctionFs = {
    existsSync: (p) => entries.has(p),
    lstatSync: (p) => {
      const entry = entries.get(p);
      if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return {
        isSymbolicLink: () => entry.kind === 'junction',
        isDirectory: () => entry.kind === 'dir',
      };
    },
    readlinkSync: (p) => {
      const entry = entries.get(p);
      if (!entry || entry.kind !== 'junction') throw new Error('EINVAL');
      return entry.target;
    },
    rmSync: (p, _opts) => {
      entries.delete(p);
    },
    mkdirSync: (p, opts) => {
      if (opts?.recursive) {
        const parts = p.split(path.sep).filter(Boolean);
        let cursor = path.parse(p).root || '';
        for (const part of parts) {
          cursor = cursor ? path.join(cursor, part) : part;
          if (!entries.has(cursor)) entries.set(cursor, { kind: 'dir' });
        }
      } else {
        entries.set(p, { kind: 'dir' });
      }
    },
    symlinkSync: (target, p, _type) => {
      entries.set(p, { kind: 'junction', target });
    },
    renameSync: (from, to) => {
      const entry = entries.get(from);
      if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      entries.delete(from);
      entries.set(to, entry);
    },
    readdirSync: (p) => childrenOf(p),
  };

  return Object.assign(filesystem, { entries, parent, childrenOf });
}

describe('isJunction', () => {
  it('returns false for a path that does not exist', () => {
    expect(isJunction('/missing', fakeFs())).toBe(false);
  });

  it('returns false for a real directory', () => {
    const fs = fakeFs({ '/real': { kind: 'dir' } });
    expect(isJunction('/real', fs)).toBe(false);
  });

  it('returns true for a junction', () => {
    const fs = fakeFs({ '/link': { kind: 'junction', target: '/elsewhere' } });
    expect(isJunction('/link', fs)).toBe(true);
  });
});

describe('getJunctionTarget', () => {
  it('returns null for a real directory', () => {
    const fs = fakeFs({ '/real': { kind: 'dir' } });
    expect(getJunctionTarget('/real', fs)).toBeNull();
  });

  it('returns the target for a junction', () => {
    const fs = fakeFs({ '/link': { kind: 'junction', target: '/elsewhere' } });
    expect(getJunctionTarget('/link', fs)).toBe('/elsewhere');
  });

  it('returns null for a missing path', () => {
    expect(getJunctionTarget('/missing', fakeFs())).toBeNull();
  });
});

describe('repointJunction', () => {
  it('creates a fresh junction when the path does not exist', () => {
    const fs = fakeFs({ '/target': { kind: 'dir' } });
    repointJunction('/link', '/target', fs);
    expect(getJunctionTarget('/link', fs)).toBe('/target');
  });

  it('replaces an existing junction with a new target', () => {
    const fs = fakeFs({
      '/target-old': { kind: 'dir' },
      '/target-new': { kind: 'dir' },
      '/link': { kind: 'junction', target: '/target-old' },
    });
    repointJunction('/link', '/target-new', fs);
    expect(getJunctionTarget('/link', fs)).toBe('/target-new');
  });

  it('replaces an empty real directory', () => {
    const fs = fakeFs({
      '/target': { kind: 'dir' },
      '/link': { kind: 'dir' },
    });
    repointJunction('/link', '/target', fs);
    expect(getJunctionTarget('/link', fs)).toBe('/target');
  });

  it('refuses to replace a non-empty real directory', () => {
    const link = path.join('/', 'link');
    const target = path.join('/', 'target');
    const fs = fakeFs({
      [target]: { kind: 'dir' },
      [link]: { kind: 'dir' },
      [path.join(link, 'file.txt')]: { kind: 'file' },
    });
    expect(() => repointJunction(link, target, fs)).toThrow(/non-empty/);
  });

  it('throws when target does not exist', () => {
    const fs = fakeFs({});
    expect(() => repointJunction('/link', '/missing-target', fs)).toThrow(/target does not exist/);
  });
});

describe('migrateGw2DirToJunction', () => {
  const HOST = path.join('/', 'appdata', 'Guild Wars 2');
  const DEFAULT = path.join('/', 'userdata', 'default-gw2-state', 'Guild Wars 2');

  it('returns already-migrated when host is already a junction', () => {
    const fs = fakeFs({ [HOST]: { kind: 'junction', target: '/anywhere' } });
    const result = migrateGw2DirToJunction({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('already-migrated');
    expect(result.movedFiles).toBe(0);
  });

  it('creates an empty default and a junction when host does not exist', () => {
    const fs = fakeFs({});
    const result = migrateGw2DirToJunction({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('created-empty');
    expect(isJunction(HOST, fs)).toBe(true);
    expect(getJunctionTarget(HOST, fs)).toBe(DEFAULT);
  });

  it('refuses to migrate while GW2 is running', () => {
    const fs = fakeFs({ [HOST]: { kind: 'dir' } });
    const result = migrateGw2DirToJunction({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => true, filesystem: fs,
    });
    expect(result.status).toBe('refused-gw2-running');
    expect(isJunction(HOST, fs)).toBe(false);
  });

  it('moves existing files into the default profile and replaces with a junction', () => {
    const fs = fakeFs({
      [HOST]: { kind: 'dir' },
      [path.join(HOST, 'Local.dat')]: { kind: 'file' },
      [path.join(HOST, 'GFXSettings.Gw2-64.exe.xml')]: { kind: 'file' },
    });
    const result = migrateGw2DirToJunction({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('migrated');
    expect(result.movedFiles).toBe(2);
    expect(fs.entries.has(path.join(DEFAULT, 'Local.dat'))).toBe(true);
    expect(fs.entries.has(path.join(DEFAULT, 'GFXSettings.Gw2-64.exe.xml'))).toBe(true);
    expect(getJunctionTarget(HOST, fs)).toBe(DEFAULT);
  });

  it('is idempotent — second call is a no-op', () => {
    const fs = fakeFs({
      [HOST]: { kind: 'dir' },
      [path.join(HOST, 'Local.dat')]: { kind: 'file' },
    });
    const first = migrateGw2DirToJunction({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(first.status).toBe('migrated');

    const second = migrateGw2DirToJunction({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(second.status).toBe('already-migrated');
  });
});

describe('unmigrateJunctionToRealDir', () => {
  const HOST = path.join('/', 'appdata', 'Guild Wars 2');
  const DEFAULT = path.join('/', 'userdata', 'default-gw2-state', 'Guild Wars 2');

  it('returns already-un-migrated when host is a real directory', () => {
    const fs = fakeFs({ [HOST]: { kind: 'dir' } });
    const result = unmigrateJunctionToRealDir({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('already-un-migrated');
    expect(result.movedFiles).toBe(0);
  });

  it('returns already-un-migrated when host does not exist', () => {
    const fs = fakeFs({});
    const result = unmigrateJunctionToRealDir({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('already-un-migrated');
  });

  it('refuses to un-migrate while GW2 is running', () => {
    const fs = fakeFs({
      [HOST]: { kind: 'junction', target: DEFAULT },
      [DEFAULT]: { kind: 'dir' },
    });
    const result = unmigrateJunctionToRealDir({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => true, filesystem: fs,
    });
    expect(result.status).toBe('refused-gw2-running');
    expect(isJunction(HOST, fs)).toBe(true);
  });

  it('removes the junction and restores files from defaultProfileDir', () => {
    const fs = fakeFs({
      [HOST]: { kind: 'junction', target: DEFAULT },
      [DEFAULT]: { kind: 'dir' },
      [path.join(DEFAULT, 'Local.dat')]: { kind: 'file' },
      [path.join(DEFAULT, 'GFXSettings.Gw2-64.exe.xml')]: { kind: 'file' },
    });
    const result = unmigrateJunctionToRealDir({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('unmigrated');
    expect(result.movedFiles).toBe(2);
    expect(isJunction(HOST, fs)).toBe(false);
    expect(fs.entries.has(path.join(HOST, 'Local.dat'))).toBe(true);
    expect(fs.entries.has(path.join(HOST, 'GFXSettings.Gw2-64.exe.xml'))).toBe(true);
    // Files moved out of defaultProfileDir
    expect(fs.entries.has(path.join(DEFAULT, 'Local.dat'))).toBe(false);
  });

  it('un-migrates to an empty real dir when defaultProfileDir is empty', () => {
    const fs = fakeFs({
      [HOST]: { kind: 'junction', target: DEFAULT },
      [DEFAULT]: { kind: 'dir' },
    });
    const result = unmigrateJunctionToRealDir({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('unmigrated');
    expect(result.movedFiles).toBe(0);
    expect(isJunction(HOST, fs)).toBe(false);
    expect(fs.entries.get(HOST)?.kind).toBe('dir');
  });

  it('un-migrates to an empty real dir when defaultProfileDir is missing', () => {
    const fs = fakeFs({
      [HOST]: { kind: 'junction', target: '/somewhere/else' },
    });
    const result = unmigrateJunctionToRealDir({
      hostPath: HOST, defaultProfileDir: DEFAULT,
      isGw2Running: () => false, filesystem: fs,
    });
    expect(result.status).toBe('unmigrated');
    expect(result.movedFiles).toBe(0);
    expect(isJunction(HOST, fs)).toBe(false);
    expect(fs.entries.get(HOST)?.kind).toBe('dir');
  });
});

import { describe, it, expect } from 'vitest';
import { interpretHelperResult, type SpawnResult } from './mutexCloser.js';
import { resolveProtonContext, type Filesystem } from './mutexCloser.js';

function result(status: number | null, stdout = '', stderr = ''): SpawnResult {
  return { status, stdout, stderr, error: null };
}

describe('interpretHelperResult', () => {
  it('returns ok=true with closedCount on exit 0', () => {
    const r = interpretHelperResult(result(0, '{"closed":2,"targets":2}'));
    expect(r).toEqual({ ok: true, closedCount: 2 });
  });

  it('returns ok=true closedCount=0 on exit 2 (no matching mutex)', () => {
    const r = interpretHelperResult(result(2, ''));
    expect(r.ok).toBe(true);
    expect(r.closedCount).toBe(0);
  });

  it('returns ok=true closedCount=0 on exit 3 (no target processes)', () => {
    const r = interpretHelperResult(result(3, ''));
    expect(r.ok).toBe(true);
    expect(r.closedCount).toBe(0);
  });

  it('returns ok=false with stderr on exit 4', () => {
    const r = interpretHelperResult(result(4, '', 'OpenProcess failed'));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('OpenProcess');
  });

  it('returns ok=false on unknown exit code', () => {
    const r = interpretHelperResult(result(99));
    expect(r.ok).toBe(false);
  });

  it('returns ok=false when spawn errored (e.g. binary missing)', () => {
    const r = interpretHelperResult({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT: no such file or directory'),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ENOENT');
  });

  it('parses closed count from stdout when JSON is well-formed', () => {
    const r = interpretHelperResult(result(0, '{"closed":5,"targets":7}'));
    expect(r.closedCount).toBe(5);
  });

  it('defaults closedCount to 1 on exit 0 when JSON is missing or malformed', () => {
    const r = interpretHelperResult(result(0, 'not-json'));
    expect(r).toEqual({ ok: true, closedCount: 1 });
  });
});

function fakeFs(files: Set<string>): Filesystem {
  return {
    existsSync: (p: string) => files.has(p),
    readFileSync: () => '',
    readdirSync: () => [],
  };
}

describe('resolveProtonContext', () => {
  it('returns null when no compatdata exists', () => {
    const fs = fakeFs(new Set());
    expect(resolveProtonContext('/home/u', ['/home/u/.local/share/Steam'], fs)).toBeNull();
  });

  it('finds compatdata and a Proton install in the same library', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      `${lib}/steamapps/common/Proton - Experimental/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: () => '',
      readdirSync: (dir) => dir.endsWith('steamapps/common') ? ['Proton - Experimental'] : [],
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx).not.toBeNull();
    expect(ctx!.compatDataPath).toBe(`${lib}/steamapps/compatdata/1284210`);
    expect(ctx!.protonPath).toBe(`${lib}/steamapps/common/Proton - Experimental/proton`);
    expect(ctx!.clientInstallPath).toBe(`${home}/.local/share/Steam`);
  });

  it('picks the newest Proton-prefixed directory by name when multiple exist', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      `${lib}/steamapps/common/Proton 8.0/proton`,
      `${lib}/steamapps/common/Proton 9.0/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: () => '',
      readdirSync: (dir) => dir.endsWith('steamapps/common')
        ? ['Proton 8.0', 'Proton 9.0', 'NotProton']
        : [],
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx!.protonPath).toBe(`${lib}/steamapps/common/Proton 9.0/proton`);
  });

  it('resolves Proton path via compatdata/config_info', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const protonInstallDir = `/opt/steam/Proton 8.0-via-config`;
    const configInfoPath = `${lib}/steamapps/compatdata/1284210/config_info`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      configInfoPath,
      `${protonInstallDir}/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: (p) => p === configInfoPath ? `${protonInstallDir}\nsome-arg\n` : '',
      readdirSync: () => [],
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx).not.toBeNull();
    expect(ctx!.protonPath).toBe(`${protonInstallDir}/proton`);
  });

  it('falls back to compatibilitytools.d when no Proton in steamapps/common', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const geProtonDir = `${home}/.steam/root/compatibilitytools.d/GE-Proton9-18`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      `${geProtonDir}/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: () => '',
      readdirSync: (dir) => {
        if (dir === `${home}/.steam/root/compatibilitytools.d`) return ['GE-Proton9-18'];
        return [];
      },
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx).not.toBeNull();
    expect(ctx!.protonPath).toBe(`${geProtonDir}/proton`);
  });

  it('prefers config_info over steamapps/common scan', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const configInfoProtonDir = `/opt/steam/ProtonFromConfigInfo`;
    const configInfoPath = `${lib}/steamapps/compatdata/1284210/config_info`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      configInfoPath,
      `${configInfoProtonDir}/proton`,
      `${lib}/steamapps/common/Proton 9.0/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: (p) => p === configInfoPath ? `${configInfoProtonDir}\n` : '',
      readdirSync: (dir) => dir.endsWith('steamapps/common') ? ['Proton 9.0'] : [],
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx).not.toBeNull();
    expect(ctx!.protonPath).toBe(`${configInfoProtonDir}/proton`);
  });
});

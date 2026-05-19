import { describe, it, expect } from 'vitest';
import {
  interpretInjectorResult,
  buildInjectorArgs,
  injectDll,
  type SpawnResult,
} from './dllInjector.js';

function result(status: number | null, stdout = '', stderr = ''): SpawnResult {
  return { status, stdout, stderr, error: null };
}

describe('interpretInjectorResult', () => {
  it('returns ok=true with pid on exit 0 and valid JSON', () => {
    expect(interpretInjectorResult(result(0, '{"pid":12345}'))).toEqual({
      ok: true,
      pid: 12345,
    });
  });

  it('tolerates whitespace around JSON', () => {
    expect(interpretInjectorResult(result(0, '  {"pid":42}\n'))).toEqual({
      ok: true,
      pid: 42,
    });
  });

  it('rejects exit 0 with non-JSON stdout', () => {
    const r = interpretInjectorResult(result(0, 'not-json'));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not parsable');
  });

  it('rejects exit 0 with malformed pid', () => {
    const r = interpretInjectorResult(result(0, '{"pid":"twelve"}'));
    expect(r.ok).toBe(false);
  });

  it('rejects exit 0 with non-positive pid', () => {
    const r = interpretInjectorResult(result(0, '{"pid":-1}'));
    expect(r.ok).toBe(false);
    const r2 = interpretInjectorResult(result(0, '{"pid":0}'));
    expect(r2.ok).toBe(false);
  });

  it('returns ok=false with stderr on exit 4', () => {
    const r = interpretInjectorResult(result(4, '', 'CreateProcessW failed: GetLastError=2'));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('CreateProcessW');
  });

  it('uses fallback reason when stderr is empty on exit 4', () => {
    const r = interpretInjectorResult(result(4, ''));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('injector reported failure');
  });

  it('returns ok=false on unknown exit code', () => {
    const r = interpretInjectorResult(result(99));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('99');
  });

  it('returns ok=false when spawn errored (e.g. binary missing)', () => {
    const r = interpretInjectorResult({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT: no such file or directory'),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ENOENT');
  });
});

describe('buildInjectorArgs', () => {
  it('emits required flags in order with --json appended', () => {
    expect(
      buildInjectorArgs({
        exe: 'C:\\gw2\\Gw2-64.exe',
        dll: 'C:\\axiam\\redirect.dll',
      }),
    ).toEqual([
      '--exe', 'C:\\gw2\\Gw2-64.exe',
      '--dll', 'C:\\axiam\\redirect.dll',
      '--json',
    ]);
  });

  it('appends --cwd when provided', () => {
    const args = buildInjectorArgs({
      exe: 'a',
      dll: 'b',
      cwd: 'C:\\gw2',
    });
    expect(args).toContain('--cwd');
    expect(args[args.indexOf('--cwd') + 1]).toBe('C:\\gw2');
  });

  it('appends --local-dat when provided', () => {
    const args = buildInjectorArgs({
      exe: 'a',
      dll: 'b',
      localDat: 'C:\\axiam\\profiles\\acc\\Local.dat',
    });
    expect(args).toContain('--local-dat');
    expect(args[args.indexOf('--local-dat') + 1]).toBe('C:\\axiam\\profiles\\acc\\Local.dat');
  });

  it('repeats --arg for every child arg in order', () => {
    const args = buildInjectorArgs({
      exe: 'a',
      dll: 'b',
      childArgs: ['-mumble', 'acc-A', '-shareArchive', '-autologin'],
    });
    // Filter just the --arg / value pairs to make the order assertion easy
    const seen: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--arg') seen.push(args[i + 1]);
    }
    expect(seen).toEqual(['-mumble', 'acc-A', '-shareArchive', '-autologin']);
  });

  it('omits --cwd / --local-dat when undefined', () => {
    const args = buildInjectorArgs({ exe: 'a', dll: 'b' });
    expect(args).not.toContain('--cwd');
    expect(args).not.toContain('--local-dat');
  });
});

describe('injectDll', () => {
  it('returns failure when injector binary is missing', () => {
    const r = injectDll({
      exe: 'C:\\gw2\\Gw2-64.exe',
      injectorPath: 'C:\\does\\not\\exist\\axiam-injector.exe',
      dllPath: __filename, // any real file path so the DLL check passes
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not found');
  });

  it('returns failure when DLL is missing', () => {
    const r = injectDll({
      exe: 'C:\\gw2\\Gw2-64.exe',
      injectorPath: __filename, // any real file
      dllPath: 'C:\\does\\not\\exist\\redirect.dll',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('DLL not found');
  });

  it('passes assembled args to the injected spawn and returns the parsed pid', () => {
    const calls: Array<{ exe: string; args: string[] }> = [];
    const fakeSpawn = ((exe: string, args: string[]) => {
      calls.push({ exe, args });
      return {
        status: 0,
        stdout: '{"pid":54321}',
        stderr: '',
        error: null,
        pid: 0,
        output: [],
        signal: null,
      };
    }) as unknown as typeof import('child_process').spawnSync;
    const r = injectDll({
      exe: 'C:\\gw2\\Gw2-64.exe',
      cwd: 'C:\\gw2',
      localDat: 'C:\\acc\\Local.dat',
      childArgs: ['-mumble', 'acc-A', '-shareArchive'],
      injectorPath: __filename,
      dllPath: __filename,
      spawn: fakeSpawn,
    });

    expect(r).toEqual({ ok: true, pid: 54321 });
    expect(calls).toHaveLength(1);
    expect(calls[0].exe).toBe(__filename);
    expect(calls[0].args).toEqual([
      '--exe', 'C:\\gw2\\Gw2-64.exe',
      '--dll', __filename,
      '--cwd', 'C:\\gw2',
      '--local-dat', 'C:\\acc\\Local.dat',
      '--arg', '-mumble',
      '--arg', 'acc-A',
      '--arg', '-shareArchive',
      '--json',
    ]);
  });

  it('surfaces non-zero exit codes as failures', () => {
    const fakeSpawn = (() => ({
      status: 4,
      stdout: '',
      stderr: 'CreateProcessW failed: GetLastError=2',
      error: null,
      pid: 0,
      output: [],
      signal: null,
    })) as unknown as typeof import('child_process').spawnSync;
    const r = injectDll({
      exe: 'C:\\gw2\\Gw2-64.exe',
      injectorPath: __filename,
      dllPath: __filename,
      spawn: fakeSpawn,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('CreateProcessW');
  });
});

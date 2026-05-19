import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

export interface InjectResult {
  ok: boolean;
  pid?: number;
  reason?: string;
}

/**
 * Translate the helper's exit code + stdout/stderr into a domain result.
 * Pure function — no IO — so unit tests can drive it without invoking
 * the actual binary.
 *
 * Helper exit codes (axiam-injector, mirrors axiam-mutex-closer):
 *   0  success, `{"pid":N}` on stdout
 *   4  argument error or Win32 failure (stderr has the reason)
 */
export function interpretInjectorResult(result: SpawnResult): InjectResult {
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  switch (result.status) {
    case 0: {
      const pid = parsePidFromJson(result.stdout);
      if (pid == null) {
        return { ok: false, reason: `injector exited 0 but stdout was not parsable: ${result.stdout.trim()}` };
      }
      return { ok: true, pid };
    }
    case 4:
      return { ok: false, reason: (result.stderr || 'injector reported failure').trim() };
    default:
      return { ok: false, reason: `injector exited with status ${result.status ?? 'null'}` };
  }
}

function parsePidFromJson(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed?.pid === 'number' && Number.isFinite(parsed.pid) && parsed.pid > 0) {
      return parsed.pid;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Resolve the path to the injector binary. Packaged builds look under
 * `process.resourcesPath`; dev builds fall back to the cargo `target/`
 * directory.
 */
export function getInjectorPath(): string {
  const packaged = path.join(process.resourcesPath || '', 'native', 'axiam-injector.exe');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(process.cwd(), 'tools', 'injector', 'target', 'release', 'axiam-injector.exe');
}

/**
 * Resolve the path to the redirect DLL. Same two-tier lookup as the
 * injector binary.
 */
export function getRedirectDllPath(): string {
  const packaged = path.join(process.resourcesPath || '', 'native', 'axiam_local_dat_redirect.dll');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(
    process.cwd(),
    'tools',
    'local-dat-redirect',
    'target',
    'release',
    'axiam_local_dat_redirect.dll',
  );
}

/**
 * Assemble the CLI args. Exported for testability — the actual call
 * site uses `injectDll(...)` below.
 */
export function buildInjectorArgs(opts: {
  exe: string;
  dll: string;
  cwd?: string;
  localDat?: string;
  childArgs?: string[];
}): string[] {
  const args: string[] = [
    '--exe', opts.exe,
    '--dll', opts.dll,
  ];
  if (opts.cwd) args.push('--cwd', opts.cwd);
  if (opts.localDat) args.push('--local-dat', opts.localDat);
  for (const a of opts.childArgs ?? []) {
    args.push('--arg', a);
  }
  args.push('--json');
  return args;
}

export interface InjectOptions {
  /** Absolute path to the target executable (Gw2-64.exe). */
  exe: string;
  /** Working directory for the child. Defaults to the target's directory. */
  cwd?: string;
  /** Per-account redirect target written into AXIAM_LOCAL_DAT_PATH. Optional. */
  localDat?: string;
  /** Args appended to the child's command line. */
  childArgs?: string[];
  /** Override the injector binary path. Tests use this. */
  injectorPath?: string;
  /** Override the redirect DLL path. Tests use this. */
  dllPath?: string;
  /** Override the spawn function. Tests use this. */
  spawn?: typeof spawnSync;
}

/**
 * Spawn the injector, parse its output, return the launched PID.
 *
 * The 15 s timeout is generous: the injector itself does CreateProcessW
 * + remote LoadLibraryW + a 5 s wait for DllMain. The 15 s upper bound
 * is for the cases where the OS is loaded and the kernel call latency
 * spikes. If the injector hangs longer than that something is wrong.
 */
export function injectDll(opts: InjectOptions): InjectResult {
  const injectorPath = opts.injectorPath ?? getInjectorPath();
  const dllPath = opts.dllPath ?? getRedirectDllPath();

  if (!fs.existsSync(injectorPath)) {
    return { ok: false, reason: `injector binary not found at ${injectorPath}` };
  }
  if (!fs.existsSync(dllPath)) {
    return { ok: false, reason: `redirect DLL not found at ${dllPath}` };
  }

  const args = buildInjectorArgs({
    exe: opts.exe,
    dll: dllPath,
    cwd: opts.cwd,
    localDat: opts.localDat,
    childArgs: opts.childArgs,
  });

  const spawn = opts.spawn ?? spawnSync;
  const result = spawn(injectorPath, args, { encoding: 'utf8', timeout: 15000 });
  return interpretInjectorResult({
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ?? null,
  });
}

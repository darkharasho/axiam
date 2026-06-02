import path from 'path';

/** Absolute path to Gw2.dat inside a GW2 install directory. */
export function gw2DatPath(installDir: string): string {
  return path.join(installDir, 'Gw2.dat');
}

/** Absolute path to Gw2-64.exe inside a GW2 install directory. */
export function gw2ExePath(installDir: string): string {
  return path.join(installDir, 'Gw2-64.exe');
}

/**
 * Gw2.dat is patched by ArenaNet's launcher, not Steam. After a Steam update
 * the exe is refreshed but Gw2.dat is left stale, so exe-newer-than-dat means
 * a patch run is needed before an -autologin launch will succeed.
 *
 * Fail-safe: a missing mtime (null) returns false so we never block a launch
 * on an unreadable file.
 */
export function isPatchNeeded(exeMtimeMs: number | null, datMtimeMs: number | null): boolean {
  if (exeMtimeMs == null || datMtimeMs == null) return false;
  return exeMtimeMs > datMtimeMs;
}

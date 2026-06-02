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

export interface StabilitySample {
  size: number;
  mtimeMs: number;
}

export interface StabilityConfig {
  /** Quiet time after the last change before the patch is considered done. */
  quietWindowMs: number;
  /** If the dat never changes, proceed anyway after this long. */
  graceWindowMs: number;
  /** Absolute ceiling before giving up with a timeout. */
  ceilingMs: number;
}

export type StabilityVerdict = 'pending' | 'done' | 'proceed' | 'timeout';

export interface StabilityState {
  startMs: number;
  changedOnce: boolean;
  lastChangeMs: number | null;
  lastSample: StabilitySample | null;
}

/** Create the initial stepper state, stamped with the loop's start time. */
export function createStabilityState(startMs: number): StabilityState {
  return { startMs, changedOnce: false, lastChangeMs: null, lastSample: null };
}

function sameSample(a: StabilitySample | null, b: StabilitySample): boolean {
  return a != null && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/**
 * Pure reducer: fold one Gw2.dat sample taken at `nowMs` into the state and
 * return the next state plus a verdict. The caller polls on a timer and stops
 * when the verdict is anything other than 'pending'.
 */
export function stepStability(
  state: StabilityState,
  sample: StabilitySample,
  nowMs: number,
  config: StabilityConfig,
): { state: StabilityState; verdict: StabilityVerdict } {
  if (nowMs - state.startMs >= config.ceilingMs) {
    return { state, verdict: 'timeout' };
  }

  if (!sameSample(state.lastSample, sample)) {
    // The very first observed sample establishes a baseline; it is not itself a
    // change. Only a sample that differs from a prior non-null sample counts as
    // a real change and updates lastChangeMs.
    const isFirstSample = state.lastSample === null;
    const next: StabilityState = {
      ...state,
      changedOnce: state.changedOnce || !isFirstSample,
      lastChangeMs: isFirstSample ? state.lastChangeMs : nowMs,
      lastSample: sample,
    };
    return { state: next, verdict: 'pending' };
  }

  // done requires a real change to have happened, then quiet for the window.
  if (state.changedOnce && state.lastChangeMs != null && nowMs - state.lastChangeMs >= config.quietWindowMs) {
    return { state, verdict: 'done' };
  }

  // proceed only when nothing ever changed and we waited out the grace window.
  if (!state.changedOnce && nowMs - state.startMs >= config.graceWindowMs) {
    return { state, verdict: 'proceed' };
  }

  return { state, verdict: 'pending' };
}

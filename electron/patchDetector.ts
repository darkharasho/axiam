import path from 'path';

/** Absolute path to Gw2.dat inside a GW2 install directory. */
export function gw2DatPath(installDir: string): string {
  return path.join(installDir, 'Gw2.dat');
}

/** Absolute path to Gw2-64.exe inside a GW2 install directory. */
export function gw2ExePath(installDir: string): string {
  return path.join(installDir, 'Gw2-64.exe');
}

/** Absolute path to Crash.dmp, which GW2 writes into its install dir on a crash. */
export function gw2CrashDumpPath(installDir: string): string {
  return path.join(installDir, 'Crash.dmp');
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

/**
 * Reactive patch recovery. The mtime heuristic above can't see a pending
 * ArenaNet update — an available update doesn't touch any local file until the
 * patcher actually runs — so an `-autologin` launch can still crash with
 * "Client needs to be patched first". We detect that *after the fact*: GW2
 * writes a fresh Crash.dmp into its install dir, so a crash dump stamped at or
 * after our launch start means this launch crashed (rather than an old dump
 * left over from a previous run).
 */
export function isCrashDumpFresh(crashMtimeMs: number | null, launchStartMs: number): boolean {
  if (crashMtimeMs == null) return false;
  return crashMtimeMs >= launchStartMs;
}

export interface PatchRecoveryInput {
  /** Only an -autologin launch can hit the "needs to be patched first" crash. */
  usedAutologin: boolean;
  /** The bound GW2 process disappeared within the recovery watch window. */
  processExitedWithinWindow: boolean;
  /** A Crash.dmp dated at/after this launch appeared (see isCrashDumpFresh). */
  crashDumpFresh: boolean;
  /** Guards against relaunch loops — true once we've already recovered this launch. */
  alreadyRecovered: boolean;
}

/**
 * Decide whether a just-exited launch looks like a post-update patch crash that
 * we should recover from by force-patching and relaunching once. Requires a
 * fast exit *and* a fresh crash dump together so a user who simply closes the
 * game quickly is never mistaken for a crash.
 */
export function shouldAttemptPatchRecovery(input: PatchRecoveryInput): boolean {
  if (!input.usedAutologin) return false;
  if (input.alreadyRecovered) return false;
  return input.processExitedWithinWindow && input.crashDumpFresh;
}

/**
 * After a forced patch run, an `-autologin` relaunch is only safe when the
 * patcher genuinely changed Gw2.dat (`done`). Every other verdict means we have
 * no evidence a patch happened: `proceed` = the dat never changed at all (likely
 * nothing was pending, or the crash was unrelated — e.g. an addon/Proton crash),
 * and `timeout` = it changed but never settled. Relaunching `-autologin` in
 * those cases just reproduces the original crash, which is exactly the field
 * crash-loop this guards against.
 */
export function patchActuallyRan(verdict: StabilityVerdict): boolean {
  return verdict === 'done';
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

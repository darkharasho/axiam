# GW2 Post-Update Patch Detection & Auto-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a stale `Gw2.dat` before an `-autologin` launch and auto-run the vanilla patcher to completion, avoiding the `Client needs to be patched first` startup crash.

**Architecture:** A new pure, unit-tested module `electron/patchDetector.ts` holds the "is a patch needed?" verdict and the `Gw2.dat`-stability state machine. `electron/main.ts` orchestrates: inside `doLaunch`, when `-autologin` is in play, it resolves the install dir, asks `patchDetector` whether a patch is needed, and if so runs a vanilla (no-`-autologin`) launch, polls `Gw2.dat` to stability using the tested stepper, kills that vanilla instance, then proceeds with the normal launch. A new `patching` launch phase surfaces an in-progress state in the UI.

**Tech Stack:** TypeScript, Electron (main + preload + React renderer), Vitest, Node `fs`/`child_process`.

**Spec:** `docs/superpowers/specs/2026-06-02-gw2-patch-detection-design.md`

---

## File Structure

- `electron/patchDetector.ts` — **new.** Pure logic: `gw2DatPath`, `gw2ExePath`, `isPatchNeeded`, and the stability stepper (`createStabilityState`, `stepStability`). No `fs`/`child_process` imports — callers inject samples and timestamps.
- `electron/patchDetector.test.ts` — **new.** Vitest unit tests for the pure logic.
- `electron/launchStateMachine.ts` — **modify.** Add `'patching'` to the `LaunchPhase` union.
- `electron/main.ts` — **modify.** Add `resolveGw2InstallDir`, `runPatcher`, and the `doLaunch` integration call.
- `src/App.tsx` — **modify.** Add `'patching'` to the renderer `LaunchPhase` type and map it in `mapLaunchPhaseToStatus`.
- `src/vite-env.d.ts` — **modify.** Add `'patching'` to the `getLaunchStates` phase union so the type stays in sync.

---

## Task 1: `patchDetector` — install paths & patch-needed verdict

**Files:**
- Create: `electron/patchDetector.ts`
- Test: `electron/patchDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/patchDetector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { gw2DatPath, gw2ExePath, isPatchNeeded } from './patchDetector.js';

describe('patchDetector paths', () => {
  it('derives Gw2.dat and Gw2-64.exe paths from an install dir', () => {
    const dir = '/games/Guild Wars 2';
    expect(gw2DatPath(dir)).toBe('/games/Guild Wars 2/Gw2.dat');
    expect(gw2ExePath(dir)).toBe('/games/Guild Wars 2/Gw2-64.exe');
  });
});

describe('isPatchNeeded', () => {
  it('is true when the exe is newer than the dat', () => {
    expect(isPatchNeeded(2000, 1000)).toBe(true);
  });

  it('is false when the dat is newer than or equal to the exe', () => {
    expect(isPatchNeeded(1000, 2000)).toBe(false);
    expect(isPatchNeeded(1000, 1000)).toBe(false);
  });

  it('is false (fail-safe) when either mtime is null', () => {
    expect(isPatchNeeded(null, 1000)).toBe(false);
    expect(isPatchNeeded(2000, null)).toBe(false);
    expect(isPatchNeeded(null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/patchDetector.test.ts`
Expected: FAIL — cannot find module `./patchDetector.js` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

Create `electron/patchDetector.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/patchDetector.test.ts`
Expected: PASS (all cases in this file).

- [ ] **Step 5: Commit**

```bash
git add electron/patchDetector.ts electron/patchDetector.test.ts
git commit -m "feat(patch): add patch-needed verdict and install path helpers"
```

---

## Task 2: `patchDetector` — Gw2.dat stability stepper

The stepper is a pure reducer driven by the orchestrator's poll loop. The
orchestrator samples `Gw2.dat` (size + mtime) on a timer and feeds each sample
plus the current timestamp into `stepStability`, which returns an updated state
and a verdict: `pending` (keep polling), `done` (patch finished), `proceed`
(nothing ever changed — proceed anyway after a grace window), or `timeout`.

**Files:**
- Modify: `electron/patchDetector.ts`
- Test: `electron/patchDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `electron/patchDetector.test.ts`:

```typescript
import { createStabilityState, stepStability } from './patchDetector.js';
import type { StabilityConfig, StabilitySample } from './patchDetector.js';

const CONFIG: StabilityConfig = { quietWindowMs: 10_000, graceWindowMs: 20_000, ceilingMs: 300_000 };
const sample = (size: number, mtimeMs: number): StabilitySample => ({ size, mtimeMs });

describe('stepStability', () => {
  it('stays pending while the dat keeps changing', () => {
    let state = createStabilityState(0);
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(200, 200), 4_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(300, 300), 6_000, CONFIG);
    expect(r.verdict).toBe('pending');
  });

  it('resolves done after the quiet window once it changed then held steady', () => {
    let state = createStabilityState(0);
    // First change at t=2s.
    let r = stepStability(state, sample(200, 200), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // Same sample at t=8s — still inside the 10s quiet window.
    r = stepStability(r.state, sample(200, 200), 8_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // Same sample at t=12s — 10s since last change → done.
    r = stepStability(r.state, sample(200, 200), 12_000, CONFIG);
    expect(r.verdict).toBe('done');
  });

  it('resolves proceed after the grace window when nothing ever changes', () => {
    let state = createStabilityState(0);
    // Identical sample to the initial; never changes.
    let r = stepStability(state, sample(100, 100), 5_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(100, 100), 20_000, CONFIG);
    expect(r.verdict).toBe('proceed');
  });

  it('resolves timeout at the ceiling even if still changing', () => {
    let state = createStabilityState(0);
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(999, 999), 300_000, CONFIG);
    expect(r.verdict).toBe('timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/patchDetector.test.ts`
Expected: FAIL — `createStabilityState` / `stepStability` / types are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `electron/patchDetector.ts`:

```typescript
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
    const next: StabilityState = {
      ...state,
      changedOnce: state.changedOnce || state.lastSample != null,
      lastChangeMs: state.lastSample != null ? nowMs : state.lastChangeMs,
      lastSample: sample,
    };
    return { state: next, verdict: 'pending' };
  }

  if (state.changedOnce && state.lastChangeMs != null && nowMs - state.lastChangeMs >= config.quietWindowMs) {
    return { state, verdict: 'done' };
  }

  if (!state.changedOnce && nowMs - state.startMs >= config.graceWindowMs) {
    return { state, verdict: 'proceed' };
  }

  return { state, verdict: 'pending' };
}
```

Note on the first sample: `lastSample` starts `null`, so the first observed
sample is recorded without counting as a change (`changedOnce` stays false until
a *second, different* sample arrives). This is why the "done" test sees its first
distinct sample at t=2s set `lastChangeMs`, and the "proceed" test — whose
samples never differ from the first — falls through to the grace window.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/patchDetector.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add electron/patchDetector.ts electron/patchDetector.test.ts
git commit -m "feat(patch): add Gw2.dat stability stepper"
```

---

## Task 3: Add the `patching` launch phase

**Files:**
- Modify: `electron/launchStateMachine.ts:1-11`

- [ ] **Step 1: Add the phase to the union**

In `electron/launchStateMachine.ts`, edit the `LaunchPhase` type to add `'patching'` after `'launch_requested'`:

```typescript
export type LaunchPhase =
  | 'idle'
  | 'launch_requested'
  | 'patching'
  | 'launcher_started'
  | 'credentials_waiting'
  | 'credentials_submitted'
  | 'process_detected'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'errored';
```

- [ ] **Step 2: Verify the project still type-checks and tests pass**

Run: `npx vitest run electron/launchStateMachine`
Expected: PASS (existing state-machine tests unaffected — the union only widened).

- [ ] **Step 3: Commit**

```bash
git add electron/launchStateMachine.ts
git commit -m "feat(launch): add patching launch phase"
```

---

## Task 4: Orchestrate detection & auto-recovery in `doLaunch`

This task wires the tested helpers into `electron/main.ts`. The orchestrator is
thin (timers, `fs.statSync`, spawn, kill) and is verified by the unit tests on
`patchDetector` plus manual launch testing — consistent with the rest of
`main.ts`, which is not unit-tested.

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Import the patch detector**

Near the other local `electron/*.js` imports at the top of `electron/main.ts` (e.g. just after the `./launchSerializer.js` / `./launchStateMachine.js` imports), add:

```typescript
import {
  gw2DatPath,
  gw2ExePath,
  isPatchNeeded,
  createStabilityState,
  stepStability,
  type StabilityConfig,
} from './patchDetector.js';
```

- [ ] **Step 2: Add install-dir resolution + the `runPatcher` orchestrator**

Add these helpers in `electron/main.ts` immediately **after** the `launchViaSteam` function (it ends at the line with the closing brace around `main.ts:609`), so `runPatcher` can call `launchViaSteam`:

```typescript
const PATCH_STABILITY_CONFIG: StabilityConfig = {
  quietWindowMs: 10_000,
  graceWindowMs: 20_000,
  ceilingMs: 300_000,
};
const PATCH_POLL_INTERVAL_MS = 2_000;

/**
 * Resolve the GW2 install directory for patch detection. Prefers an explicit
 * Gw2-64.exe path (the direct-launch path on Windows); otherwise falls back to
 * auto-location (covers Linux/Steam). Returns null when nothing is found, in
 * which case the caller skips patch detection entirely.
 */
function resolveGw2InstallDir(gw2Path?: string): string | null {
  if (gw2Path && fs.existsSync(gw2Path)) {
    return path.dirname(gw2Path);
  }
  const located = autoLocateGw2ExecutablePath();
  if (located.found && located.path && fs.existsSync(located.path)) {
    return path.dirname(located.path);
  }
  return null;
}

/** statSync helper that returns null instead of throwing on a missing file. */
function safeMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** Sample Gw2.dat size+mtime, or null if it can't be read. */
function sampleGw2Dat(datPath: string): { size: number; mtimeMs: number } | null {
  try {
    const st = fs.statSync(datPath);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * After a game update, -autologin crashes with "Client needs to be patched
 * first" because it bypasses the launcher's patcher. Detect a stale Gw2.dat
 * (exe newer than dat) and, if found, run GW2 once WITHOUT -autologin so the
 * launcher patches Gw2.dat, wait for the dat to stabilize, then kill that
 * vanilla instance so the real -autologin launch can proceed cleanly.
 *
 * Returns true if a patch run was performed (so the caller knows a vanilla
 * instance may have just been torn down), false if no patch was needed.
 */
async function runPatcherIfNeeded(id: string, installDir: string): Promise<boolean> {
  const exeMtime = safeMtimeMs(gw2ExePath(installDir));
  const datMtime = safeMtimeMs(gw2DatPath(installDir));
  if (!isPatchNeeded(exeMtime, datMtime)) {
    return false;
  }

  logMain('launch', `[patch] account=${id} Gw2.dat looks stale (exe newer than dat); running patcher`);
  launchStateMachine.setState(id, 'patching', 'inferred', 'Patching GW2 after update…');

  // Vanilla launch: no -autologin, no -mumble. -shareArchive is safe and lets
  // the patcher run alongside any other instance.
  const datPath = gw2DatPath(installDir);
  const preLaunchPids = new Set(getAllRunningGw2Pids());
  launchViaSteam(['-shareArchive']);

  // Poll Gw2.dat to stability using the tested stepper.
  let state = createStabilityState(Date.now());
  const verdict = await new Promise<'done' | 'proceed' | 'timeout'>((resolve) => {
    const timer = setInterval(() => {
      // Honor a Stop click during patching.
      const current = launchStateMachine.getState(id);
      if (current && (current.phase === 'stopping' || current.phase === 'stopped')) {
        clearInterval(timer);
        resolve('proceed');
        return;
      }
      const sample = sampleGw2Dat(datPath);
      if (sample == null) return; // transient unreadable dat; keep polling
      const stepped = stepStability(state, sample, Date.now(), PATCH_STABILITY_CONFIG);
      state = stepped.state;
      if (stepped.verdict !== 'pending') {
        clearInterval(timer);
        resolve(stepped.verdict);
      }
    }, PATCH_POLL_INTERVAL_MS);
  });

  if (verdict === 'timeout') {
    logMainWarn('launch', `[patch] account=${id} patch timed out after ${PATCH_STABILITY_CONFIG.ceilingMs}ms`);
  } else {
    logMain('launch', `[patch] account=${id} patch ${verdict}; tearing down vanilla instance`);
  }

  // Kill the vanilla instance(s) we spawned so the real -autologin launch
  // starts from a clean slate. Only terminate pids that appeared after our
  // vanilla spawn — never an unrelated instance that predated it.
  for (const pid of getAllRunningGw2Pids()) {
    if (!preLaunchPids.has(pid)) {
      terminatePid(pid);
    }
  }
  // Give the OS a moment to release the GW2 mutex before the next launch.
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  return true;
}
```

- [ ] **Step 3: Call the orchestrator from `doLaunch`**

In `electron/main.ts`, find the block that ends the `useAutologin` resolution — the final `else` branch logging `No saved login for account=...` (around `main.ts:1898-1900`), immediately **before** the `// Always pass -shareArchive` comment. Insert the patch check there:

```typescript
  } else {
    logMain('launch', `[local-dat] No saved login for account=${id}, launching without -autologin`);
  }

  // After a game update, -autologin crashes ("Client needs to be patched
  // first"). If we're about to use -autologin, make sure Gw2.dat is current
  // first — running the vanilla patcher once if it isn't.
  if (useAutologin) {
    const installDir = resolveGw2InstallDir(gw2Path);
    if (installDir) {
      try {
        await runPatcherIfNeeded(id, installDir);
      } catch (err: any) {
        logMainWarn('launch', `[patch] account=${id} patch check failed: ${err?.message ?? err}; continuing to launch`);
      }
    }
  }

  // Always pass -shareArchive so concurrent instances can both open the
```

(The existing `// Always pass -shareArchive ...` comment and the `const userExtras = ...` line that follow it stay exactly as they are.)

- [ ] **Step 4: Build the main process to verify it compiles**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: No errors. (If the project has no `--noEmit` script, run `npm run build` and confirm the electron build step succeeds.)

- [ ] **Step 5: Run the full electron test suite to confirm no regressions**

Run: `npx vitest run electron/`
Expected: PASS — all existing electron tests plus the new `patchDetector` tests.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): auto-run GW2 patcher before -autologin when Gw2.dat is stale"
```

---

## Task 5: Surface the `patching` phase in the renderer

The renderer maps raw `LaunchPhase` values to a coarse card status via
`mapLaunchPhaseToStatus`. Map `patching` to `'launching'` so the card shows the
existing in-progress spinner (and, critically, doesn't fall through to `null` on
an unknown phase). The phase unions in `App.tsx` and `vite-env.d.ts` must widen
to match the main-process type.

**Files:**
- Modify: `src/App.tsx:19` and `src/App.tsx:1027-1034`
- Modify: `src/vite-env.d.ts:29`

- [ ] **Step 1: Widen the renderer `LaunchPhase` type**

In `src/App.tsx`, edit the type alias on line 19 to include `'patching'`:

```typescript
type LaunchPhase = 'idle' | 'launch_requested' | 'patching' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
```

- [ ] **Step 2: Map the phase to a status**

In `src/App.tsx`, update `mapLaunchPhaseToStatus` (around line 1027) so the first
branch also covers `patching`:

```typescript
function mapLaunchPhaseToStatus(phase: LaunchPhase): 'idle' | 'launching' | 'running' | 'stopping' | 'errored' | null {
    if (phase === 'launch_requested' || phase === 'patching' || phase === 'launcher_started' || phase === 'credentials_waiting' || phase === 'credentials_submitted') {
        return 'launching';
    }
    if (phase === 'process_detected' || phase === 'running') return 'running';
    if (phase === 'stopping') return 'stopping';
    if (phase === 'errored') return 'errored';
    if (phase === 'stopped' || phase === 'idle') return 'idle';
    return null;
}
```

- [ ] **Step 3: Keep the preload/IPC type in sync**

In `src/vite-env.d.ts`, edit the `getLaunchStates` phase union (line 29) to add `'patching'` after `'launch_requested'`:

```typescript
        phase: 'idle' | 'launch_requested' | 'patching' | 'launcher_started' | 'credentials_waiting' | 'credentials_submitted' | 'process_detected' | 'running' | 'stopping' | 'stopped' | 'errored';
```

- [ ] **Step 4: Type-check the renderer**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors — every place that switches on `LaunchPhase` already has a default/`null` path, and the unions now match.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/vite-env.d.ts
git commit -m "feat(ui): surface the patching launch phase as an in-progress state"
```

---

## Task 6: Update the knowledge graph

Per `CLAUDE.md`, refresh the AST graph after code changes.

- [ ] **Step 1: Update graphify**

Run: `graphify update .`
Expected: Completes without error (AST-only, no API cost).

- [ ] **Step 2: Commit if the graph changed**

```bash
git add graphify-out
git commit -m "chore(graph): update knowledge graph for patch detection" || echo "no graph changes"
```

---

## Manual Verification (post-implementation)

These confirm the real behavior the unit tests can't (live GW2 + Steam):

1. **No-patch path (no regression):** With `Gw2.dat` already current, launch an
   account. Expected: launches straight through with `-autologin`; no `patching`
   phase appears in `main.log`.
2. **Patch path:** Force the signal by `touch`-ing `Gw2-64.exe` so its mtime is
   newer than `Gw2.dat`, then launch. Expected: `main.log` shows
   `[patch] ... Gw2.dat looks stale ... running patcher`, the card shows the
   in-progress state, a vanilla GW2 launcher opens and patches, the stepper
   resolves (`done`/`proceed`), the vanilla instance is killed, then the real
   `-autologin` launch proceeds. (If GW2 genuinely had nothing to patch, the
   `proceed` grace path fires after ~20 s — acceptable.)
3. **Stop during patch:** Click Stop while the patcher phase is active. Expected:
   the poll loop observes the `stopping`/`stopped` state and aborts the relaunch.

---

## Self-Review Notes

- **Spec coverage:** detection signal (Task 1), stability detection (Task 2),
  `patching` phase + UI (Tasks 3, 5), auto-recovery flow incl. install-dir
  resolution, vanilla spawn, stop-during-patch, teardown, and `launchSerializer`
  exclusivity — exclusivity is inherited because `doLaunch` already runs inside
  the serializer (Task 4). Edge cases (unresolvable dir, missing files, never-
  changing dat, timeout) are covered by `isPatchNeeded`'s null fail-safe,
  `resolveGw2InstallDir` returning null, and the stepper's `proceed`/`timeout`
  verdicts.
- **Deferred per spec:** `appmanifest_1284210.acf` corroboration is intentionally
  not implemented (YAGNI); `patchDetector` keeps a clean seam for it.
- **Type consistency:** `LaunchPhase` gains `'patching'` in all three
  declarations (`launchStateMachine.ts`, `App.tsx`, `vite-env.d.ts`). Helper
  names (`gw2DatPath`, `gw2ExePath`, `isPatchNeeded`, `createStabilityState`,
  `stepStability`, `StabilityConfig`, `StabilitySample`) are used identically in
  tests and `main.ts`.

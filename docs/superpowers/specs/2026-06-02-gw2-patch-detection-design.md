# GW2 Post-Update Patch Detection & Auto-Recovery

**Date:** 2026-06-02
**Status:** Design approved, pending implementation plan

## Problem

GW2 crashes at startup with the assertion `Client needs to be patched first`
(`ApExe.cpp` line 231) when launched with `-autologin` immediately after a Steam
game update.

The `-autologin` flag bypasses the GW2 launcher's built-in asset patcher. After a
game update, `Gw2.dat` must be patched by the launcher before the client can run.
With `-autologin`, the game tries to launch directly into the client, which fails
because the local assets are out of date.

AxiAM always passes `-autologin` when an account has saved credentials
(`doLaunch` in `electron/main.ts`), so every account hits this crash after an
update until the game is run once without `-autologin`.

## Goal

Detect, before launch, that `Gw2.dat` is likely stale, and automatically run the
patcher (a vanilla launch without `-autologin`) to completion before proceeding
with the normal per-account `-autologin` launch. Cross-platform (Windows +
Linux/Steam). The user should not have to manually run vanilla.

## Non-Goals

- Catching the crash exit code as a fallback. On Linux the game launches through
  Steam (`steam -applaunch`), so we never see the client's exit code, and on
  Windows the child is detached/unref'd. The pre-launch mtime signal is the
  reliable cross-platform mechanism; crash-catch is out of scope.
- Logging the user in during the patch run. The vanilla patch launch deliberately
  carries no credentials; it patches `Gw2.dat` and stops at the login screen.

## Detection Signal

`Gw2.dat` is patched by ArenaNet's launcher, not by Steam. After a Steam update,
Steam refreshes `Gw2-64.exe` but leaves `Gw2.dat` stale.

**Primary signal (cross-platform):**

> `Gw2-64.exe` mtime > `Gw2.dat` mtime → patch needed.

Both files always sit in the same install directory. Two `fs.stat` calls, no GW2
internals.

**Optional corroboration (Steam only), deferred:** `appmanifest_1284210.acf`
`LastUpdated` > `Gw2.dat` mtime. Not shipped in the first iteration (YAGNI). The
`patchDetector` module exposes a clean seam so this can be added as a secondary
confirmation later without reworking callers.

## Architecture

New module `electron/patchDetector.ts`, holding pure, unit-testable logic (takes
mtimes/paths in, returns a verdict — no direct `fs` in the core decision
functions, mirroring `launchStateMachine.ts` / `quitWatcher.ts` /
`launchSerializer.ts`).

Responsibilities:

1. **Install-dir resolution** — resolve the GW2 install directory from the same
   sources `doLaunch` already uses:
   - Windows: `path.dirname(gw2Path)` (configured or auto-located `Gw2-64.exe`).
   - Linux: `autoLocateGw2ExecutablePath()` + Steam library scan (existing).
   - Returns `null` gracefully when nothing is found.
2. **Patch-needed verdict** — given exe mtime and dat mtime, return
   `{ patchNeeded: boolean }`. False when either file is missing (fail safe: don't
   block launch on a missing-file edge case).
3. **Stability detector** — a small state helper driving the wait loop (see flow).

`doLaunch` (in `electron/main.ts`) stays thin: it resolves the install dir, calls
the verdict helper, and if a patch is needed, runs the recovery step before
building `args`. Orchestration in `main.ts`, logic in the helper — consistent with
the existing structure.

## Auto-Recovery Flow

Slots into `doLaunch` after `useAutologin` is resolved and before `args` is built.
Runs only when `useAutologin === true` (the crash only happens with `-autologin`).

```
doLaunch(id):
  ... existing useAutologin resolution ...
  if (useAutologin):
     installDir = patchDetector.resolveInstallDir(...)
     if (installDir && patchDetector.check(installDir).patchNeeded):
        await runPatcher(installDir, id)
  ... build args, spawn as today ...
```

### `runPatcher(installDir, id)`

1. Set launch state → new phase `patching` (`'inferred'`), note
   `"Patching GW2 after update…"` so the UI shows status.
2. Spawn GW2 **vanilla** via the same launch path used today (Steam on Linux,
   direct-exe / Steam-URI on Windows) with args `['-shareArchive']` only — **no
   `-autologin`, no `-mumble`**. Track the spawned PID for teardown.
3. **Wait for patch completion** via `Gw2.dat` stability:
   - Poll size + mtime every ~2 s.
   - Once `Gw2.dat` has changed at least once and then held steady for **~10 s**,
     the patch is considered done.
   - If `Gw2.dat` never changes, wait out a short grace window (**~20 s**) then
     proceed anyway — avoids blocking on a patch that isn't happening (false
     positive, or already patched).
   - Hard ceiling **5 min** → error state
     `"GW2 patch timed out — run the game once manually."`
4. **Close the vanilla instance.** Track the vanilla PID spawned in step 2 and stop
   it via the existing stop-process helper (`taskkill /PID … /T /F` on Windows,
   `kill` on Linux). This clears the lingering launcher/login window so the
   subsequent `-autologin` launch starts clean.
5. Return to `doLaunch`, which proceeds with the normal per-account `-autologin`
   spawn.

### Exclusivity

`doLaunch` already runs inside `launchSerializer`, so the entire detect → patch →
relaunch sequence is exclusive — no other account launch interleaves with a patch
run.

## Edge Cases

| Case | Behavior |
|------|----------|
| Install dir not resolvable | Skip detection; launch as today. No regression. |
| `Gw2.dat` or `Gw2-64.exe` missing | Verdict `patchNeeded: false`; launch as today. |
| `Gw2.dat` never changes after vanilla spawn | Proceed after ~20 s grace window. |
| User clicks Stop during patching | Honor existing `stopping`/`stopped` state checks; abort the relaunch. |
| Patch exceeds 5 min | Error state with a clear "run the game once manually" message. |
| Multi-instance launch | Patch runs inside `launchSerializer`; exclusive by construction. |

## UI Surface

- Add `patching` to `LaunchPhase` in `electron/launchStateMachine.ts`.
- The renderer (`src/components/AccountCard.tsx`) already reacts to launch states
  via the `get-launch-states` IPC channel; it gains a "Patching GW2…"
  label/spinner for the new phase.
- No new IPC channels — this rides the existing launch-state plumbing.

## Testing (TDD)

Pure logic in `patchDetector.ts` is fully unit-tested with injected stat data,
mirroring `quitWatcher.test.ts` / `launchSerializer.test.ts`:

- **Verdict:** `patchNeeded` true when exe mtime > dat mtime; false otherwise; false
  when either file is missing.
- **Stability detector:** stays pending while size/mtime change; resolves "done"
  after the quiet window; resolves "proceed-anyway" after the grace window when
  nothing ever changed; resolves "timeout" at the ceiling.
- **Install-dir resolution:** returns `null` gracefully when nothing is found.

The `doLaunch` integration stays thin (calls tested helpers), consistent with the
existing orchestration/logic split in `main.ts`.

## Files Touched

- `electron/patchDetector.ts` — new module (logic + resolution helpers).
- `electron/patchDetector.test.ts` — new unit tests.
- `electron/main.ts` — `doLaunch` integration + `runPatcher` orchestration.
- `electron/launchStateMachine.ts` — add `patching` phase.
- `src/components/AccountCard.tsx` — render the `patching` phase.

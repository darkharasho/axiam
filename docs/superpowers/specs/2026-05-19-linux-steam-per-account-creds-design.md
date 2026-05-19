# Linux/Steam per-account credentials — design

**Status:** approved, ready for implementation plan
**Date:** 2026-05-19
**Scope:** Phase 1 of a phased Linux port of AxiAM's multi-account credential flow. Phase 2 (concurrent multi-instance) is sketched at the end but not specified.

## Goal

Bring sequential per-account credentials to Linux/Steam (Proton). Today on Linux, AxiAM passes `-autologin` if a per-account `Local.dat` snapshot exists, but never installs that snapshot into the Proton prefix — so whichever account last logged in is the one GW2 actually pre-fills, regardless of which account the user clicks in AxiAM. Phase 1 fixes that by porting the Windows take-2 install/snapshot flow to Linux.

Out of scope: concurrent multi-instance on Linux, non-Steam GW2 installs (Lutris, Bottles, raw wine), and any new UI surface.

## Definitions

- **Host Local.dat** — the `Local.dat` file the running GW2 process reads/writes. On Windows, `%APPDATA%\Guild Wars 2\Local.dat`. On Linux/Proton, the equivalent path inside the Proton prefix (see below).
- **Account snapshot** — the per-account copy stored at `<userData>/profiles/<accountId>/Guild Wars 2/Local.dat`.
- **Install** — copy account snapshot → host Local.dat (before launch).
- **Snapshot back** — copy host Local.dat → account snapshot (after quit), capturing any credential updates made during the session.

## Architecture

Mirror the Windows take-2 flow. The only structurally new piece is a Linux host-path resolver.

### Host path resolution

```
getHostLocalDatPath()
  win32  → %APPDATA%\Guild Wars 2\Local.dat                       (unchanged)
  linux  → <steam-lib>/steamapps/compatdata/1284210/pfx/
            drive_c/users/steamuser/AppData/Roaming/
            Guild Wars 2/Local.dat                                  (new)
```

Library selection reuses the same logic already in `electron/mutexCloser.ts:resolveProtonContext()`: iterate `getSteamLibraryPaths()`, pick the first library that has `steamapps/compatdata/1284210`. The selection rule is identical to the existing mutex-closer rule so the two helpers can't disagree about which prefix is "the" GW2 prefix.

To avoid duplication, factor a small shared utility:

```ts
// electron/protonPaths.ts (new)
export function resolveGw2CompatDataDir(): string | null
```

Both `mutexCloser.ts` and `localDat.ts` import this. `mutexCloser`'s `resolveProtonContext()` continues to do the additional config_info/Proton-version resolution on top.

### Install / snapshot wiring (electron/main.ts)

Today (`main.ts:1882-1900`):

```
if (win32 && useAutologin)   → installSnapshotToHostWithRetry
else if (useAutologin)        → log only, no install   ← Linux falls here
```

After:

```
if (useAutologin && platform in {win32, linux})  → installSnapshotToHostWithRetry
```

The DLL-injection branch (`useDllRedirect`) stays Windows-gated. The junction branch (`useJunction`) stays Windows-gated. Only the install-to-host path becomes cross-platform.

The `launchContexts.set(...)` block at `main.ts:1918-1923` loses its `process.platform === 'win32'` guard so cross-contamination tracking covers Linux too (same `installed` + `startedAtMs` semantics, same 15s threshold).

The snapshot-back wiring in the quit handler likewise drops its Windows guard for the `snapshotHostToAccount` call. The "fresh-account quit <15s" skip rule applies identically.

### localDat.ts changes

`getHostLocalDatPath()` (currently Windows-only, throws if `APPDATA` is unset) becomes:

```ts
function getHostLocalDatPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA env var is not set; ...');
    return path.join(appData, 'Guild Wars 2', 'Local.dat');
  }
  if (process.platform === 'linux') {
    const compatDir = resolveGw2CompatDataDir();
    if (!compatDir) throw new HostUnavailableError('no GW2 compatdata found in any Steam library');
    return path.join(
      compatDir,
      'pfx', 'drive_c', 'users', 'steamuser',
      'AppData', 'Roaming', 'Guild Wars 2', 'Local.dat',
    );
  }
  throw new HostUnavailableError(`unsupported platform: ${process.platform}`);
}
```

Existing `installSnapshotToHost` / `snapshotHostToAccount` / `seedAccountLocalDatFromHost` work unchanged — they take whatever `getHostLocalDatPath()` returns. They already handle "host dir doesn't exist" (mkdir) and "host file doesn't exist" (write-new) cases.

`HostUnavailableError` is a new typed error so callers can distinguish "prefix not yet created" from real I/O errors and skip the install gracefully (logging, then launching without `-autologin`) — the same shape `main.ts` already has for Windows error handling at the call site.

## Edge cases

| # | Case | Behavior |
|---|---|---|
| E1 | First-ever launch, `compatdata/1284210/pfx/` doesn't exist | Skip install; log `[install] account=X compatdata not found; launching without -autologin`. After first login and quit, snapshot-back captures Local.dat. |
| E2 | Prefix exists, host Local.dat doesn't | `installSnapshotToHost` writes the file. No change from Windows. |
| E3 | Steam not running | `steam -applaunch` starts Steam. Install happens before launch, so prefix must already exist (same as E1). |
| E4 | Multiple Steam libraries with a compatdata | Pick first match (matches `mutexCloser`). Should never happen with normal Steam usage. |
| E5 | Non-Steam GW2 install (Lutris, Bottles, raw wine) | `resolveGw2CompatDataDir()` returns null → typed error → launch without `-autologin`. Out of scope to support first-class. |
| E6 | File ownership | Proton prefix files are user-owned; `fs.copyFileSync` works without sudo or caps. |
| E7 | Linux quit detection | Already cross-platform — `getAllRunningGw2Pids()` at `main.ts:931-968` matches wine + gw2 strings via `ps`. No change. |
| E8 | Concurrent launches on Linux | Sequential only in phase 1. `launchSerializer` queues clicks; once two instances are running, the second reads whoever's Local.dat is on host. Documented as a known limitation; phase 2 fixes. |
| E9 | EAC / TOS | GW2 has no EAC on Linux. Replacing Local.dat is indistinguishable from a user editing the file. No exposure. |

## Testing

No CI on Linux today, so tests follow the same pattern as `localDat.test.ts` and `mutexCloser.test.ts`: mock `fs` and `spawnSync`, exercise pure logic.

New tests:
- `protonPaths.test.ts` — `resolveGw2CompatDataDir()`: no libraries, library with no compatdata, library with compatdata, multiple libraries (first-match wins).
- `localDat.test.ts` — extend with Linux cases: host path resolution via mocked `resolveGw2CompatDataDir`, `HostUnavailableError` when prefix is missing, install/snapshot round-trip with a mocked Linux host path.
- `mutexCloser.test.ts` — update to use the extracted shared helper without losing coverage of the existing `resolveProtonContext` behavior.

Manual verification on a real Linux/Steam install (the only path that exercises the actual Proton prefix layout):
1. Add two accounts in AxiAM.
2. Launch Main → log in → quit. Confirm `<userData>/profiles/Main/Guild Wars 2/Local.dat` was created/updated.
3. Launch Alt → confirm login screen pre-fills with Alt's credentials (not Main's). Log in → quit.
4. Launch Main again → confirm it still pre-fills Main's credentials.
5. Launch Main before GW2 has ever run through Steam → confirm graceful fallback ("launching without -autologin").

## File inventory

**New:**
- `electron/protonPaths.ts` — shared `resolveGw2CompatDataDir()`.
- `electron/protonPaths.test.ts` — unit tests for the resolver.
- `docs/superpowers/specs/2026-05-19-linux-steam-per-account-creds-design.md` — this file.

**Modified:**
- `electron/localDat.ts` — platform switch in `getHostLocalDatPath`, new `HostUnavailableError`.
- `electron/localDat.test.ts` — add Linux-path tests.
- `electron/mutexCloser.ts` — use extracted shared helper.
- `electron/mutexCloser.test.ts` — update tests to match.
- `electron/main.ts` — drop the Linux skip-branch around install-to-host (`~line 1882-1900`), drop the `process.platform === 'win32'` guard around `launchContexts.set` (`~line 1918`) and around the quit-handler snapshot call.

**Unchanged (already cross-platform):**
- `quitWatcher.ts`, `launchSerializer.ts`, `launchStateMachine.ts`, `getAllRunningGw2Pids`, `terminatePid`/`terminatePidTree`.

## Phase 2 sketch (not in scope)

Concurrent multi-instance on Linux will get its own spec when phase 1 ships. Three known options:

- **A. LD_PRELOAD shim** — ship a `.so` that intercepts `open`/`openat` at the Linux level. Wired via Steam launch options (`%command%` wrapper) and per-account target-path env var. Native Linux tech; per-process scope is natural.
- **B. Per-account Proton prefix** — each account gets its own `STEAM_COMPAT_DATA_PATH`. Heavy on disk but trivially correct. The Windows "Download failed (5)" launcher conflict may not reproduce on Linux at all, since the root cause was Windows file-lock contention — worth a 30-minute smoke test before designing further.
- **C. Same DLL via wine** — load the existing `local-dat-redirect.dll` inside wine via `WINEDLLOVERRIDES` / AppInit. Brittle; last resort.

Likely order when we get there: smoke-test B first (cheap), use A if B has correctness issues, fall back to C only if both fail. Phase 1 doesn't constrain phase 2 — the install/snapshot code is independent of the multi-instance mechanism, exactly as on Windows where DLL injection sits alongside (and bypasses) install-to-host.

# Linux/Steam per-account credentials — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port AxiAM's per-account Local.dat install/snapshot flow from Windows to Linux/Steam (Proton), so clicking "Launch" on an account actually pre-fills GW2 with that account's credentials.

**Architecture:** A single new resolver (`resolveGw2CompatDataDir`) finds the Proton prefix in the user's Steam libraries. `getHostLocalDatPath()` in `electron/localDat.ts` gains a Linux branch that points at the Local.dat inside that prefix. Existing `installSnapshotToHost` / `snapshotHostToAccount` work unchanged. `electron/main.ts` drops the `process.platform === 'win32'` gate around the install path and the `launchContexts.set(...)` call. Process detection, quit-watcher, and serializer are already cross-platform — no changes.

**Tech Stack:** TypeScript, Node.js, Electron, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-19-linux-steam-per-account-creds-design.md`

---

## File Structure

**New files:**
- `electron/protonPaths.ts` — shared `resolveGw2CompatDataDir()` used by both `localDat.ts` and `mutexCloser.ts`. One responsibility: "given Steam libraries, find the GW2 compatdata directory or return null."
- `electron/protonPaths.test.ts` — unit tests for that resolver (mocked `fs`).

**Modified files:**
- `electron/localDat.ts` — cross-platform `getHostLocalDatPath`, new `HostUnavailableError`.
- `electron/localDat.test.ts` — add Linux-path tests.
- `electron/mutexCloser.ts` — delegate compatdata lookup to the shared util (preserve current behavior).
- `electron/mutexCloser.test.ts` — update to match the refactor (no behavior change).
- `electron/main.ts` — drop Linux skip-branch around install-to-host; drop `win32` guard around `launchContexts.set`.

---

## Task 1: Extract `resolveGw2CompatDataDir` into a shared module

Spec section: "Host path resolution". Test-first.

**Files:**
- Create: `electron/protonPaths.ts`
- Test: `electron/protonPaths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/protonPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveGw2CompatDataDir, type ProtonPathsFs } from './protonPaths.js';

function fakeFs(existing: Set<string>): ProtonPathsFs {
  return { existsSync: (p) => existing.has(p) };
}

describe('resolveGw2CompatDataDir', () => {
  it('returns null when no libraries are provided', () => {
    expect(resolveGw2CompatDataDir([], fakeFs(new Set()))).toBeNull();
  });

  it('returns null when no library has a GW2 compatdata', () => {
    const fs = fakeFs(new Set(['/lib1/steamapps', '/lib2/steamapps']));
    expect(resolveGw2CompatDataDir(['/lib1', '/lib2'], fs)).toBeNull();
  });

  it('returns the compatdata path when one library has it', () => {
    const fs = fakeFs(new Set(['/lib1/steamapps/compatdata/1284210']));
    expect(resolveGw2CompatDataDir(['/lib1'], fs)).toBe('/lib1/steamapps/compatdata/1284210');
  });

  it('picks the first library when multiple match', () => {
    const fs = fakeFs(new Set([
      '/lib1/steamapps/compatdata/1284210',
      '/lib2/steamapps/compatdata/1284210',
    ]));
    expect(resolveGw2CompatDataDir(['/lib1', '/lib2'], fs)).toBe('/lib1/steamapps/compatdata/1284210');
  });

  it('skips libraries without GW2 compatdata and falls through to one that has it', () => {
    const fs = fakeFs(new Set(['/lib2/steamapps/compatdata/1284210']));
    expect(resolveGw2CompatDataDir(['/lib1', '/lib2'], fs)).toBe('/lib2/steamapps/compatdata/1284210');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/protonPaths.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `electron/protonPaths.ts`:

```ts
import path from 'path';
import fs from 'fs';

export const STEAM_GW2_APP_ID = '1284210';

export interface ProtonPathsFs {
  existsSync: (path: string) => boolean;
}

/**
 * Given a list of Steam library paths, return the first one that contains
 * `steamapps/compatdata/<GW2 app id>`, or null if none do.
 *
 * Used by both `localDat.ts` (to find the host Local.dat) and `mutexCloser.ts`
 * (to find the Proton prefix). Pure function — no I/O outside the injected fs.
 */
export function resolveGw2CompatDataDir(
  steamLibraryPaths: string[],
  filesystem: ProtonPathsFs = fs,
): string | null {
  for (const lib of steamLibraryPaths) {
    const compat = path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID);
    if (filesystem.existsSync(compat)) return compat;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/protonPaths.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/protonPaths.ts electron/protonPaths.test.ts
git commit -m "feat(proton): shared resolveGw2CompatDataDir utility

Used next by localDat.ts (Linux host path) and mutexCloser.ts
(replacing the inline compatdata lookup)."
```

---

## Task 2: Make `mutexCloser` use the shared resolver

Spec section: "Host path resolution" — second paragraph. Refactor with no behavior change.

**Files:**
- Modify: `electron/mutexCloser.ts` (lookups at lines 142-152 and 156-167)
- Modify: `electron/mutexCloser.test.ts` (update import path / behavior expectations remain identical)

- [ ] **Step 1: Run the existing mutexCloser tests as a baseline**

Run: `npx vitest run electron/mutexCloser.test.ts`

Expected: PASS (capture the test count for comparison — should be the same after the refactor).

- [ ] **Step 2: Replace the inline compatdata lookups in `mutexCloser.ts`**

In `electron/mutexCloser.ts`, at the top of the file:

Old:
```ts
import path from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';
```

New:
```ts
import path from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { resolveGw2CompatDataDir, STEAM_GW2_APP_ID as SHARED_GW2_APP_ID } from './protonPaths.js';
```

Then in `resolveProtonContext` (currently around lines 142-152 and 156-167), replace the inner library-iteration blocks. Old (running-Proton branch, around line 142):

```ts
      // Find a compatdata that exists in any of the known libraries.
      for (const lib of steamLibraryPaths) {
        const compat = path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID);
        if (filesystem.existsSync(compat)) {
          return {
            compatDataPath: compat,
            protonPath: runningProton,
            clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
          };
        }
      }
```

New:
```ts
      const compat = resolveGw2CompatDataDir(steamLibraryPaths, filesystem);
      if (compat) {
        return {
          compatDataPath: compat,
          protonPath: runningProton,
          clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
        };
      }
```

Old (cold-path branch, lines 156-167):

```ts
  for (const lib of steamLibraryPaths) {
    const compat = path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID);
    if (!filesystem.existsSync(compat)) continue;
    const proton = findProtonInLibrary(compat, lib, compatToolsRoots, filesystem);
    if (!proton) continue;
    return {
      compatDataPath: compat,
      protonPath: proton,
      clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
    };
  }
  return null;
```

New:
```ts
  for (const lib of steamLibraryPaths) {
    const compat = path.join(lib, 'steamapps', 'compatdata', SHARED_GW2_APP_ID);
    if (!filesystem.existsSync(compat)) continue;
    const proton = findProtonInLibrary(compat, lib, compatToolsRoots, filesystem);
    if (!proton) continue;
    return {
      compatDataPath: compat,
      protonPath: proton,
      clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
    };
  }
  return null;
```

(The cold-path loop still iterates libraries itself because it has the extra `findProtonInLibrary` step per library — the shared resolver only handles the "does this library contain a GW2 compatdata?" predicate. Keeping the loop here is correct; we just want a single source of truth for the `STEAM_GW2_APP_ID` constant.)

Finally, remove the local `const STEAM_GW2_APP_ID = '1284210';` declaration in `mutexCloser.ts` (around line 108) since it's now imported from `protonPaths.ts` as `SHARED_GW2_APP_ID`.

- [ ] **Step 3: Run mutexCloser tests to confirm no behavior change**

Run: `npx vitest run electron/mutexCloser.test.ts`

Expected: PASS, same count as Step 1.

- [ ] **Step 4: Run full test suite as a regression check**

Run: `npm test`

Expected: PASS, no regressions vs. pre-task count (51 pass + 6 skipped expected, including the 5 new from Task 1).

- [ ] **Step 5: Commit**

```bash
git add electron/mutexCloser.ts
git commit -m "refactor(mutexCloser): delegate compatdata lookup to protonPaths

Pure refactor — no behavior change. Single source of truth for the
GW2 Steam app ID, prep work for localDat.ts to use the same resolver."
```

---

## Task 3: Add `HostUnavailableError` and Linux branch in `getHostLocalDatPath`

Spec section: "localDat.ts changes". Test-first.

**Files:**
- Modify: `electron/localDat.ts` (function `getHostLocalDatPath`, around lines 67-77)
- Modify: `electron/localDat.test.ts` (add Linux-path tests)

- [ ] **Step 1: Write the failing tests**

Append to `electron/localDat.test.ts`, after the existing imports/mocks:

```ts
import {
  installSnapshotToHost as installSnapshotToHostForLinux,
  snapshotHostToAccount as snapshotHostToAccountForLinux,
  HostUnavailableError,
} from './localDat.js';

describe('getHostLocalDatPath (Linux)', () => {
  const originalPlatform = process.platform;

  function setPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('installSnapshotToHost throws HostUnavailableError on Linux when no compatdata exists', () => {
    setPlatform('linux');
    // No libraries available → resolver returns null → host path unavailable.
    vi.doMock('./protonPaths.js', () => ({
      resolveGw2CompatDataDir: () => null,
      STEAM_GW2_APP_ID: '1284210',
    }));
    // Account must have a snapshot, otherwise we exit early with `no-snapshot`.
    const accountFs: CopyFs = {
      existsSync: (p) => p === '/test-userdata/profiles/acct/Guild Wars 2/Local.dat',
      mkdirSync: () => {},
      copyFileSync: () => {},
    };
    expect(() =>
      installSnapshotToHostForLinux('acct', accountFs)
    ).toThrow(HostUnavailableError);
  });

  it('snapshotHostToAccount throws HostUnavailableError on Linux when no compatdata exists', () => {
    setPlatform('linux');
    vi.doMock('./protonPaths.js', () => ({
      resolveGw2CompatDataDir: () => null,
      STEAM_GW2_APP_ID: '1284210',
    }));
    const noopFs: CopyFs = {
      existsSync: () => false,
      mkdirSync: () => {},
      copyFileSync: () => {},
    };
    expect(() =>
      snapshotHostToAccountForLinux('acct', noopFs)
    ).toThrow(HostUnavailableError);
  });
});
```

Note on the `vi.doMock` calls: `vi.doMock` only takes effect if the module is imported AFTER the mock is registered. Since `localDat.ts` reads `resolveGw2CompatDataDir` lazily (we'll wire it that way in Step 3), the mock applies at call time, not import time.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run electron/localDat.test.ts -t 'getHostLocalDatPath (Linux)'`

Expected: FAIL — `HostUnavailableError` is not exported yet.

- [ ] **Step 3: Implement `HostUnavailableError` and the Linux branch**

In `electron/localDat.ts`, add near the top of the file (after the imports):

```ts
export class HostUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'HostUnavailableError';
  }
}
```

Replace the existing `getHostLocalDatPath` (lines 67-77):

```ts
/**
 * Internal: path to the host's GW2 Local.dat (where the running game reads/writes).
 *
 * - Windows: `%APPDATA%\Guild Wars 2\Local.dat`
 * - Linux:   `<steam-lib>/steamapps/compatdata/1284210/pfx/drive_c/users/steamuser/
 *             AppData/Roaming/Guild Wars 2/Local.dat`
 *
 * Throws `HostUnavailableError` when the host is unreachable (e.g. the user
 * has never launched GW2 through Steam on Linux so the Proton prefix doesn't
 * exist yet). Callers catch this and fall back to launching without
 * `-autologin`.
 */
function getHostLocalDatPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new HostUnavailableError('APPDATA env var is not set; cannot resolve host Local.dat path');
    }
    return path.join(appData, 'Guild Wars 2', 'Local.dat');
  }
  if (process.platform === 'linux') {
    // Imported lazily so tests can `vi.doMock('./protonPaths.js')` at call time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveGw2CompatDataDir } = require('./protonPaths.js') as typeof import('./protonPaths.js');
    const libraries = getSteamLibraryPaths();
    const compat = resolveGw2CompatDataDir(libraries);
    if (!compat) {
      throw new HostUnavailableError('no GW2 compatdata found in any Steam library');
    }
    return path.join(
      compat,
      'pfx', 'drive_c', 'users', 'steamuser',
      'AppData', 'Roaming', 'Guild Wars 2', 'Local.dat',
    );
  }
  throw new HostUnavailableError(`unsupported platform: ${process.platform}`);
}
```

`getSteamLibraryPaths` is already exported from `localDat.ts` (line 9), so no extra import needed.

Both `installSnapshotToHost` (line 104) and `snapshotHostToAccount` (line 133) and `seedAccountLocalDatFromHost` (line 171) call `getHostLocalDatPath()` synchronously before their try/catch — so they will naturally propagate `HostUnavailableError`. That's what the tests expect.

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run electron/localDat.test.ts -t 'getHostLocalDatPath (Linux)'`

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full localDat suite**

Run: `npx vitest run electron/localDat.test.ts`

Expected: PASS — all prior tests plus the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add electron/localDat.ts electron/localDat.test.ts
git commit -m "feat(localDat): Linux host path via Proton compatdata

Adds HostUnavailableError and a Linux branch to getHostLocalDatPath
that resolves the Proton prefix Local.dat. install/snapshot/seed all
naturally propagate the typed error so main.ts can fall back to
launching without -autologin when GW2 has never run via Steam yet."
```

---

## Task 4: Wire `main.ts` to install/snapshot on Linux too

Spec section: "Install / snapshot wiring".

**Files:**
- Modify: `electron/main.ts` (autologin branch ~lines 1882-1900; `launchContexts.set` ~lines 1918-1923)

- [ ] **Step 1: Update the autologin install branch to cover Linux**

In `electron/main.ts`, at approximately lines 1882-1900, the current logic is:

```ts
  } else if (useAutologin && process.platform === 'win32') {
    const installResult = await installSnapshotToHostWithRetry(account.id);
    if (installResult.ok) {
      logMain('launch', `[install] account=${id} installed snapshot to host path`);
    } else if (installResult.reason === 'no-snapshot') {
      logMainWarn('launch', `[install] account=${id} unexpected no-snapshot after hasLocalDat=true`);
      useAutologin = false;
    } else {
      logMainWarn('launch', `[install] account=${id} retry exhausted (${installResult.reason}); launching without -autologin`);
      useAutologin = false;
    }
  } else if (useAutologin) {
    // Linux/other platforms: -autologin still gated on hasLocalDat but no host
    // install happens. The Linux launch goes through Steam/Proton.
    logMain('launch', `[local-dat] Saved login present for account=${id}, using -autologin`);
  } else {
```

Replace with:

```ts
  } else if (useAutologin && (process.platform === 'win32' || process.platform === 'linux')) {
    try {
      const installResult = await installSnapshotToHostWithRetry(account.id);
      if (installResult.ok) {
        logMain('launch', `[install] account=${id} installed snapshot to host path`);
      } else if (installResult.reason === 'no-snapshot') {
        logMainWarn('launch', `[install] account=${id} unexpected no-snapshot after hasLocalDat=true`);
        useAutologin = false;
      } else {
        logMainWarn('launch', `[install] account=${id} retry exhausted (${installResult.reason}); launching without -autologin`);
        useAutologin = false;
      }
    } catch (err: any) {
      if (err?.name === 'HostUnavailableError') {
        logMainWarn('launch', `[install] account=${id} host unavailable (${err.message}); launching without -autologin`);
        useAutologin = false;
      } else {
        throw err;
      }
    }
  } else if (useAutologin) {
    // Other platforms (darwin etc.) — pass-through behaviour.
    logMain('launch', `[local-dat] Saved login present for account=${id}, using -autologin`);
  } else {
```

`HostUnavailableError` needs to be importable. Find the existing `localDat` import at `electron/main.ts:15`:

```ts
import { hasLocalDat, deleteLocalDat, getSteamLibraryPaths, migrateLegacyLocalDat, installSnapshotToHost, snapshotHostToAccount, getAccountLocalDatPath, seedAccountLocalDatFromHost } from './localDat.js';
```

Append `HostUnavailableError`:

```ts
import { hasLocalDat, deleteLocalDat, getSteamLibraryPaths, migrateLegacyLocalDat, installSnapshotToHost, snapshotHostToAccount, getAccountLocalDatPath, seedAccountLocalDatFromHost, HostUnavailableError } from './localDat.js';
```

Wait — the catch block uses `err?.name === 'HostUnavailableError'`, not `instanceof HostUnavailableError`. That's intentional (more robust across module-boundary instanceof quirks in ts/esm) and means we don't actually need to import the class here. Drop the import change; leave the import line as-is.

- [ ] **Step 2: Drop the `win32` guard around `launchContexts.set`**

At approximately lines 1918-1923:

Old:
```ts
  if (process.platform === 'win32') {
    launchContexts.set(id, {
      installed: useAutologin,
      startedAtMs: Date.now(),
    });
  }
```

New:
```ts
  if (process.platform === 'win32' || process.platform === 'linux') {
    launchContexts.set(id, {
      installed: useAutologin,
      startedAtMs: Date.now(),
    });
  }
```

(Cross-contamination tracking now covers Linux. The 15s threshold in the quit handler then applies on Linux too.)

- [ ] **Step 3: Verify the snapshot-back path doesn't need extra changes**

Open `electron/main.ts` near the quit handler (around lines 1290-1329). Confirm:

1. The `allowMultiInstance` and `junctionMultiInstance` early-returns are correct as-is (they short-circuit on Windows-only flags; Linux falls through to the real snapshot).
2. `snapshotHostToAccount(accountId)` at line 1323 is already platform-agnostic — it will work on Linux now that `getHostLocalDatPath` does.

If the catch around `snapshotHostToAccount` doesn't exist, wrap that call to swallow `HostUnavailableError` gracefully. The existing code (lines 1323-1328) is:

```ts
    const result = snapshotHostToAccount(accountId);
    if (result.ok) {
      logMain('snapshot', `[snapshot] account=${accountId} copied Local.dat host → profile`);
    } else {
      logMainWarn('snapshot', `[snapshot] account=${accountId} skipped: ${result.reason}`);
    }
```

`snapshotHostToAccount` throws `HostUnavailableError` synchronously before the try/catch inside it runs. Wrap the call:

```ts
    let result;
    try {
      result = snapshotHostToAccount(accountId);
    } catch (err: any) {
      if (err?.name === 'HostUnavailableError') {
        logMainWarn('snapshot', `[snapshot] account=${accountId} skipped: host unavailable (${err.message})`);
        return;
      }
      throw err;
    }
    if (result.ok) {
      logMain('snapshot', `[snapshot] account=${accountId} copied Local.dat host → profile`);
    } else {
      logMainWarn('snapshot', `[snapshot] account=${accountId} skipped: ${result.reason}`);
    }
```

- [ ] **Step 4: Typecheck both projects**

Run: `npx tsc --noEmit && npx tsc -p tsconfig.electron.json --noEmit`

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: PASS — same count as after Task 3 (no regressions; main.ts isn't covered by unit tests so no new tests fire here).

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): install per-account Local.dat on Linux too

Drops the win32-only guard around install-to-host and launchContexts
tracking. HostUnavailableError from localDat.ts is caught and treated
as 'launch without -autologin' — same shape as missing snapshot. Quit
handler also catches the typed error so first-time-Linux users (no
Proton prefix yet) don't see an unhandled exception."
```

---

## Task 5: Smoke-test build on Linux

No automated test substitutes for actually running it. This task is a manual checklist; mark items off as you go.

**Pre-reqs on the Linux test machine:**
- Steam installed and running
- Guild Wars 2 (app id 1284210) installed via Steam (so the Proton prefix exists)
- Two test GW2 accounts available

- [ ] **Step 1: Build & run dev**

Run: `npm install && npm run dev`

Expected: app starts, no startup crash.

- [ ] **Step 2: First launch on a fresh-prefix machine (optional)**

If you have a Linux box where GW2 has never been launched through Steam, add an account in AxiAM and click Launch. Confirm the logs at `~/.config/AxiAM/logs/main.log` (or the dev log path) show:

```
[install] account=<id> host unavailable (no GW2 compatdata found in any Steam library); launching without -autologin
```

The launch should still proceed via `steam -applaunch`.

- [ ] **Step 3: Sequential per-account creds with two accounts**

1. Add Account A; launch; log in to GW2 with account A; quit GW2.
2. Add Account B; launch; confirm the GW2 login screen pre-fills with B's email (not A's). Log in to GW2 with account B; quit.
3. Launch Account A again; confirm A's email is pre-filled (not B's).
4. Inspect: `ls ~/.config/AxiAM/profiles/A/Guild\ Wars\ 2/Local.dat` and `…/B/Guild\ Wars\ 2/Local.dat` should both exist with reasonable file sizes (~70MB after first login).

- [ ] **Step 4: Cross-contamination guard (fresh account, quick quit)**

1. Launch Account A; log in; quit. (A's snapshot is now in host.)
2. Add a fresh Account C (no saved Local.dat); launch; quit within 15 seconds *before logging in*. (A's data is still in the host.)
3. Confirm `~/.config/AxiAM/profiles/C/Guild Wars 2/Local.dat` does NOT exist after the quit. The main.log should contain:

```
[snapshot] account=C skipped: fresh-account quit after <ms>ms (<15000ms threshold) — likely no authentication happened
```

- [ ] **Step 5: Commit any small fixes discovered during smoke testing**

If you found issues, fix them under separate commits with `fix(...)` prefix and re-run the relevant smoke step. If smoke testing reveals nothing, no commit is needed for this task.

---

## Self-review checklist (do this before handing off the plan)

1. **Spec coverage:**
   - Host path resolution → Task 1 (resolver) + Task 3 (Linux branch in getHostLocalDatPath). ✅
   - Install / snapshot wiring → Task 4. ✅
   - localDat.ts changes (HostUnavailableError, platform switch) → Task 3. ✅
   - Edge cases E1 (no compatdata), E2 (no host file), E3 (Steam not running) → all handled by the typed error + existing logic. ✅
   - E4 (multiple libraries) → first-match in Task 1's resolver. ✅
   - E5 (non-Steam install) → typed error returned, same fallback. ✅
   - E7 (quit detection) → already works, no change. ✅
   - E8 (concurrent on Linux) → out of scope, documented in spec. ✅
   - Testing section → Task 1 has 5 new unit tests; Task 3 has 2 new unit tests; Task 5 covers manual verification. ✅

2. **Placeholder scan:** no TBDs / TODOs / "handle edge cases" — every step has concrete code or commands. ✅

3. **Type consistency:**
   - `resolveGw2CompatDataDir(steamLibraryPaths, filesystem)` — same signature used in Task 1 and Task 2. ✅
   - `HostUnavailableError` (class name) — same name used across Tasks 3 and 4. ✅
   - `ProtonPathsFs` interface — defined in Task 1, no other task uses it directly (matches plan). ✅
   - `STEAM_GW2_APP_ID` exported from `protonPaths.ts`, re-imported as `SHARED_GW2_APP_ID` in mutexCloser to avoid colliding with mutexCloser's own deletion. ✅

No issues found.

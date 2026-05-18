# Per-account `%APPDATA%\Guild Wars 2` junction implementation plan

> **For agentic workers:** Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace take-2's copy-on-install / copy-on-quit Local.dat shuffle with a directory-junction pattern at `%APPDATA%\Guild Wars 2\`. Per-account profile dirs become the real `Guild Wars 2/` directory for each account; the junction is re-pointed atomically before each spawn. Fixes the multi-instance EBUSY bug at its root by giving each running GW2 its own file.

**Architecture:** A new `electron/junction.ts` owns the OS-level junction operations (`repointJunction`, `isJunction`, migration). `electron/main.ts` calls `repointJunction(account.profileDir)` in `doLaunch` instead of `installSnapshotToHostWithRetry`. The quit handler's snapshot-back logic is removed. A one-time startup migration moves any existing real `%APPDATA%\Guild Wars 2\` contents into a default-state profile and replaces the dir with a junction. Behind a `settings.junctionMultiInstance` feature flag for the v1.1.14-beta cycle.

**Spec:** `docs/superpowers/specs/2026-05-18-per-account-junction-design.md`.

**Tech Stack:** TypeScript (Electron main), Node `fs` (`symlinkSync` with `'junction'` type), vitest. No new dependencies.

---

## File structure

**New files:**
- `electron/junction.ts` — `repointJunction`, `isJunction`, `getJunctionTarget`, `migrateGw2DirToJunction`.
- `electron/junction.test.ts` — vitest unit tests with an injectable fs facade.

**Modified files:**
- `electron/main.ts` — feature-flag check; call `migrateGw2DirToJunction` at startup; replace install-to-host with `repointJunction`; drop dwell + retry constants; drop quit-handler snapshot logic when the flag is on.
- `electron/types.ts` — add `junctionMultiInstance?: boolean` to `AppSettings`.
- `electron/store.ts` — default the new setting to `false`.
- `electron/localDat.ts` — keep `installSnapshotToHost` / `snapshotHostToAccount` for the non-junction path; no changes needed in this PR.

**No changes:** `electron/launchSerializer.ts`, `electron/quitWatcher.ts`, `electron/mutexCloser.ts`, anything under `src/`.

---

## Task 1: Add junction helpers in `electron/junction.ts`

**Files:**
- New: `electron/junction.ts`
- New: `electron/junction.test.ts`

This task adds the OS-facing helpers and their unit tests. No `main.ts` wiring yet — Task 4 does that.

- [ ] **Step 1: Create `electron/junction.ts` with the following content**

```ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * Filesystem facade for testability. Real callers use `node:fs`.
 */
export interface JunctionFs {
  existsSync: (p: string) => boolean;
  lstatSync: (p: string) => { isSymbolicLink: () => boolean; isDirectory: () => boolean };
  readlinkSync: (p: string) => string;
  rmSync: (p: string, opts?: { recursive?: boolean; force?: boolean }) => void;
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  symlinkSync: (target: string, p: string, type?: 'junction' | 'dir' | 'file') => void;
  renameSync: (from: string, to: string) => void;
  readdirSync: (p: string) => string[];
  cpSync: (src: string, dest: string, opts?: { recursive?: boolean }) => void;
}

/**
 * True iff `p` exists and is a junction or symlink (we can't distinguish at the
 * Node API level; on Windows directory symlinks and junctions both show as
 * symbolic links).
 */
export function isJunction(p: string, filesystem: JunctionFs = fs as unknown as JunctionFs): boolean {
  try {
    if (!filesystem.existsSync(p)) return false;
    return filesystem.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Read where the junction at `p` points. Returns `null` if `p` isn't a junction
 * or can't be read.
 */
export function getJunctionTarget(p: string, filesystem: JunctionFs = fs as unknown as JunctionFs): string | null {
  try {
    if (!isJunction(p, filesystem)) return null;
    return filesystem.readlinkSync(p);
  } catch {
    return null;
  }
}

/**
 * Atomically re-point a junction. If `junctionPath` already exists, delete it
 * (whether it's a junction, symlink, or empty directory — refuse to delete a
 * non-empty real dir to avoid catastrophic data loss). Then create a fresh
 * junction pointing at `target`.
 *
 * `target` must exist; we don't auto-create it because the caller knows whether
 * an empty dir is a valid state.
 */
export function repointJunction(
  junctionPath: string,
  target: string,
  filesystem: JunctionFs = fs as unknown as JunctionFs,
): void {
  if (!filesystem.existsSync(target)) {
    throw new Error(`repointJunction: target does not exist: ${target}`);
  }

  if (filesystem.existsSync(junctionPath)) {
    const stat = filesystem.lstatSync(junctionPath);
    if (stat.isSymbolicLink()) {
      filesystem.rmSync(junctionPath, { force: true, recursive: false });
    } else if (stat.isDirectory()) {
      const contents = filesystem.readdirSync(junctionPath);
      if (contents.length > 0) {
        throw new Error(
          `repointJunction: refusing to replace non-empty directory ${junctionPath} ` +
          `(call migrateGw2DirToJunction first)`,
        );
      }
      filesystem.rmSync(junctionPath, { force: true, recursive: false });
    } else {
      filesystem.rmSync(junctionPath, { force: true });
    }
  }

  filesystem.symlinkSync(target, junctionPath, 'junction');
}

export interface MigrationResult {
  status: 'already-migrated' | 'migrated' | 'no-source' | 'created-empty' | 'refused-gw2-running';
  movedFiles: number;
}

/**
 * One-time migration: if the real `%APPDATA%\Guild Wars 2` directory exists,
 * move its contents into `defaultProfileDir` and replace the original path with
 * a junction pointing at it. Idempotent — subsequent runs detect the junction
 * and no-op.
 *
 * Caller must pass `isGw2Running` so we can refuse to migrate while Gw2-64.exe
 * has handles into the directory.
 */
export function migrateGw2DirToJunction(args: {
  hostPath: string;            // e.g. %APPDATA%\Guild Wars 2
  defaultProfileDir: string;   // e.g. userData/default-gw2-state/Guild Wars 2
  isGw2Running: () => boolean;
  filesystem?: JunctionFs;
}): MigrationResult {
  const fsx = args.filesystem ?? (fs as unknown as JunctionFs);
  if (isJunction(args.hostPath, fsx)) {
    return { status: 'already-migrated', movedFiles: 0 };
  }

  if (!fsx.existsSync(args.hostPath)) {
    // No existing GW2 install state; create an empty default profile and link.
    fsx.mkdirSync(args.defaultProfileDir, { recursive: true });
    fsx.symlinkSync(args.defaultProfileDir, args.hostPath, 'junction');
    return { status: 'created-empty', movedFiles: 0 };
  }

  if (args.isGw2Running()) {
    return { status: 'refused-gw2-running', movedFiles: 0 };
  }

  fsx.mkdirSync(args.defaultProfileDir, { recursive: true });
  const entries = fsx.readdirSync(args.hostPath);
  for (const entry of entries) {
    fsx.renameSync(
      path.join(args.hostPath, entry),
      path.join(args.defaultProfileDir, entry),
    );
  }
  fsx.rmSync(args.hostPath, { force: true, recursive: false });
  fsx.symlinkSync(args.defaultProfileDir, args.hostPath, 'junction');
  return { status: 'migrated', movedFiles: entries.length };
}
```

- [ ] **Step 2: Create `electron/junction.test.ts`**

Test cases:
- `isJunction` returns false for non-existent path, false for real directory, true for symlink-style.
- `getJunctionTarget` returns the target path for junctions; null for real dirs.
- `repointJunction` deletes existing junction and creates new one with correct target.
- `repointJunction` refuses to overwrite a non-empty real directory; succeeds against an empty one.
- `repointJunction` throws when target doesn't exist.
- `migrateGw2DirToJunction`:
  - `already-migrated` when host path is already a junction
  - `created-empty` when host path doesn't exist
  - `migrated` with correct movedFiles count when there's a real dir
  - `refused-gw2-running` when `isGw2Running()` returns true and host is a real dir
  - Idempotent (running twice = second run reports already-migrated)

All tests should use an injectable `JunctionFs` (similar pattern to `MigrationFs` in `localDat.test.ts`). Skip the suite on non-Win32 platforms via `describe.skipIf(process.platform !== 'win32')`.

- [ ] **Step 3: Run `npx tsc -p tsconfig.electron.json --noEmit` and `npm test`** — verify the new file typechecks and tests pass.

---

## Task 2: Add the `junctionMultiInstance` setting

**Files:**
- Modify: `electron/types.ts`
- Modify: `electron/store.ts`

The setting gates the new behavior so we can ship behind a flag.

- [ ] **Step 1: Add `junctionMultiInstance?: boolean` to the `AppSettings` interface** in `electron/types.ts`. Default semantics: `false` (use the existing take-2 install-to-host path).

- [ ] **Step 2: Default the setting to `false` in `electron/store.ts`** alongside the other settings defaults.

- [ ] **Step 3: Verify the existing get-settings / save-settings IPC handlers pass through the new field unchanged** (they likely use `...settings` spreads — no code change needed, but confirm).

---

## Task 3: Wire startup migration in `electron/main.ts`

**Files:**
- Modify: `electron/main.ts`

Migration only runs when the flag is true *and* the platform is Win32. Failure modes are logged; AxiAM still starts.

- [ ] **Step 1: Import the new helpers** at the top of `main.ts`:

```ts
import { migrateGw2DirToJunction, isJunction } from './junction.js';
```

- [ ] **Step 2: Add a startup migration block** inside `app.on('ready', ...)` *after* store is loaded but *before* `createWindow`. Pseudocode:

```ts
if (process.platform === 'win32') {
  const settings = store.get('settings') as AppSettings;
  if (settings.junctionMultiInstance) {
    const appData = process.env.APPDATA;
    if (!appData) {
      logMainWarn('startup', '[junction] APPDATA env var missing; cannot migrate');
    } else {
      const hostPath = path.join(appData, 'Guild Wars 2');
      const defaultProfileDir = path.join(
        app.getPath('userData'),
        'default-gw2-state',
        'Guild Wars 2',
      );
      try {
        const result = migrateGw2DirToJunction({
          hostPath,
          defaultProfileDir,
          isGw2Running: () => getAllRunningGw2Pids().length > 0,
        });
        logMain('startup', `[junction] migration: ${result.status} (${result.movedFiles} files)`);
        if (result.status === 'refused-gw2-running') {
          // Show a user-visible warning. The renderer can pick this up via a
          // new 'junction-migration-deferred' IPC event.
        }
      } catch (err: any) {
        logMainError('startup', `[junction] migration failed: ${err?.message ?? err}`);
      }
    }
  }
}
```

- [ ] **Step 3: Add the renderer-side notification path** for the refused-gw2-running case. Simplest: send `mainWindow.webContents.send('junction-migration-deferred')`. The renderer surfaces a toast/banner with "Close Guild Wars 2 and relaunch AxiAM to finish setup." (Defer the actual UI in this PR — log + main-process warning is enough for v1.1.14-beta.3.)

- [ ] **Step 4: Run `npx tsc -p tsconfig.electron.json --noEmit`**.

---

## Task 4: Replace install-to-host with `repointJunction` in `doLaunch`

**Files:**
- Modify: `electron/main.ts`

Only the Win32 branch of `doLaunch` changes. Linux is untouched.

- [ ] **Step 1: Inside `doLaunch`**, replace the existing block:

```ts
let useAutologin = hasLocalDat(account.id);
if (useAutologin && process.platform === 'win32') {
  const installResult = await installSnapshotToHostWithRetry(account.id);
  // ... existing retry/fallback logic
}
```

with a flag-aware version:

```ts
const settings = store.get('settings') as AppSettings;
const useJunction = process.platform === 'win32' && settings.junctionMultiInstance === true;

let useAutologin = hasLocalDat(account.id);
if (useJunction && useAutologin) {
  const appData = process.env.APPDATA;
  const hostPath = appData ? path.join(appData, 'Guild Wars 2') : null;
  const profileDir = path.join(
    app.getPath('userData'),
    'profiles',
    account.id,
    'Guild Wars 2',
  );
  if (!hostPath) {
    logMainWarn('launch', `[junction] account=${id} APPDATA missing; launching without -autologin`);
    useAutologin = false;
  } else if (!fs.existsSync(profileDir)) {
    // hasLocalDat returned true but the dir is gone? Defensive.
    logMainWarn('launch', `[junction] account=${id} profile dir missing; launching without -autologin`);
    useAutologin = false;
  } else {
    try {
      repointJunction(hostPath, profileDir);
      logMain('launch', `[junction] account=${id} repointed → ${profileDir}`);
    } catch (err: any) {
      logMainWarn('launch', `[junction] account=${id} repoint failed: ${err?.message ?? err}; launching without -autologin`);
      useAutologin = false;
    }
  }
} else if (useAutologin && process.platform === 'win32') {
  // Existing take-2 path, unchanged.
  const installResult = await installSnapshotToHostWithRetry(account.id);
  // ... existing handling ...
} else if (useAutologin) {
  logMain('launch', `[local-dat] Saved login present for account=${id}, using -autologin`);
}
```

- [ ] **Step 2: Skip the 4-second dwell when junction mode is active** — replace:

```ts
if (process.platform === 'win32') {
  logMain('launch', `[dwell] ...`);
  await new Promise((resolve) => setTimeout(resolve, LAUNCH_DWELL_AFTER_DETECTED_MS));
}
```

with:

```ts
if (process.platform === 'win32' && !useJunction) {
  logMain('launch', `[dwell] ...`);
  await new Promise((resolve) => setTimeout(resolve, LAUNCH_DWELL_AFTER_DETECTED_MS));
}
```

The dwell was only needed because the next install would overwrite the host file; with junction repointing, that race doesn't exist.

- [ ] **Step 3: Skip the snapshot-back in the quit handler when junction mode is active** — wrap the existing `snapshotHostToAccount` call so it no-ops under the flag. The simplest version:

```ts
quitWatcher.on('quit', (accountId: string) => {
  const ctx = launchContexts.get(accountId);
  launchContexts.delete(accountId);

  const settings = store.get('settings') as AppSettings;
  if (settings.junctionMultiInstance) {
    logMain('snapshot', `[junction] account=${accountId} quit; in-place state is already saved`);
    return;
  }

  // ... existing remaining-PIDs guard, fresh-account skip, snapshotHostToAccount call ...
});
```

(The `ctx` cleanup happens regardless so the map doesn't leak.)

- [ ] **Step 4: Run `npx tsc -p tsconfig.electron.json --noEmit`** and `npm test`.

---

## Task 5: Manual integration test (Windows, real GW2)

**Files:** none (manual test plan).

This is the gate before flipping the flag default to true.

- [ ] **Step 1: Build and run dev mode with the flag enabled** — either toggle it via a temporary `store.set` in startup, or add a hidden settings UI control. (For local iteration the temp `store.set` is fastest.)

- [ ] **Step 2: Verify single-instance still works** — launch Main, log in, quit; launch Main again, see Main's email pre-filled. Same outcome as take-2.

- [ ] **Step 3: The critical multi-instance test** — launch Main, log in. While Main is still running, launch Alt. Verify Alt's login screen pre-fills *Alt's* email, not Main's. This is the bug we set out to fix.

- [ ] **Step 4: Verify per-account write isolation** — log in as Alt while Main is still in-game. Quit both. Confirm Main's `Local.dat` and Alt's `Local.dat` are different files with independent timestamps.

- [ ] **Step 5: Migration test on a fresh box** — uninstall AxiAM dev profile, ensure `%APPDATA%\Guild Wars 2\` is a real (non-junction) directory with some saved state. Launch AxiAM with the flag on. Verify the migration log line, the junction is created, and a non-AxiAM GW2 launch still works.

- [ ] **Step 6: Send the beta to m0mentkill3r** — one round of confirmation that the bug is fixed on his side too.

---

## Task 6: Flip the flag default (separate PR)

**Files:**
- Modify: `electron/store.ts`
- Modify: `RELEASE_NOTES.md`

Once Task 5 passes both locally and from m0mentkill3r, default the flag to `true` and document the migration in release notes.

- [ ] **Step 1: Change the default of `junctionMultiInstance` to `true`** in `store.ts`.

- [ ] **Step 2: Add a `RELEASE_NOTES.md` entry**: "AxiAM now manages `%APPDATA%\Guild Wars 2\` as a directory link to enable per-account credentials for every concurrent instance. Existing data is preserved in AxiAM's data folder."

- [ ] **Step 3: Remove the take-2 install-to-host code path** (left for now in case we need to revert): delete `installSnapshotToHostWithRetry`, the `installSnapshotToHost`/`snapshotHostToAccount` exports, related dead code in `localDat.ts`, the launch-context map and fresh-account-skip guard added in commit `284d2f3`. Defer to v1.1.15 if v1.1.14 is already tagged.

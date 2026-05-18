# Per-account GW2 AppData Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each AxiAM-managed Guild Wars 2 account its own `%APPDATA%\Guild Wars 2\` directory so `-autologin` works for every concurrent instance, replacing the v1.1.13 "copy Local.dat over a shared file" approach that only autologged in the first running account.

**Architecture:** Each `Gw2-64.exe` is spawned with an `APPDATA` env var pointing at `userData/profiles/<accountId>/`. GW2 writes (and on subsequent launches reads) its `Local.dat` from there. AxiAM never touches the contents of those directories beyond creating the outer profile folder; GW2 owns the inner files. Existing per-account `Local.dat` snapshots are migrated forward on first run of v1.1.14. Spec: `docs/superpowers/specs/2026-05-17-per-account-appdata-isolation-design.md`.

**Tech Stack:** TypeScript (Electron main + renderer), Node `fs`, vitest unit tests with the same injectable-filesystem pattern already used by `mutexCloser`. No new dependencies.

---

## File structure

**New files:**

- `electron/localDat.test.ts` — vitest unit tests for the new module surface (`hasLocalDat`, `deleteLocalDat`, `getAccountAppDataDir`, `migrateLegacyLocalDat`) using an injectable filesystem.

**Modified files:**

- `electron/localDat.ts` — major rewrite. Removes `saveLocalDat`, `restoreLocalDat`, `getLocalDatPath`, `getStorageDir`, `getAccountLocalDatPath`. Adds `getAccountAppDataDir(accountId)`, `migrateLegacyLocalDat(args, fs)`. Rewrites `hasLocalDat`, `deleteLocalDat` against the new layout.
- `electron/main.ts` — drops the `saveLocalDat` and `restoreLocalDat` imports, the `'save-local-dat'` IPC handler, the `restoreLocalDat` call in `launch-account`, and the three-branch hasAuth log block (collapsed to one line). Adds `APPDATA` env var on the direct-executable spawn. Adds a migration block in the existing top-of-file migration cluster. Updates `delete-account` to clean up the profile dir.
- `electron/preload.cts` — drops the `saveLocalDat` bridge.
- `electron/types.ts` — drops `'save-local-dat'` from `IpcEvents`.
- `src/App.tsx` — drops `handleSaveLogin`, the auto-save `useEffect` that calls it, and the `saveLocalDat` API reference. Keeps `handleClearLogin` and `hasLocalDat` polling.
- `src/components/AddAccountModal.tsx` — drops `onResaveLogin` from the prop type and removes the Re-save button. Keeps the Saved Login indicator and the Clear button.

**No source-file changes:** `electron/mutexCloser.ts`, `tools/mutex-closer/**`, `src/components/AccountCard.tsx`, `src/components/SettingsModal.tsx`, `electron/launchStateMachine.ts`.

---

## Task 1: Rewrite localDat module API

**Files:**
- Modify: `electron/localDat.ts`

This is the largest single edit. We replace nearly the whole module with a new shape. Tests in Task 2 will validate this.

- [ ] **Step 1: Replace `electron/localDat.ts` entirely** with the following content:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const STEAM_APP_ID = '1284210';

/**
 * Parse Steam's libraryfolders.vdf to get all Steam library paths.
 * Used by mutex-closer for Proton resolution and main.ts for auto-locate.
 */
export function getSteamLibraryPaths(): string[] {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    candidates.push(
      path.join(programFilesX86, 'Steam', 'steamapps', 'libraryfolders.vdf'),
      path.join(programFiles, 'Steam', 'steamapps', 'libraryfolders.vdf'),
    );
  } else {
    const home = app.getPath('home');
    candidates.push(path.join(home, '.local', 'share', 'Steam', 'steamapps', 'libraryfolders.vdf'));
  }

  const vdfPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!vdfPath) return [];

  const content = fs.readFileSync(vdfPath, 'utf-8');
  const paths: string[] = [];
  const pathRegex = /"path"\s+"([^"]+)"/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    paths.push(match[1].replace(/\\\\/g, '\\'));
  }
  return paths;
}

/**
 * Returns the live GW2 data directory the host OS resolves at runtime.
 * Used only by the Linux Local.dat handling now (mutex-closer's Proton resolver
 * doesn't depend on this).
 */
export function getGw2DataDirectory(): string | null {
  if (process.platform === 'linux') {
    const libraryPaths = getSteamLibraryPaths();
    const home = app.getPath('home');
    const defaultPath = path.join(home, '.local', 'share', 'Steam');
    if (!libraryPaths.includes(defaultPath)) {
      libraryPaths.unshift(defaultPath);
    }
    for (const libPath of libraryPaths) {
      const candidate = path.join(
        libPath, 'steamapps', 'compatdata',
        STEAM_APP_ID, 'pfx', 'drive_c', 'users', 'steamuser',
        'AppData', 'Roaming', 'Guild Wars 2',
      );
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const candidate = path.join(appData, 'Guild Wars 2');
    return fs.existsSync(candidate) ? candidate : null;
  }
  return null;
}

/**
 * Returns the per-account AppData root we point GW2 at via the APPDATA env var.
 * Creates the directory on demand. GW2 will write its own `Guild Wars 2/`
 * subdirectory inside.
 */
export function getAccountAppDataDir(accountId: string): string {
  const dir = path.join(app.getPath('userData'), 'profiles', accountId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Path to where Local.dat will land once GW2 writes it for this account.
 * Internal helper — exposed only so tests and migration code can reuse it.
 */
export function getAccountLocalDatPath(accountId: string): string {
  return path.join(
    app.getPath('userData'),
    'profiles',
    accountId,
    'Guild Wars 2',
    'Local.dat',
  );
}

/**
 * True iff this account has a Local.dat inside its profile directory.
 * Drives the "Saved" badge in the UI.
 */
export function hasLocalDat(accountId: string): boolean {
  return fs.existsSync(getAccountLocalDatPath(accountId));
}

/**
 * Remove this account's entire profile directory (`userData/profiles/<id>/`)
 * along with everything GW2 wrote inside. Idempotent — no throw if missing.
 */
export function deleteLocalDat(accountId: string): void {
  const dir = path.join(app.getPath('userData'), 'profiles', accountId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Filesystem facade for migration tests. Real callers pass node:fs directly.
 */
export interface MigrationFs {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts: { recursive: boolean }) => void;
  renameSync: (from: string, to: string) => void;
  readdirSync: (p: string) => string[];
  rmdirSync: (p: string) => void;
}

export interface MigrationResult {
  migratedAccountIds: string[];
  legacyDirRemoved: boolean;
  orphanedFilesLeft: number;
  errors: Array<{ accountId: string; reason: string }>;
}

/**
 * Move legacy `userData/local-dat/<id>.dat` files into the per-account profile
 * layout. Idempotent: re-running after a successful migration is a no-op.
 *
 * Layout transform (per account):
 *   userData/local-dat/<id>.dat
 *     →  userData/profiles/<id>/Guild Wars 2/Local.dat
 */
export function migrateLegacyLocalDat(
  args: { userDataDir: string; accountIds: string[] },
  filesystem: MigrationFs,
): MigrationResult {
  const result: MigrationResult = {
    migratedAccountIds: [],
    legacyDirRemoved: false,
    orphanedFilesLeft: 0,
    errors: [],
  };

  const legacyDir = path.join(args.userDataDir, 'local-dat');

  for (const accountId of args.accountIds) {
    const newPath = path.join(args.userDataDir, 'profiles', accountId, 'Guild Wars 2', 'Local.dat');
    if (filesystem.existsSync(newPath)) continue; // already migrated; idempotent

    const oldPath = path.join(legacyDir, `${accountId}.dat`);
    if (!filesystem.existsSync(oldPath)) continue; // nothing to migrate for this account

    try {
      const newDir = path.dirname(newPath);
      filesystem.mkdirSync(newDir, { recursive: true });
      filesystem.renameSync(oldPath, newPath);
      result.migratedAccountIds.push(accountId);
    } catch (err: any) {
      result.errors.push({ accountId, reason: err?.message ?? String(err) });
    }
  }

  if (filesystem.existsSync(legacyDir)) {
    let remaining: string[];
    try {
      remaining = filesystem.readdirSync(legacyDir);
    } catch {
      remaining = [];
    }
    if (remaining.length === 0) {
      try {
        filesystem.rmdirSync(legacyDir);
        result.legacyDirRemoved = true;
      } catch {
        // leave the empty directory; harmless.
      }
    } else {
      result.orphanedFilesLeft = remaining.length;
    }
  }

  return result;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: errors will be reported in `electron/main.ts` (it still imports `saveLocalDat` and `restoreLocalDat` which no longer exist). That's expected — we'll fix those in Task 3. We're only checking that `localDat.ts` itself compiles. Confirm any errors are scoped to `main.ts`'s imports and nowhere else.

- [ ] **Step 3: Commit**

```bash
git add electron/localDat.ts
git commit -m "refactor(local-dat): rewrite module for per-account profile dirs"
```

(Repo will be in a non-building state until Task 3 lands the main.ts changes. That's fine — each commit's content is logically isolated and the next task fixes the compile error.)

---

## Task 2: Unit tests for the new localDat module

**Files:**
- Create: `electron/localDat.test.ts`

- [ ] **Step 1: Create `electron/localDat.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  migrateLegacyLocalDat,
  type MigrationFs,
  type MigrationResult,
} from './localDat.js';
import * as path from 'path';

type FsSpy = {
  fs: MigrationFs;
  existing: Set<string>;
  renames: Array<{ from: string; to: string }>;
  mkdirs: string[];
  rmdirs: string[];
};

function fakeFs(initialFiles: string[]): FsSpy {
  const existing = new Set<string>(initialFiles);
  // Pre-populate any directory prefixes so existsSync(dir) is true when files inside exist.
  for (const file of initialFiles) {
    let dir = path.dirname(file);
    while (dir && dir !== path.dirname(dir)) {
      existing.add(dir);
      dir = path.dirname(dir);
    }
  }
  const renames: Array<{ from: string; to: string }> = [];
  const mkdirs: string[] = [];
  const rmdirs: string[] = [];
  const fs: MigrationFs = {
    existsSync: (p) => existing.has(p),
    mkdirSync: (p, _opts) => {
      mkdirs.push(p);
      let dir = p;
      while (dir && dir !== path.dirname(dir)) {
        existing.add(dir);
        dir = path.dirname(dir);
      }
    },
    renameSync: (from, to) => {
      renames.push({ from, to });
      existing.delete(from);
      existing.add(to);
    },
    readdirSync: (p) => {
      const prefix = p.endsWith(path.sep) ? p : p + path.sep;
      return Array.from(existing)
        .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes(path.sep))
        .map((entry) => entry.slice(prefix.length));
    },
    rmdirSync: (p) => {
      rmdirs.push(p);
      existing.delete(p);
    },
  };
  return { fs, existing, renames, mkdirs, rmdirs };
}

const USER = '/u';
const legacyPath = (id: string) => path.join(USER, 'local-dat', `${id}.dat`);
const newPath = (id: string) =>
  path.join(USER, 'profiles', id, 'Guild Wars 2', 'Local.dat');

describe('migrateLegacyLocalDat', () => {
  it('moves legacy Local.dat into the per-account profile directory', () => {
    const spy = fakeFs([legacyPath('a')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual(['a']);
    expect(spy.renames).toEqual([{ from: legacyPath('a'), to: newPath('a') }]);
    expect(spy.mkdirs).toContain(path.dirname(newPath('a')));
    expect(result.errors).toEqual([]);
  });

  it('skips accounts whose new Local.dat already exists', () => {
    const spy = fakeFs([legacyPath('a'), newPath('a')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual([]);
    expect(spy.renames).toEqual([]);
  });

  it('skips accounts with neither old nor new file', () => {
    const spy = fakeFs([]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['fresh-account'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual([]);
    expect(spy.renames).toEqual([]);
  });

  it('removes the legacy directory when it is empty after migration', () => {
    const spy = fakeFs([legacyPath('a')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.legacyDirRemoved).toBe(true);
    expect(spy.rmdirs).toEqual([path.join(USER, 'local-dat')]);
  });

  it('leaves the legacy directory in place when orphaned files remain', () => {
    // 'b' is not in accountIds, so its .dat is orphaned and untouched.
    const spy = fakeFs([legacyPath('a'), legacyPath('b')]);
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(result.legacyDirRemoved).toBe(false);
    expect(result.orphanedFilesLeft).toBe(1);
    expect(spy.rmdirs).toEqual([]);
  });

  it('continues with other accounts when one rename throws', () => {
    const spy = fakeFs([legacyPath('a'), legacyPath('b')]);
    const originalRename = spy.fs.renameSync;
    spy.fs.renameSync = (from, to) => {
      if (from === legacyPath('a')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      originalRename(from, to);
    };
    const result = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a', 'b'] },
      spy.fs,
    );
    expect(result.migratedAccountIds).toEqual(['b']);
    expect(result.errors).toEqual([
      { accountId: 'a', reason: expect.stringContaining('EBUSY') },
    ]);
  });

  it('is idempotent on a second run after a successful first run', () => {
    const spy = fakeFs([legacyPath('a')]);
    const first: MigrationResult = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(first.migratedAccountIds).toEqual(['a']);
    const renamesAfterFirst = spy.renames.length;

    const second = migrateLegacyLocalDat(
      { userDataDir: USER, accountIds: ['a'] },
      spy.fs,
    );
    expect(second.migratedAccountIds).toEqual([]);
    expect(spy.renames.length).toBe(renamesAfterFirst); // no new renames
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npm test`
Expected: all 7 `migrateLegacyLocalDat` tests pass (along with the 16 pre-existing `mutexCloser` tests, for a total of 23).

If main.ts still has compile errors from Task 1, vitest may surface them in passing imports — but `localDat.test.ts` only imports `migrateLegacyLocalDat` and types, not `main.ts`, so it should pass.

- [ ] **Step 3: Commit**

```bash
git add electron/localDat.test.ts
git commit -m "test(local-dat): migration logic unit tests"
```

---

## Task 3: Update launch-account: inject APPDATA env, drop restoreLocalDat call

**Files:**
- Modify: `electron/main.ts`

This task touches three sections of `main.ts`:

1. The import line at the top — drop `saveLocalDat`, `restoreLocalDat`; add `getAccountAppDataDir`.
2. The `launch-account` handler — drop the `restoreLocalDat` call and its log-branch block; add `APPDATA` env to the direct-executable spawn.
3. The `save-local-dat` IPC handler — remove it entirely.

- [ ] **Step 1: Update the localDat import line**

Find this line near the top of `electron/main.ts` (currently line 15):

```ts
import { saveLocalDat, hasLocalDat, deleteLocalDat, restoreLocalDat, getSteamLibraryPaths } from './localDat.js';
```

Replace with:

```ts
import { getAccountAppDataDir, hasLocalDat, deleteLocalDat, getSteamLibraryPaths } from './localDat.js';
```

- [ ] **Step 2: Remove the `save-local-dat` IPC handler**

Find this block in `electron/main.ts` (around line 1301):

```ts
ipcMain.handle('save-local-dat', async (_, accountId: string) => {
  return saveLocalDat(accountId);
});
```

Delete the entire block (3 lines).

- [ ] **Step 3: Replace the three-branch log block in `launch-account` with a single `hasLocalDat` check**

Find this block (around line 1601):

```ts
  // Swap Local.dat if available — enables -autologin (no UI automation needed)
  const hasAuth = restoreLocalDat(account.id);
  if (hasAuth) {
    logMain('launch', `[local-dat] Restored Local.dat for account=${id}, using -autologin`);
  } else if (hasLocalDat(account.id)) {
    logMainWarn('launch', `[local-dat] Saved Local.dat exists for account=${id} but couldn't be installed (likely locked by another running GW2 instance); launching without -autologin`);
  } else {
    logMain('launch', `[local-dat] No saved Local.dat for account=${id}, launching without -autologin`);
  }
```

Replace with:

```ts
  // Each account runs against its own AppData via the APPDATA env injected on
  // spawn (see below). Autologin works whenever Local.dat exists in the account
  // profile dir, even with other GW2 instances running concurrently.
  const hasAuth = hasLocalDat(account.id);
  if (hasAuth) {
    logMain('launch', `[local-dat] Saved login present for account=${id}, using -autologin`);
  } else {
    logMain('launch', `[local-dat] No saved login for account=${id}, launching without -autologin`);
  }
```

- [ ] **Step 4: Inject `APPDATA` env on the direct-executable spawn**

Find the direct-executable spawn block in `launch-account` (around line 1626). It currently looks like:

```ts
    if (gw2Path && process.platform !== 'linux') {
      console.log('Launching direct executable:', args.join(' '));
      logMain('launch', `Launching account=${id} via direct executable with ${args.length} args`);
      const gw2WorkingDirectory = path.dirname(gw2Path);
      const child = spawn(gw2Path, args, {
        cwd: gw2WorkingDirectory,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
```

Replace with:

```ts
    if (gw2Path && process.platform !== 'linux') {
      console.log('Launching direct executable:', args.join(' '));
      logMain('launch', `Launching account=${id} via direct executable with ${args.length} args`);
      const gw2WorkingDirectory = path.dirname(gw2Path);
      const accountAppDataDir = getAccountAppDataDir(account.id);
      logMain('launch', `[profile] account=${id} APPDATA=${accountAppDataDir}`);
      const child = spawn(gw2Path, args, {
        cwd: gw2WorkingDirectory,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env: { ...process.env, APPDATA: accountAppDataDir },
      });
```

Note: only the direct-executable branch gets the env override. The Steam-fallback branch and the Linux Proton branch are left untouched — `APPDATA` is a Windows env var that's meaningless inside Wine.

- [ ] **Step 5: Typecheck and run tests**

Run: `npx tsc -p tsconfig.electron.json --noEmit && npm test`
Expected: typecheck clean; 23 vitest tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): inject per-account APPDATA, drop restoreLocalDat"
```

---

## Task 4: Drop saveLocalDat from preload + types

**Files:**
- Modify: `electron/preload.cts`
- Modify: `electron/types.ts`

- [ ] **Step 1: Remove the `saveLocalDat` bridge from preload**

In `electron/preload.cts`, find this line (around line 79):

```ts
    saveLocalDat: (accountId: string) => ipcRenderer.invoke('save-local-dat', accountId),
```

Delete it entirely (including the trailing comma if it's the last entry; otherwise just the one line).

- [ ] **Step 2: Remove `'save-local-dat'` from IpcEvents**

In `electron/types.ts`, find this line (around line 57):

```ts
    'save-local-dat': (accountId: string) => Promise<{ success: boolean; message: string }>;
```

Delete it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: clean. (Renderer-side `tsc --noEmit` will fail because `src/App.tsx` still calls `window.api.saveLocalDat`. That's expected — Task 5 fixes it. Run only the electron-config typecheck for this task.)

- [ ] **Step 4: Commit**

```bash
git add electron/preload.cts electron/types.ts
git commit -m "refactor(ipc): retire save-local-dat IPC surface"
```

---

## Task 5: Drop Save Login from the renderer

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AddAccountModal.tsx`

- [ ] **Step 1: Remove `handleSaveLogin` from `src/App.tsx`**

Find this block (around line 295):

```ts
    const handleSaveLogin = async (id: string) => {
        try {
            const result = await window.api.saveLocalDat(id);
            if (result.success) {
                setAccountHasLocalDat((prev) => ({ ...prev, [id]: true }));
                showToast('Login saved for this account.');
            } else {
                showToast(result.message);
            }
        } catch {
            showToast('Failed to save login.');
        }
    };
```

Delete the entire function (13 lines).

- [ ] **Step 2: Remove the auto-save effect from `src/App.tsx`**

Find this block (around line 417):

```tsx
    // Auto-save Local.dat when an account stops running and has no saved copy
    const prevStatusesRef = useRef<Record<string, string>>({});
    useEffect(() => {
        const prev = prevStatusesRef.current;
        for (const [id, status] of Object.entries(accountStatuses)) {
            if (status === 'idle' && prev[id] === 'running' && !accountHasLocalDat[id]) {
                handleSaveLogin(id);
            }
        }
        prevStatusesRef.current = { ...accountStatuses };
    }, [accountStatuses]);
```

Delete the entire block (10 lines). In the new model GW2 itself writes the per-account Local.dat directly to the profile dir; no copy step is needed when an account stops.

If `useRef` is no longer imported anywhere else in this file, also remove it from the React import line at the top of the file. Verify with `grep "useRef" src/App.tsx` after the delete — should return zero matches if the import needs trimming.

- [ ] **Step 3: Remove `onResaveLogin` from the `AddAccountModal` invocation in `src/App.tsx`**

Find this line (around line 1005):

```tsx
                onResaveLogin={handleSaveLogin}
```

Delete it.

- [ ] **Step 4: Remove `onResaveLogin` from the prop type and component in `src/components/AddAccountModal.tsx`**

Find the props interface (around lines 9-14). Delete the `onResaveLogin?: (id: string) => void;` line from it.

In the destructured component signature (around line 18):

```tsx
const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSave, onDelete, onResaveLogin, onClearLogin, hasLocalDat, initialData }) => {
```

Remove `onResaveLogin, `.

- [ ] **Step 5: Remove the Re-save button from `AddAccountModal.tsx`**

Find this block (around line 214):

```tsx
                                {hasLocalDat && onResaveLogin && (
                                    <button
                                        type="button"
                                        onClick={() => onResaveLogin(initialData.id)}
                                        className="btn-surface px-3 py-1.5 text-xs"
                                    >
                                        Re-save
                                    </button>
                                )}
```

Delete the entire conditional render (9 lines). The "Clear" button immediately below it stays.

- [ ] **Step 6: Typecheck and run tests**

Run: `npx tsc --noEmit && npx tsc -p tsconfig.electron.json --noEmit && npm test`
Expected: both typechecks clean; 23 vitest tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/AddAccountModal.tsx
git commit -m "feat(ui): remove Save Login button and auto-save flow"
```

---

## Task 6: Wire the migration into app startup

**Files:**
- Modify: `electron/main.ts`

The existing top-of-file migration cluster already runs early on startup (for AppImage rename and updater-cache cleanup). We add a third migration block that runs `migrateLegacyLocalDat` after the store is loaded.

- [ ] **Step 1: Add `migrateLegacyLocalDat` to the localDat import in `electron/main.ts`**

Find the import line currently reading:

```ts
import { getAccountAppDataDir, hasLocalDat, deleteLocalDat, getSteamLibraryPaths } from './localDat.js';
```

Replace with:

```ts
import { getAccountAppDataDir, hasLocalDat, deleteLocalDat, getSteamLibraryPaths, migrateLegacyLocalDat } from './localDat.js';
```

- [ ] **Step 2: Find a safe place to run the migration**

Migration needs `store` (to read the account list) and `app.getPath('userData')` (resolved). Both are available at the top of `app.whenReady().then(...)`. Search `electron/main.ts` for `app.whenReady` to find the existing init handler:

```bash
grep -n "app.whenReady" electron/main.ts
```

There should be exactly one call. Open the handler body.

- [ ] **Step 3: Add the migration block at the top of the `app.whenReady` handler**

Inside the `.then(async () => { ... })` (or equivalent async body) of the `app.whenReady` chain, add this block as the FIRST statement before any window creation:

```ts
  // Migrate legacy per-account Local.dat snapshots into the per-profile layout
  // introduced in v1.1.14. Idempotent — re-runs at every startup but only acts
  // when there's actual legacy state to move.
  try {
    // @ts-ignore
    const accountsForMigration = (store.get('accounts') as Array<{ id: string }> | undefined) || [];
    const migrationResult = migrateLegacyLocalDat(
      {
        userDataDir: app.getPath('userData'),
        accountIds: accountsForMigration.map((a) => a.id),
      },
      {
        existsSync: fs.existsSync,
        mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
        renameSync: (from, to) => fs.renameSync(from, to),
        readdirSync: (p) => fs.readdirSync(p) as string[],
        rmdirSync: (p) => fs.rmdirSync(p),
      },
    );
    if (migrationResult.migratedAccountIds.length > 0) {
      logMain('startup', `[migration:profiles] moved Local.dat for accounts=${migrationResult.migratedAccountIds.join(',')}`);
    }
    if (migrationResult.legacyDirRemoved) {
      logMain('startup', `[migration:profiles] removed empty legacy local-dat directory`);
    }
    if (migrationResult.orphanedFilesLeft > 0) {
      logMainWarn('startup', `[migration:profiles] legacy local-dat directory contained ${migrationResult.orphanedFilesLeft} orphaned files; left untouched`);
    }
    for (const err of migrationResult.errors) {
      logMainError('startup', `[migration:profiles] account=${err.accountId} failed: ${err.reason}`);
    }
  } catch (err: any) {
    logMainError('startup', `[migration:profiles] unexpected error: ${err?.message ?? err}`);
  }
```

Note: if the `app.whenReady` handler is NOT already async, you may need to convert it. But the existing code already uses `await store.init(...)` or similar in there — confirm by reading the handler. If the handler is synchronous, the migration block can still go in (none of its calls are async).

If `logMain` / `logMainWarn` / `logMainError` aren't yet imported/defined at this point in the file, they ARE defined earlier in `main.ts` (search for `function logMain` to confirm). No new imports needed.

- [ ] **Step 4: Typecheck and run tests**

Run: `npx tsc -p tsconfig.electron.json --noEmit && npm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(startup): migrate legacy Local.dat into per-account profiles"
```

---

## Task 7: Profile cleanup on account deletion

**Files:**
- Modify: `electron/main.ts`

Today's `delete-account` handler doesn't clean up the saved Local.dat. With the new layout, account deletion should remove the entire profile directory so deleted accounts don't leave gigabytes-of-AppData (well, megabytes) orphaned.

- [ ] **Step 1: Update the `delete-account` IPC handler**

Find (around line 1521):

```ts
ipcMain.handle('delete-account', async (_, id) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const newAccounts = accounts.filter((a: any) => a.id !== id);
  store.set('accounts', newAccounts);
  launchStateMachine.clearState(id);
  return true;
});
```

Replace with:

```ts
ipcMain.handle('delete-account', async (_, id) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const newAccounts = accounts.filter((a: any) => a.id !== id);
  store.set('accounts', newAccounts);
  launchStateMachine.clearState(id);
  try {
    deleteLocalDat(id);
  } catch (err: any) {
    logMainWarn('delete-account', `Failed to clean up profile dir for account=${id}: ${err?.message ?? err}`);
  }
  return true;
});
```

`deleteLocalDat` is already imported (from Task 3). `logMainWarn` is already in scope. Wrapping in try/catch ensures a failed cleanup never blocks account deletion in the store.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(accounts): clean up profile directory on account deletion"
```

---

## Task 8: Manual verification on Windows

Manual; nothing to write. Don't merge until this is done at least once on a real Windows GW2 install.

- [ ] **Step 1: Test upgrade path from v1.1.13**

On a Windows machine running v1.1.13:
- Log into account A through AxiAM (so `userData/local-dat/<a>.dat` exists in the legacy layout) and confirm the "Saved" badge shows.
- Quit AxiAM and GW2.
- Install v1.1.14.
- Launch AxiAM. Check the main.log for `[migration:profiles] moved Local.dat for accounts=<a-id>`.
- Verify on disk: `%APPDATA%\AxiAM\profiles\<a-id>\Guild Wars 2\Local.dat` exists; `%APPDATA%\AxiAM\local-dat\` is gone (or empty).
- The "Saved" badge still shows for account A.
- Launch account A. Confirm `-autologin` works (no manual login required).

- [ ] **Step 2: Test fresh account**

In a clean profile or with a new account added:
- Add a new account in AxiAM (no saved login yet).
- Launch the account. GW2 starts with the login screen (no autologin).
- Type the credentials with "Remember Me" checked. Successful login.
- Quit GW2.
- Verify on disk: `%APPDATA%\AxiAM\profiles\<id>\Guild Wars 2\Local.dat` was created.
- Relaunch the account. Autologin succeeds.

- [ ] **Step 3: Test two concurrent accounts**

With `allowMultiInstance` toggled ON in Settings:
- Launch account A. Manual login + Remember Me. Wait until past character select.
- Launch account B. Manual login + Remember Me. Wait until past character select.
- Verify both `Gw2-64.exe` are running in Task Manager.
- Quit both clients.
- Relaunch A → autologin as A (no prompt).
- While A is running, launch B → autologin as B (no prompt).
- Both instances logged in correctly to their respective accounts.

- [ ] **Step 4: Confirm host AppData is untouched**

After multiple launches:
- `%APPDATA%\Guild Wars 2\Local.dat` (the user's actual system one) has NOT been modified by any AxiAM launch. Check the modified-time before and after.
- Launching GW2 directly outside AxiAM still uses the system file and behaves the same as before AxiAM was installed.

- [ ] **Step 5: Clear Login**

- For an account with saved login, click "Clear" in the account edit modal.
- Verify on disk: `%APPDATA%\AxiAM\profiles\<id>\` directory is removed.
- "Saved" badge flips to "Not saved."
- Next launch shows the login screen instead of auto-logging in.

- [ ] **Step 6: Account deletion cleans up the profile dir**

- Add a temporary throwaway account, launch it, log in.
- Delete the account from AxiAM.
- Verify on disk: the `%APPDATA%\AxiAM\profiles\<deleted-id>\` directory is gone.

Record outcomes in the PR description: e.g. "Verified all six steps on Windows 11 with a standalone GW2 install. Migration ran cleanly from a v1.1.13 state with one saved login."

---

## Self-Review

**Spec coverage check:**

- Per-account profile dir at `userData/profiles/<accountId>/` → Task 1 (`getAccountAppDataDir`).
- Launch path injects `APPDATA` env on direct-exe spawn → Task 3 (Step 4).
- Windows-only; Linux untouched → Task 3 (Step 4 only modifies the direct-exe branch).
- `hasLocalDat` rewritten to check profile dir → Task 1.
- `deleteLocalDat` rewritten to remove whole profile dir → Task 1.
- `saveLocalDat`, `restoreLocalDat`, `getLocalDatPath`, `getStorageDir`, `getAccountLocalDatPath` removed → Task 1.
- v1.1.13 EBUSY/EACCES/EPERM try/catch removed → Task 1 (gone with `restoreLocalDat`).
- `save-local-dat` IPC handler removed → Task 3 (Step 2).
- IPC handler import cleanup in main.ts → Task 3 (Step 1).
- `restoreLocalDat` call in launch-account removed → Task 3 (Step 3).
- Three-branch hasAuth log block collapsed → Task 3 (Step 3).
- `saveLocalDat` bridge removed from preload → Task 4 (Step 1).
- `'save-local-dat'` removed from IpcEvents → Task 4 (Step 2).
- `handleSaveLogin` and auto-save useEffect removed → Task 5 (Steps 1, 2).
- `onResaveLogin` prop and Re-save button removed → Task 5 (Steps 3, 4, 5).
- Migration on startup, idempotent, with per-account try/catch → Task 6 + Task 2 (tests).
- Profile dir cleanup on account deletion → Task 7.
- Unit tests for migration with injectable filesystem → Task 2.
- Manual verification → Task 8.

No spec gaps.

**Placeholder scan:** none. Every code step has full code; no TBD/TODO; commit messages are concrete.

**Type consistency:**
- `MigrationFs` interface defined in Task 1, used in Tasks 2 and 6 with the same shape (`existsSync, mkdirSync, renameSync, readdirSync, rmdirSync`).
- `MigrationResult` defined in Task 1, accessed in Task 2 tests and Task 6's startup logging with matching field names (`migratedAccountIds, legacyDirRemoved, orphanedFilesLeft, errors`).
- `getAccountAppDataDir` defined in Task 1, called in Task 3 with `account.id`.
- `hasLocalDat`, `deleteLocalDat` keep their existing signatures (`(accountId: string) => boolean | void`); existing callers are unchanged.

Plan ready for execution.

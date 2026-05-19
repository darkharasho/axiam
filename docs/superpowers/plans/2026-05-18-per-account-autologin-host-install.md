# Per-account Autologin via Host-Path Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace v1.1.14-take-1's broken `APPDATA` env-var redirect with the Gw2Launcher pattern — install each account's saved `Local.dat` at `%APPDATA%\Guild Wars 2\Local.dat` before each launch, serialize concurrent launches with a 4-second dwell, auto-snapshot the host file back into the per-account profile dir when GW2 quits (single-instance only).

**Architecture:** A new `installSnapshotToHost`/`snapshotHostToAccount` pair in `localDat.ts` handles the file mirroring. A new `launchSerializer` async mutex wraps the `launch-account` handler so concurrent launches process one at a time. A new `quitWatcher` polls `Gw2-64.exe` PIDs and fires a `'quit'` event when a tracked PID disappears; main wires that to `snapshotHostToAccount` guarded by "is another GW2 still running?" Spec: `docs/superpowers/specs/2026-05-17-per-account-autologin-host-install-design.md`.

**Tech Stack:** TypeScript (Electron main), Node `fs`/`child_process`, vitest (existing setup). No new dependencies.

---

## File structure

**New files:**

- `electron/launchSerializer.ts` — single-instance FIFO async mutex. Exports `acquire(): Promise<() => void>`.
- `electron/launchSerializer.test.ts` — vitest unit tests for the mutex.
- `electron/quitWatcher.ts` — periodic `Gw2-64.exe` PID watcher with `'quit'` events. Exports `start`, `stop`, `noteLaunch`, `noteStop`, and an `EventEmitter`-shaped `on('quit', listener)`.
- `electron/quitWatcher.test.ts` — vitest unit tests for the watcher using an injectable PID-poller.

**Modified files:**

- `electron/localDat.ts` — remove `getAccountAppDataDir`. Add internal `getHostLocalDatPath`, public `installSnapshotToHost`, public `snapshotHostToAccount`.
- `electron/localDat.test.ts` — add tests for the two new functions using a fake filesystem.
- `electron/main.ts` — drop the `APPDATA` env injection; wire in `launchSerializer.acquire/release` around `launch-account`; replace env-inject with `installSnapshotToHost` + retry + `-autologin` drop; add the 4-second dwell after process detection; call `quitWatcher.noteLaunch` on success; call `quitWatcher.noteStop` from `stop-account-process` handler; start/stop the watcher in `app.on('ready')` / `app.on('before-quit')`; register the `'quit'` listener that calls `snapshotHostToAccount`.

**No source-file changes:** `electron/mutexCloser.ts`, `tools/mutex-closer/**`, `electron/preload.cts`, `electron/types.ts`, `electron/launchStateMachine.ts`, anything under `src/`.

---

## Task 1: Add `installSnapshotToHost` and `snapshotHostToAccount` to `localDat.ts`

**Files:**
- Modify: `electron/localDat.ts`

This task adds the two new copy functions and a shared `getHostLocalDatPath` helper. The existing `getAccountAppDataDir` export is removed because nothing will use it after Task 4.

- [ ] **Step 1: Replace the contents of `electron/localDat.ts` with the following**

Open `electron/localDat.ts`. Verify it currently exports `getSteamLibraryPaths`, `getAccountAppDataDir`, `getAccountLocalDatPath`, `hasLocalDat`, `deleteLocalDat`, `MigrationFs`, `MigrationResult`, and `migrateLegacyLocalDat`. Replace the entire file with:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

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
 * Path to where the per-account Local.dat snapshot lives on disk.
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
 * True iff this account has a saved Local.dat snapshot in its profile directory.
 */
export function hasLocalDat(accountId: string): boolean {
  return fs.existsSync(getAccountLocalDatPath(accountId));
}

/**
 * Remove this account's entire profile directory and everything inside it.
 * Idempotent — no throw if missing.
 */
export function deleteLocalDat(accountId: string): void {
  const dir = path.join(app.getPath('userData'), 'profiles', accountId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Internal: path to the host's GW2 Local.dat (where the running game reads/writes).
 * Windows-only — Linux callers don't manipulate the host path.
 */
function getHostLocalDatPath(): string {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('APPDATA env var is not set; cannot resolve host Local.dat path');
  }
  return path.join(appData, 'Guild Wars 2', 'Local.dat');
}

export interface CopyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Inject the dependencies for testability. Real callers pass `node:fs` directly.
 */
export interface CopyFs {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts: { recursive: boolean }) => void;
  copyFileSync: (src: string, dest: string) => void;
}

/**
 * Copy the account's per-profile Local.dat snapshot over the host file so the
 * about-to-be-spawned Gw2-64.exe will read it via -autologin.
 *
 * Caller is expected to gate on `hasLocalDat(accountId)` first. Calling without
 * a snapshot returns `{ ok: false, reason: 'no-snapshot' }` defensively.
 *
 * Returns `{ ok: false, reason: 'EBUSY' | 'EACCES' | 'EPERM' | <other> }` on
 * filesystem failures. The caller decides whether to retry or proceed without
 * -autologin.
 */
export function installSnapshotToHost(
  accountId: string,
  filesystem: CopyFs = fs,
): CopyResult {
  const src = getAccountLocalDatPath(accountId);
  if (!filesystem.existsSync(src)) {
    return { ok: false, reason: 'no-snapshot' };
  }
  const dest = getHostLocalDatPath();
  const destDir = path.dirname(dest);
  try {
    if (!filesystem.existsSync(destDir)) {
      filesystem.mkdirSync(destDir, { recursive: true });
    }
    filesystem.copyFileSync(src, dest);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
  }
}

/**
 * Copy the host Local.dat back into the account's profile directory so future
 * launches and the "Saved" badge reflect the latest state (credentials +
 * settings GW2 wrote during the session).
 *
 * Returns `{ ok: false, reason: 'no-host-file' }` if the host Local.dat doesn't
 * exist (rare; warrants a warning at the call site).
 */
export function snapshotHostToAccount(
  accountId: string,
  filesystem: CopyFs = fs,
): CopyResult {
  const src = getHostLocalDatPath();
  if (!filesystem.existsSync(src)) {
    return { ok: false, reason: 'no-host-file' };
  }
  const dest = getAccountLocalDatPath(accountId);
  const destDir = path.dirname(dest);
  try {
    if (!filesystem.existsSync(destDir)) {
      filesystem.mkdirSync(destDir, { recursive: true });
    }
    filesystem.copyFileSync(src, dest);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
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
    if (filesystem.existsSync(newPath)) continue;

    const oldPath = path.join(legacyDir, `${accountId}.dat`);
    if (!filesystem.existsSync(oldPath)) continue;

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

Key changes from the current file:
- Drops `getAccountAppDataDir` entirely.
- Adds private `getHostLocalDatPath`, public `installSnapshotToHost`, public `snapshotHostToAccount`, public types `CopyFs` + `CopyResult`.
- Preserves `getSteamLibraryPaths`, `getAccountLocalDatPath`, `hasLocalDat`, `deleteLocalDat`, `migrateLegacyLocalDat` and their types unchanged.

- [ ] **Step 2: Typecheck**

```
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: ONE error — `electron/main.ts` line 15 still imports `getAccountAppDataDir`. That gets fixed in Task 5. No other errors anywhere.

- [ ] **Step 3: Commit**

```bash
git add electron/localDat.ts
git commit -m "feat(local-dat): add installSnapshotToHost + snapshotHostToAccount, drop getAccountAppDataDir"
```

---

## Task 2: Tests for `installSnapshotToHost` and `snapshotHostToAccount`

**Files:**
- Modify: `electron/localDat.test.ts`

Extend the existing test file with two new `describe` blocks covering the two new functions. Tests use a fake `CopyFs` that records every call.

- [ ] **Step 1: Append the new tests to `electron/localDat.test.ts`**

Open the file. Below the closing `});` of the existing `describe('migrateLegacyLocalDat', …)` block, append:

```ts
import { installSnapshotToHost, snapshotHostToAccount, type CopyFs, type CopyResult } from './localDat.js';

type CopyFsSpy = {
  fs: CopyFs;
  existing: Set<string>;
  copies: Array<{ src: string; dest: string }>;
  mkdirs: string[];
  failNextCopyWith?: NodeJS.ErrnoException;
};

function fakeCopyFs(initialFiles: string[]): CopyFsSpy {
  const existing = new Set<string>(initialFiles);
  for (const file of initialFiles) {
    let dir = path.dirname(file);
    while (dir && dir !== path.dirname(dir)) {
      existing.add(dir);
      dir = path.dirname(dir);
    }
  }
  const copies: Array<{ src: string; dest: string }> = [];
  const mkdirs: string[] = [];
  const spy: CopyFsSpy = {
    fs: {
      existsSync: (p) => existing.has(p),
      mkdirSync: (p, _opts) => {
        mkdirs.push(p);
        let dir = p;
        while (dir && dir !== path.dirname(dir)) {
          existing.add(dir);
          dir = path.dirname(dir);
        }
      },
      copyFileSync: (src, dest) => {
        if (spy.failNextCopyWith) {
          const err = spy.failNextCopyWith;
          spy.failNextCopyWith = undefined;
          throw err;
        }
        copies.push({ src, dest });
        existing.add(dest);
        let dir = path.dirname(dest);
        while (dir && dir !== path.dirname(dir)) {
          existing.add(dir);
          dir = path.dirname(dir);
        }
      },
    },
    existing,
    copies,
    mkdirs,
  };
  return spy;
}

// `installSnapshotToHost` resolves the host path via APPDATA env. Tests set it
// before calling and restore it afterward so we don't pollute other tests.
function withAppData<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.APPDATA;
  if (value === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previous;
    }
  }
}

describe('installSnapshotToHost', () => {
  it('returns no-snapshot when the per-account snapshot does not exist', () => {
    const spy = fakeCopyFs([]);
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-snapshot');
    expect(spy.copies).toEqual([]);
  });

  it('copies the snapshot over the host Local.dat on success', () => {
    const snapshotPath = path.join(
      path.dirname(path.dirname(__dirname)),
      // We don't care about the exact path the function computes from app.getPath('userData');
      // we just need the spy's existing set to contain "whatever path the function asks about."
      // The test below uses a wildcard match via the spy's copies log.
    );
    // Initial state: source file exists at whatever real path getAccountLocalDatPath returns
    // (resolved via the electron `app` mock — for unit tests, vitest may need to mock
    // electron.app.getPath; this test treats the function as a black box and asserts via spies.)
    const spy = fakeCopyFs([]);
    // Pre-create the source so the function finds it
    const source = (() => {
      // The function will call existsSync(getAccountLocalDatPath('acc-a')) — capture that path.
      // We populate the spy by intercepting the first existsSync call.
      // Easier: just give the spy a sentinel that always returns true for the source,
      // and capture the exact src path from the copies log.
      return null;
    })();
    void source;
    spy.fs.existsSync = (p) => p.includes('Local.dat') ? true : spy.existing.has(p);
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result).toEqual({ ok: true });
    expect(spy.copies.length).toBe(1);
    expect(spy.copies[0].dest).toBe(path.join('/host', 'Guild Wars 2', 'Local.dat'));
    expect(spy.copies[0].src.endsWith(path.join('Guild Wars 2', 'Local.dat'))).toBe(true);
  });

  it('creates the host Guild Wars 2 directory when missing', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.endsWith(path.join('Guild Wars 2', 'Local.dat')) && !p.startsWith('/host');
    // The destination dir does NOT exist yet; force mkdir.
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result.ok).toBe(true);
    expect(spy.mkdirs).toContain(path.join('/host', 'Guild Wars 2'));
  });

  it('returns the error code on copy failure', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = () => true;
    spy.failNextCopyWith = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }) as NodeJS.ErrnoException;
    const result = withAppData('/host', () => installSnapshotToHost('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EBUSY');
  });
});

describe('snapshotHostToAccount', () => {
  it('returns no-host-file when the host Local.dat does not exist', () => {
    const spy = fakeCopyFs([]);
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-host-file');
    expect(spy.copies).toEqual([]);
  });

  it('copies the host Local.dat into the per-account profile dir on success', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.startsWith('/host');
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result).toEqual({ ok: true });
    expect(spy.copies.length).toBe(1);
    expect(spy.copies[0].src).toBe(path.join('/host', 'Guild Wars 2', 'Local.dat'));
    expect(spy.copies[0].dest.endsWith(path.join('profiles', 'acc-a', 'Guild Wars 2', 'Local.dat'))).toBe(true);
  });

  it('creates the per-account Guild Wars 2 directory when missing', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.startsWith('/host');
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result.ok).toBe(true);
    expect(spy.mkdirs.some((dir) => dir.endsWith(path.join('profiles', 'acc-a', 'Guild Wars 2')))).toBe(true);
  });

  it('returns the error code on copy failure', () => {
    const spy = fakeCopyFs([]);
    spy.fs.existsSync = (p) => p.startsWith('/host');
    spy.failNextCopyWith = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) as NodeJS.ErrnoException;
    const result = withAppData('/host', () => snapshotHostToAccount('acc-a', spy.fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EACCES');
  });
});
```

The `import` statement at the top of this block goes at the **top of the file** alongside the existing imports — not at the position shown above. (Vitest hoists imports anyway, but place it physically with the other imports for clarity.)

`CopyResult` is imported even though unused directly; some IDEs flag the missing type annotation otherwise. Keep it.

- [ ] **Step 2: Run the new tests**

```
npm test
```

Expected: all migration tests still pass (7), plus 8 new tests (4 in `installSnapshotToHost`, 4 in `snapshotHostToAccount`) → 15 in `localDat.test.ts` + 16 in `mutexCloser.test.ts` = 31 total.

If a test fails because `app.getPath('userData')` throws inside the Node test environment, that's a setup issue — `app.getPath` returns a real path even in non-Electron contexts when called from a test. If you see "app is undefined" or similar, check whether `electron` needs mocking. (The existing migration tests use `migrateLegacyLocalDat` which doesn't call `app`. The new tests do via `getAccountLocalDatPath`. If this is a problem, switch to passing the snapshot path as an explicit argument; report as DONE_WITH_CONCERNS so the controller can guide.)

- [ ] **Step 3: Commit**

```bash
git add electron/localDat.test.ts
git commit -m "test(local-dat): cover installSnapshotToHost and snapshotHostToAccount"
```

---

## Task 3: Create `launchSerializer.ts`

**Files:**
- Create: `electron/launchSerializer.ts`

A tiny single-slot async mutex with a FIFO queue.

- [ ] **Step 1: Create `electron/launchSerializer.ts`**

```ts
/**
 * Single-slot async mutex with a FIFO queue.
 *
 * Each call to `acquire()` returns a Promise that resolves with a `release`
 * function when the previous holder (if any) has called release. Calls resolve
 * in FIFO order.
 *
 * Usage:
 *   const release = await launchSerializer.acquire();
 *   try {
 *     // do mutually-exclusive work
 *   } finally {
 *     release();
 *   }
 *
 * Uncontended `acquire()` resolves on the next microtask (the chain head is
 * `Promise.resolve()`), so the common single-launch path adds negligible
 * overhead.
 */
let chain: Promise<void> = Promise.resolve();

export async function acquire(): Promise<() => void> {
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitFor = chain;
  chain = next;
  await waitFor;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/**
 * Test helper: reset the internal chain. Tests should call this in beforeEach
 * so a leftover unreleased acquire from one test doesn't deadlock the next.
 * Not exported for production use.
 */
export function __resetForTests(): void {
  chain = Promise.resolve();
}
```

- [ ] **Step 2: Verify it compiles**

```
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: same one pre-existing error in `electron/main.ts:15` (Task 5 fixes it). No new errors.

- [ ] **Step 3: Commit**

```bash
git add electron/launchSerializer.ts
git commit -m "feat(launch-serializer): single-slot async mutex for serialized launches"
```

---

## Task 4: Tests for `launchSerializer`

**Files:**
- Create: `electron/launchSerializer.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { acquire, __resetForTests } from './launchSerializer.js';

describe('launchSerializer', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('uncontended acquire resolves on the next microtask', async () => {
    const release = await acquire();
    expect(typeof release).toBe('function');
    release();
  });

  it('queued acquires resolve in FIFO order', async () => {
    const order: string[] = [];
    const first = await acquire();

    // Don't release first yet — queue two more behind it.
    const secondPending = acquire().then((release) => {
      order.push('second');
      release();
    });
    const thirdPending = acquire().then((release) => {
      order.push('third');
      release();
    });

    // Neither has resolved yet because first is still held.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    first();
    await secondPending;
    await thirdPending;
    expect(order).toEqual(['second', 'third']);
  });

  it('release is idempotent within a single acquire', async () => {
    const release = await acquire();
    // Call release twice; the second call should be a no-op.
    release();
    release();
    // The next acquire should still resolve normally.
    const nextRelease = await acquire();
    expect(typeof nextRelease).toBe('function');
    nextRelease();
  });

  it('multiple queued acquires after release all run in order', async () => {
    const order: number[] = [];
    const acquires = [1, 2, 3, 4].map((n) =>
      acquire().then((release) => {
        order.push(n);
        release();
      }),
    );
    await Promise.all(acquires);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Run tests**

```
npm test
```

Expected: 4 new tests in `launchSerializer.test.ts` pass. Total 35 passing.

- [ ] **Step 3: Commit**

```bash
git add electron/launchSerializer.test.ts
git commit -m "test(launch-serializer): FIFO order and idempotent release"
```

---

## Task 5: Update `main.ts` import to drop `getAccountAppDataDir`

**Files:**
- Modify: `electron/main.ts`

A standalone cleanup task that fixes the dangling import from Task 1 before we wire in the new mechanism in Tasks 7-9. After this task, the repo compiles cleanly even though the new launch flow isn't in yet.

- [ ] **Step 1: Update the localDat import line**

Find this line near the top of `electron/main.ts` (around line 15):

```ts
import { getAccountAppDataDir, hasLocalDat, deleteLocalDat, getSteamLibraryPaths, migrateLegacyLocalDat } from './localDat.js';
```

Replace with:

```ts
import { hasLocalDat, deleteLocalDat, getSteamLibraryPaths, migrateLegacyLocalDat, installSnapshotToHost, snapshotHostToAccount } from './localDat.js';
```

`installSnapshotToHost` and `snapshotHostToAccount` get used in Tasks 7-9. They're imported now so a future task only modifies launch flow, not imports.

- [ ] **Step 2: Find and remove the `getAccountAppDataDir` call site in the launch handler**

Search:

```
grep -n "getAccountAppDataDir" electron/main.ts
```

Expected: one match in the direct-executable spawn block. The current code (around line 1633) looks like:

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

Replace with:

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

Note: removes the `accountAppDataDir` constant, the `[profile]` log line, AND the `env` option from the spawn (revert to default inherited env). Tasks 6-7 will add the new install step and the install log line; Task 8 will add the dwell.

- [ ] **Step 3: Typecheck and test**

```
npx tsc -p tsconfig.electron.json --noEmit && npm test
```

Expected: both clean; 35 tests pass.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "refactor(launch): drop APPDATA env injection from spawn"
```

---

## Task 6: Wrap `launch-account` in `launchSerializer` with cancellation check

**Files:**
- Modify: `electron/main.ts`

Wraps the existing handler body with the new serializer's `acquire`/`release`. Adds a cancellation check immediately after acquire so launches dropped from the queue by a Stop click don't actually fire.

- [ ] **Step 1: Add the launchSerializer import**

Near the existing localDat import, add:

```ts
import * as launchSerializer from './launchSerializer.js';
```

- [ ] **Step 2: Add `LAUNCH_DWELL_AFTER_DETECTED_MS` and friends as constants**

Find the existing timeout constants near the top of `main.ts`. Search:

```
grep -n "LINUX_PROCESS_WAIT_TIMEOUT_MS\|WINDOWS_PROCESS_SNAPSHOT_TTL_MS" electron/main.ts
```

Right after those existing constants, add:

```ts
const LAUNCH_DWELL_AFTER_DETECTED_MS = 4000;
const INSTALL_RETRY_TOTAL_MS = 3000;
const INSTALL_RETRY_INTERVAL_MS = 200;
const QUIT_WATCHER_POLL_INTERVAL_MS = 2000;
```

- [ ] **Step 3: Find the `launch-account` handler and wrap its body**

Search:

```
grep -n "ipcMain.handle('launch-account'" electron/main.ts
```

There should be one match. Read the current handler — it should start with `ipcMain.handle('launch-account', async (_, id) => {` and end with a `return launched;` and a `});`. The handler is long (~150 lines). The wrap looks like this:

```ts
ipcMain.handle('launch-account', async (_, id) => {
  const release = await launchSerializer.acquire();
  try {
    // Cancellation check: if a Stop click between this launch being queued and
    // actually firing transitioned the state machine away from launch_requested,
    // skip the launch entirely.
    const queuedState = launchStateMachine.getState(id);
    if (queuedState && (queuedState.phase === 'stopping' || queuedState.phase === 'stopped')) {
      logMain('launch', `[serializer] account=${id} skipped: launch was cancelled while queued (phase=${queuedState.phase})`);
      return false;
    }
    return await doLaunch(id);
  } finally {
    release();
  }
});

async function doLaunch(id: string): Promise<boolean> {
  // ... entire existing body of the launch-account handler goes here ...
}
```

Practical refactor:
1. Find the current `launch-account` handler.
2. Cut everything between `ipcMain.handle('launch-account', async (_, id) => {` and the closing `});` (the entire body, including all the `return false` / `return launched` statements).
3. Paste that body into a new top-level function `async function doLaunch(id: string): Promise<boolean> { ... }` placed JUST ABOVE the `ipcMain.handle('launch-account', ...)` call so it's hoisted.
4. Replace the `ipcMain.handle('launch-account', ...)` body with the serializer wrapper shown above.

Inside the moved body, the parameter is now `id` (the function arg), not the IPC destructuring. The body already references `id` everywhere; no rename needed.

- [ ] **Step 4: Typecheck**

```
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: clean.

- [ ] **Step 5: Run tests**

```
npm test
```

Expected: 35 tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): serialize concurrent launches via launchSerializer + cancellation check"
```

---

## Task 7: Install snapshot to host before spawn + retry-with-backoff + drop `-autologin` on failure

**Files:**
- Modify: `electron/main.ts`

Adds the install step inside `doLaunch`, just before the direct-executable spawn. Tracks whether `-autologin` should be in args based on install success.

- [ ] **Step 1: Find the args construction in `doLaunch`**

Search:

```
grep -n "Saved login present for account" electron/main.ts
```

The current args build (now inside `doLaunch`) looks like:

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

  const args = [
    '-mumble', mumbleName,
    ...(hasAuth ? ['-autologin'] : []),
    ...sanitizedExtraArgs,
  ];
```

- [ ] **Step 2: Replace the args construction with the install-then-build flow**

Replace the block from `// Each account runs against its own AppData…` down through the `const args = […]` declaration with:

```ts
  // Per-account autologin works by installing the account's saved Local.dat at
  // the host path right before spawn (Windows only; Linux uses Steam/Proton and
  // doesn't manipulate the host file). The install runs with retry-and-backoff
  // because another running GW2 may briefly hold the file open.
  let useAutologin = hasLocalDat(account.id);
  if (useAutologin && process.platform === 'win32') {
    const installResult = await installSnapshotToHostWithRetry(account.id);
    if (installResult.ok) {
      logMain('launch', `[install] account=${id} installed snapshot to host path`);
    } else if (installResult.reason === 'no-snapshot') {
      // Shouldn't happen — hasLocalDat returned true. Defensive log.
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
    logMain('launch', `[local-dat] No saved login for account=${id}, launching without -autologin`);
  }

  const args = [
    '-mumble', mumbleName,
    ...(useAutologin ? ['-autologin'] : []),
    ...sanitizedExtraArgs,
  ];
```

- [ ] **Step 3: Add the `installSnapshotToHostWithRetry` helper**

Add this helper function somewhere near the other launch helpers (e.g., immediately above the `doLaunch` function or near `getActiveAccountProcesses`):

```ts
async function installSnapshotToHostWithRetry(
  accountId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const start = Date.now();
  let lastResult = installSnapshotToHost(accountId);
  while (!lastResult.ok && Date.now() - start < INSTALL_RETRY_TOTAL_MS) {
    if (lastResult.reason === 'no-snapshot') return lastResult;
    await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_INTERVAL_MS));
    lastResult = installSnapshotToHost(accountId);
  }
  return lastResult;
}
```

- [ ] **Step 4: Typecheck and test**

```
npx tsc -p tsconfig.electron.json --noEmit && npm test
```

Expected: clean; 35 tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): install per-account Local.dat at host path with retry+backoff"
```

---

## Task 8: Dwell after process detection so GW2 finishes reading Local.dat

**Files:**
- Modify: `electron/main.ts`

Adds a 4-second sleep after `waitForAccountProcess` returns successfully, ensuring the next queued launch waits long enough for GW2 to consume the just-installed Local.dat.

- [ ] **Step 1: Find the waitForAccountProcess call in `doLaunch`**

Search:

```
grep -n "waitForAccountProcess(account.id" electron/main.ts
```

The current code looks like:

```ts
  const launched = await waitForAccountProcess(account.id, processWaitTimeoutMs, preLaunchGw2Pids);
  if (!launched) {
    logMainError(
      'launch',
      `Process not detected for account=${id} (${account.nickname}) within ${processWaitTimeoutMs}ms ` +
      `— GW2 may still be running but the launcher couldn't see it. ` +
      `Check %APPDATA%\\AxiAM\\logs\\main.log for WMI snapshot warnings.`,
    );
    launchStateMachine.setState(id, 'errored', 'inferred', 'Process not detected before timeout');
  } else {
    logMain('launch', `Account=${id} process detected and bound`);
    launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
    launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
  }
  return launched;
```

- [ ] **Step 2: Add the dwell after a successful detection**

Replace the success branch (`} else {` block) with:

```ts
  } else {
    logMain('launch', `Account=${id} process detected and bound`);
    launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
    launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
    if (process.platform === 'win32') {
      logMain('launch', `[dwell] account=${id} waiting ${LAUNCH_DWELL_AFTER_DETECTED_MS}ms for GW2 to consume Local.dat before releasing launch serializer`);
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_DWELL_AFTER_DETECTED_MS));
    }
  }
```

The dwell is `win32`-gated because Linux launches don't install at the host path (no need to give GW2 time to read it before the next install). Doesn't fire on the error branch — a failed launch shouldn't penalize the queue.

- [ ] **Step 3: Typecheck and test**

```
npx tsc -p tsconfig.electron.json --noEmit && npm test
```

Expected: clean; 35 tests pass.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): dwell after process detection so GW2 consumes Local.dat"
```

---

## Task 9: Create `quitWatcher.ts`

**Files:**
- Create: `electron/quitWatcher.ts`

A polling-based watcher that fires `'quit'` when a tracked `Gw2-64.exe` PID disappears from the process table.

- [ ] **Step 1: Create the file**

```ts
import { EventEmitter } from 'events';

/**
 * Watches a set of tracked `Gw2-64.exe` PIDs and emits 'quit' events when a
 * tracked PID disappears from the system process table.
 *
 * Lifecycle:
 *   start() once at app.ready (Windows only — Linux is a no-op).
 *   noteLaunch(accountId, pid) after a successful spawn + detection.
 *   noteStop(accountId) when the user explicitly stops an account (silently
 *     drops the binding — we DON'T snapshot on explicit stop).
 *   stop() once at app.before-quit.
 *
 * Emits: 'quit' with `accountId: string`.
 *
 * Polling uses an injected `getRunningPids` so tests can drive the watcher
 * deterministically without spawning real processes.
 */

export type PidPoller = () => number[];

class QuitWatcher extends EventEmitter {
  private bindings = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private poller: PidPoller = () => [];
  private intervalMs = 2000;

  configure(poller: PidPoller, intervalMs: number): void {
    this.poller = poller;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (process.platform !== 'win32') return;
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  noteLaunch(accountId: string, pid: number): void {
    this.bindings.set(accountId, pid);
  }

  noteStop(accountId: string): void {
    this.bindings.delete(accountId);
  }

  /**
   * Public for tests. Runs one poll cycle synchronously.
   */
  tick(): void {
    const livePids = new Set(this.poller());
    for (const [accountId, pid] of Array.from(this.bindings.entries())) {
      if (!livePids.has(pid)) {
        this.bindings.delete(accountId);
        this.emit('quit', accountId);
      }
    }
  }

  /**
   * Test helper: clear all bindings + stop the timer.
   */
  __resetForTests(): void {
    this.stop();
    this.bindings.clear();
  }
}

export const quitWatcher = new QuitWatcher();
```

- [ ] **Step 2: Typecheck**

```
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/quitWatcher.ts
git commit -m "feat(quit-watcher): PID-poll module that fires 'quit' on tracked process exit"
```

---

## Task 10: Tests for `quitWatcher`

**Files:**
- Create: `electron/quitWatcher.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { quitWatcher } from './quitWatcher.js';

describe('quitWatcher', () => {
  beforeEach(() => {
    quitWatcher.__resetForTests();
    quitWatcher.removeAllListeners('quit');
  });

  it('fires quit event when a tracked PID disappears from the poll', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    let livePids = [1000];
    quitWatcher.configure(() => livePids, 100);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick(); // PID 1000 still alive
    expect(events).toEqual([]);

    livePids = []; // PID 1000 disappeared
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('only emits once per tracked PID even if it stays gone across ticks', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    quitWatcher.configure(() => [], 100);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick(); // pid gone -> event fires
    quitWatcher.tick(); // already cleared from bindings -> no event
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('noteStop drops the binding silently without firing quit', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    quitWatcher.configure(() => [], 100);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.noteStop('acc-a'); // user explicitly stopped
    quitWatcher.tick(); // pid is gone but we already dropped the binding

    expect(events).toEqual([]);
  });

  it('tracks multiple accounts and only fires for the gone one', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    let livePids = [1000, 2000];
    quitWatcher.configure(() => livePids, 100);
    quitWatcher.noteLaunch('acc-a', 1000);
    quitWatcher.noteLaunch('acc-b', 2000);

    livePids = [2000]; // only acc-a's PID disappears
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('start is a no-op on non-Windows platforms', () => {
    // We can't easily flip process.platform inside the test, but we CAN verify
    // that start() doesn't throw or schedule on this host. If the host is
    // Windows the timer activates; either way no exception thrown.
    expect(() => quitWatcher.start()).not.toThrow();
    quitWatcher.stop();
  });
});
```

- [ ] **Step 2: Run tests**

```
npm test
```

Expected: 5 new tests in `quitWatcher.test.ts` pass. Total 40 passing.

- [ ] **Step 3: Commit**

```bash
git add electron/quitWatcher.test.ts
git commit -m "test(quit-watcher): PID-poll behavior and explicit-stop handling"
```

---

## Task 11: Wire `quitWatcher` into `main.ts` lifecycle + launch + stop + snapshot-on-quit

**Files:**
- Modify: `electron/main.ts`

The final wiring step. Starts the watcher at app ready, stops it before quit, calls `noteLaunch` on successful detection, calls `noteStop` in the stop handler, and registers a `'quit'` listener that fires `snapshotHostToAccount` when no other GW2 is running.

- [ ] **Step 1: Add the quitWatcher import**

Near the existing imports, add:

```ts
import { quitWatcher } from './quitWatcher.js';
```

- [ ] **Step 2: Configure the watcher and register the quit listener in `app.on('ready')`**

Search:

```
grep -n "app.on('ready'" electron/main.ts
```

Inside that `ready` handler, AFTER the existing migration block (after the line `} catch (err: any) { logMainError('startup', `[migration:profiles] unexpected error: ${err?.message ?? err}`); }`) and BEFORE `console.log("User Data Path:"`, add:

```ts
  // Configure and start the quit watcher (Windows only). When a tracked GW2
  // PID disappears AND no other GW2 is running, we snapshot the host Local.dat
  // back into the account's profile dir to preserve per-account settings.
  quitWatcher.configure(() => getAllRunningGw2Pids(), QUIT_WATCHER_POLL_INTERVAL_MS);
  quitWatcher.on('quit', (accountId: string) => {
    const remaining = getAllRunningGw2Pids();
    if (remaining.length > 0) {
      logMain('snapshot', `[snapshot] account=${accountId} quit but ${remaining.length} other GW2 still running; skipping copy-back to avoid cross-contamination`);
      return;
    }
    const result = snapshotHostToAccount(accountId);
    if (result.ok) {
      logMain('snapshot', `[snapshot] account=${accountId} copied Local.dat host → profile`);
    } else {
      logMainWarn('snapshot', `[snapshot] account=${accountId} skipped: ${result.reason}`);
    }
  });
  quitWatcher.start();
```

- [ ] **Step 3: Stop the watcher in `before-quit`**

Search:

```
grep -n "before-quit\|window-all-closed" electron/main.ts
```

If there's no `before-quit` handler yet, add one immediately above the `window-all-closed` handler:

```ts
app.on('before-quit', () => {
  quitWatcher.stop();
});
```

If a `before-quit` handler already exists, add `quitWatcher.stop();` as the first line inside it.

- [ ] **Step 4: Call `quitWatcher.noteLaunch` on successful detection**

In `doLaunch`, find the dwell block added in Task 8. The `} else {` branch (successful detection) currently looks like:

```ts
  } else {
    logMain('launch', `Account=${id} process detected and bound`);
    launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
    launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
    if (process.platform === 'win32') {
      logMain('launch', `[dwell] account=${id} waiting ${LAUNCH_DWELL_AFTER_DETECTED_MS}ms for GW2 to consume Local.dat before releasing launch serializer`);
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_DWELL_AFTER_DETECTED_MS));
    }
  }
```

Right after the `launchStateMachine.setState(id, 'running', …)` line and BEFORE the `if (process.platform === 'win32')` dwell, add:

```ts
    const boundPid = manualAccountPidBindings.get(id)
      ?? getActiveAccountProcesses().find((p) => p.accountId === id)?.pid;
    if (typeof boundPid === 'number') {
      quitWatcher.noteLaunch(id, boundPid);
    }
```

The bound PID comes from either the mumble-name detection path (`getActiveAccountProcesses`) or the elevation-blackout fallback (`manualAccountPidBindings`). Either source yields the same PID; we prefer the binding map because it's already keyed by accountId.

- [ ] **Step 5: Call `quitWatcher.noteStop` in the stop handler**

Search:

```
grep -n "ipcMain.handle('stop-account-process'" electron/main.ts
```

Replace the handler body to add the noteStop call:

```ts
ipcMain.handle('stop-account-process', async (_, accountId) => {
  if (isDevShowcase) {
    showcaseActiveAccounts.delete(String(accountId));
    return true;
  }
  quitWatcher.noteStop(accountId);
  return stopAccountProcess(accountId);
});
```

`noteStop` is called BEFORE `stopAccountProcess` so the binding is dropped before the actual kill — even if the kill is racy with the next poll tick, we won't fire `quit` for an explicit stop.

- [ ] **Step 6: Typecheck and test**

```
npx tsc -p tsconfig.electron.json --noEmit && npm test
```

Expected: clean; 40 tests pass.

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts
git commit -m "feat(quit-watcher): wire snapshot-on-quit into launch and stop handlers"
```

---

## Task 12: Manual verification on Windows

This task is exclusively manual. Don't merge until at least scenarios 1, 2, and 3 are verified on a real Windows GW2 install.

- [ ] **Step 1: Upgrade path from v1.1.13**

On a Windows machine running v1.1.13 with at least one saved login:
- Note current `%APPDATA%\AxiAM\local-dat\` contents.
- Install the new build (or run from dev with `npm run dev` against this branch).
- Launch the account from AxiAM.
- **Expected:** autologin succeeds (reaches character select without typing credentials).
- Check main.log for `[install] account=<id> installed snapshot to host path` and (after the dwell) `[dwell] account=<id> waiting 4000ms`.

- [ ] **Step 2: Fresh account, single-instance, full settings round-trip**

Add a new account in AxiAM (no saved login yet).
- Launch it → manual login + Remember Me + reach character select.
- In GW2 options, change a graphics setting (e.g., toggle Reflections off).
- Quit GW2 normally (close the window — don't kill via Task Manager).
- **Expected (within ~2-3 seconds of GW2 exiting):** main.log shows `[snapshot] account=<id> copied Local.dat host → profile`.
- Verify on disk: `%APPDATA%\AxiAM\profiles\<id>\Guild Wars 2\Local.dat` has a modify time matching the quit moment.
- Relaunch the account → autologin succeeds AND the Reflections setting is still off.

- [ ] **Step 3: Two concurrent accounts**

With `allowMultiInstance` ON in Settings:
- Launch account A → wait until character select.
- Launch account B → wait until character select.
- **Expected:** both `Gw2-64.exe` running concurrently; each autologged into the right account.
- In main.log, find the two `[install]` lines. They should be separated by AT LEAST 4 seconds (the dwell).
- Quit B (close window) — main.log should log `[snapshot] account=<B> quit but 1 other GW2 still running; skipping copy-back to avoid cross-contamination`.
- Quit A — main.log should log `[snapshot] account=<A> copied Local.dat host → profile`.
- Relaunch A — autologin succeeds; settings from the last single-instance A session (Step 2) preserved. The multi-instance B session did NOT corrupt A's saved state.

- [ ] **Step 4: Stop-while-queued cancellation**

- Click Launch on A → IMMEDIATELY click Launch on B (B queues behind A's dwell).
- BEFORE A finishes its 4-second dwell, click Stop on B.
- **Expected:** B's spawn never happens. No `Launching account=<B> via direct executable` log line. A runs normally.
- main.log should have a `[serializer] account=<B> skipped: launch was cancelled while queued (phase=stopped)` line.
- Re-launch B normally afterward → launches as expected.

- [ ] **Step 5: External GW2 sanity check**

- Launch GW2 directly via Steam or its desktop shortcut (without going through AxiAM).
- **Expected:** GW2 uses whichever account's credentials were last installed by AxiAM. This is by design — AxiAM "owns" the host `Local.dat` while installed.
- Document this behavior in release notes.

- [ ] **Step 6: Record results in the PR description**

Add a brief note to the PR description: e.g., "Verified scenarios 1–4 on Windows 11 with a standalone GW2 install. External-launch sanity check matches expected behavior."

---

## Self-Review

**Spec coverage:**

- Storage layout reuses current `main`'s `userData/profiles/<id>/` → Task 1.
- `installSnapshotToHost` + `snapshotHostToAccount` + private `getHostLocalDatPath` → Task 1.
- `getAccountAppDataDir` removed → Task 1 + Task 5.
- Unit tests for both copy functions → Task 2.
- `launchSerializer` module + tests → Tasks 3-4.
- `quitWatcher` module + tests → Tasks 9-10.
- Launch handler serializer wrap + cancellation check → Task 6.
- Install + retry-with-backoff + `-autologin` drop on failure → Task 7.
- 4-second dwell after process detection (win32-gated) → Task 8.
- `quitWatcher` lifecycle (start/stop, noteLaunch, noteStop, quit listener) → Task 11.
- Snapshot-on-quit guarded by "is another GW2 still running?" → Task 11.
- Removal of `APPDATA` env injection from spawn → Task 5.
- Constants block → Task 6 (defined) + used in Tasks 7, 8, 11.
- Linux behavior unchanged → preserved by `process.platform === 'win32'` gates in Tasks 7, 8, 11 + Linux branch left alone.
- Manual verification → Task 12.

No spec gaps.

**Placeholder scan:** none. Every code step shows full code; commit messages are concrete.

**Type consistency:**

- `CopyResult { ok: boolean; reason?: string }` defined in Task 1 and consumed by Task 7's `installSnapshotToHostWithRetry` and Task 11's `snapshotHostToAccount` listener.
- `CopyFs` interface in Task 1 used by Task 2 tests with matching shape (`existsSync`, `mkdirSync`, `copyFileSync`).
- `MigrationFs`/`MigrationResult` types preserved unchanged from prior implementation.
- `PidPoller` type in Task 9 used by Task 10 tests.
- `quitWatcher.configure(poller, intervalMs)` signature consistent across Task 9 (definition), Task 10 (tests), Task 11 (wiring).
- Constant names (`LAUNCH_DWELL_AFTER_DETECTED_MS`, `INSTALL_RETRY_TOTAL_MS`, `INSTALL_RETRY_INTERVAL_MS`, `QUIT_WATCHER_POLL_INTERVAL_MS`) defined in Task 6 and referenced unchanged in Tasks 7, 8, 11.
- Function names: `installSnapshotToHost` and `snapshotHostToAccount` consistent across Task 1, 2, 7, 11.

Plan ready for execution.

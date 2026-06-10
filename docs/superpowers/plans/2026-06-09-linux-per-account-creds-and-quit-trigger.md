# Linux Per-Account Credentials + Quit Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AxiAM install each account's `Local.dat` into the Proton prefix before launch and snapshot it back after quit on Linux, so per-account logins save and each account lands on its own last-played character.

**Architecture:** Port the Windows install/snapshot flow to Linux via a shared Proton-compatdata resolver and a platform-aware host-path. The critical addition the original design missed: `quitWatcher` is win32-only, so snapshot-back never fires on Linux — we run it on Linux too, detecting "quit" by the account's `-mumble` tag disappearing (not a single PID) with a grace window that rides over GW2's one-time startup re-exec.

**Tech Stack:** TypeScript, Electron main process, Vitest. No real Proton needed for unit tests — mock `fs`/`spawnSync` and inject pollers.

**Spec:** `docs/superpowers/specs/2026-05-19-linux-steam-per-account-creds-design.md` (revised 2026-06-09).

**Branch:** Work on a fresh branch off current `main` (named e.g. `feat/linux-per-account-creds-v2` to avoid the stale `feat/linux-per-account-creds`). The stale branch's `protonPaths.ts` is reusable verbatim (reproduced in Task 1); its `main.ts` changes are NOT — they predate the patch-detection release and must be hand-ported.

**Test runner note:** This machine caps vitest at 2 workers. Run tests as `npx vitest run --maxWorkers=2 <file>`.

---

### Task 1: Shared Proton compatdata resolver

**Files:**
- Create: `electron/protonPaths.ts`
- Test: `electron/protonPaths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// electron/protonPaths.test.ts
import { describe, it, expect } from 'vitest';
import { resolveGw2CompatDataDir, STEAM_GW2_APP_ID } from './protonPaths.js';

const fsWith = (existing: string[]) => ({
  existsSync: (p: string) => existing.includes(p),
});

describe('resolveGw2CompatDataDir', () => {
  it('returns null when no libraries have compatdata', () => {
    expect(resolveGw2CompatDataDir(['/lib/a', '/lib/b'], fsWith([]))).toBeNull();
  });

  it('returns the compatdata dir of the first matching library', () => {
    const match = `/lib/b/steamapps/compatdata/${STEAM_GW2_APP_ID}`;
    expect(resolveGw2CompatDataDir(['/lib/a', '/lib/b'], fsWith([match]))).toBe(match);
  });

  it('first-match wins when multiple libraries have compatdata', () => {
    const a = `/lib/a/steamapps/compatdata/${STEAM_GW2_APP_ID}`;
    const b = `/lib/b/steamapps/compatdata/${STEAM_GW2_APP_ID}`;
    expect(resolveGw2CompatDataDir(['/lib/a', '/lib/b'], fsWith([a, b]))).toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 electron/protonPaths.test.ts`
Expected: FAIL — cannot find module `./protonPaths.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/protonPaths.ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 electron/protonPaths.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/protonPaths.ts electron/protonPaths.test.ts
git commit -m "feat(proton): shared resolveGw2CompatDataDir utility

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Delegate mutexCloser compatdata lookup to the shared resolver

**Files:**
- Modify: `electron/mutexCloser.ts` (the per-library compatdata loop inside `resolveProtonContext`, ~lines 143-167)
- Test: `electron/mutexCloser.test.ts`

**Context:** `resolveProtonContext` currently inlines `path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID)` in two places. Replace the existence checks with the shared resolver so the two helpers can't disagree about which prefix is "the" GW2 prefix. Keep the running-Proton fast path and the per-library Proton discovery exactly as-is — only the compatdata *existence/selection* delegates.

- [ ] **Step 1: Read the current function and its tests**

Run: `npx vitest run --maxWorkers=2 electron/mutexCloser.test.ts`
Expected: PASS (baseline green before refactor).

- [ ] **Step 2: Refactor the compatdata selection to use the resolver**

In `electron/mutexCloser.ts`, import the resolver:

```ts
import { resolveGw2CompatDataDir, STEAM_GW2_APP_ID } from './protonPaths.js';
```

Then replace the final per-library loop in `resolveProtonContext` (the one starting `for (const lib of steamLibraryPaths)` near line 156) with a single resolver call that still finds the Proton binary in that library:

```ts
  const compat = resolveGw2CompatDataDir(steamLibraryPaths, filesystem);
  if (compat) {
    const lib = compat.slice(0, compat.indexOf(`${path.sep}steamapps${path.sep}compatdata`));
    const proton = findProtonInLibrary(compat, lib, compatToolsRoots, filesystem);
    if (proton) {
      return {
        compatDataPath: compat,
        protonPath: proton,
        clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
      };
    }
  }
  return null;
```

Leave the existing `STEAM_GW2_APP_ID` local const in `mutexCloser.ts` if other code there still references it; otherwise import it from `protonPaths.js` and delete the local declaration (line 108) to avoid a duplicate.

- [ ] **Step 3: Run tests to verify still green**

Run: `npx vitest run --maxWorkers=2 electron/mutexCloser.test.ts`
Expected: PASS — same behavior, now delegated. If a test asserted on the inlined path construction, update it to import `STEAM_GW2_APP_ID` from `protonPaths.js`.

- [ ] **Step 4: Commit**

```bash
git add electron/mutexCloser.ts electron/mutexCloser.test.ts
git commit -m "refactor(mutexCloser): delegate compatdata lookup to protonPaths

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Platform-aware host Local.dat path + HostUnavailableError

**Files:**
- Modify: `electron/localDat.ts` (`getHostLocalDatPath` at lines 67-77; move the `getHostLocalDatPath()` call inside the `try` in `installSnapshotToHost` ~line 112 and `snapshotHostToAccount` ~line 137)
- Test: `electron/localDat.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `electron/localDat.test.ts`. These exercise the Linux branch by stubbing `process.platform` and the resolver via injected deps. Use the existing `CopyFs` injection for the round-trip and a module mock for `getSteamLibraryPaths`/`resolveGw2CompatDataDir`.

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./protonPaths.js', () => ({
  STEAM_GW2_APP_ID: '1284210',
  resolveGw2CompatDataDir: vi.fn(),
}));
vi.mock('electron', () => ({ app: { getPath: () => '/userdata' } }));

import { resolveGw2CompatDataDir } from './protonPaths.js';
import { installSnapshotToHost, HostUnavailableError } from './localDat.js';

const setPlatform = (p: string) =>
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
const origPlatform = process.platform;
afterEach(() => setPlatform(origPlatform));

describe('Linux host Local.dat path', () => {
  it('installs into the Proton prefix path when compatdata exists', () => {
    setPlatform('linux');
    (resolveGw2CompatDataDir as any).mockReturnValue('/lib/steamapps/compatdata/1284210');
    const writes: Array<[string, string]> = [];
    const fsMock = {
      existsSync: (p: string) => p === '/userdata/profiles/acc/Guild Wars 2/Local.dat' || p.endsWith('Guild Wars 2'),
      mkdirSync: () => {},
      copyFileSync: (src: string, dest: string) => writes.push([src, dest]),
    };
    const result = installSnapshotToHost('acc', fsMock as any);
    expect(result.ok).toBe(true);
    expect(writes[0][1]).toBe(
      '/lib/steamapps/compatdata/1284210/pfx/drive_c/users/steamuser/AppData/Roaming/Guild Wars 2/Local.dat',
    );
  });

  it('returns host-unavailable when no compatdata prefix exists', () => {
    setPlatform('linux');
    (resolveGw2CompatDataDir as any).mockReturnValue(null);
    const fsMock = {
      existsSync: (p: string) => p === '/userdata/profiles/acc/Guild Wars 2/Local.dat',
      mkdirSync: () => {},
      copyFileSync: () => {},
    };
    const result = installSnapshotToHost('acc', fsMock as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host-unavailable');
  });
});

describe('HostUnavailableError', () => {
  it('is an Error subclass', () => {
    expect(new HostUnavailableError('x')).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --maxWorkers=2 electron/localDat.test.ts`
Expected: FAIL — `HostUnavailableError` not exported; Linux path not implemented.

- [ ] **Step 3: Implement the platform switch and error type**

In `electron/localDat.ts`, add the import and error class near the top:

```ts
import { resolveGw2CompatDataDir } from './protonPaths.js';

export class HostUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostUnavailableError';
  }
}
```

Replace `getHostLocalDatPath` (lines 67-77) with:

```ts
function getHostLocalDatPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error('APPDATA env var is not set; cannot resolve host Local.dat path');
    }
    return path.join(appData, 'Guild Wars 2', 'Local.dat');
  }
  if (process.platform === 'linux') {
    const compatDir = resolveGw2CompatDataDir(getSteamLibraryPaths());
    if (!compatDir) {
      throw new HostUnavailableError('no GW2 compatdata found in any Steam library');
    }
    return path.join(
      compatDir,
      'pfx', 'drive_c', 'users', 'steamuser',
      'AppData', 'Roaming', 'Guild Wars 2', 'Local.dat',
    );
  }
  throw new HostUnavailableError(`unsupported platform: ${process.platform}`);
}
```

In `installSnapshotToHost`, move the host-path resolution inside the `try` and map the typed error to a reason. Replace the body (lines 108-123) with:

```ts
export function installSnapshotToHost(
  accountId: string,
  filesystem: CopyFs = fs,
): CopyResult {
  const src = getAccountLocalDatPath(accountId);
  if (!filesystem.existsSync(src)) {
    return { ok: false, reason: 'no-snapshot' };
  }
  try {
    const dest = getHostLocalDatPath();
    const destDir = path.dirname(dest);
    if (!filesystem.existsSync(destDir)) {
      filesystem.mkdirSync(destDir, { recursive: true });
    }
    filesystem.copyFileSync(src, dest);
    return { ok: true };
  } catch (err: any) {
    if (err instanceof HostUnavailableError) return { ok: false, reason: 'host-unavailable' };
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
  }
}
```

Apply the same "host path inside try, map `HostUnavailableError` → `host-unavailable`" change to `snapshotHostToAccount` (lines 133-152): move `const src = getHostLocalDatPath();` inside the `try`, and add the `HostUnavailableError` branch to its `catch`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 electron/localDat.test.ts`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add electron/localDat.ts electron/localDat.test.ts
git commit -m "feat(localDat): Linux host path via Proton compatdata + HostUnavailableError

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Run install-to-host on Linux

**Files:**
- Modify: `electron/main.ts` — the install branch (lines 2054-2072) and the `launchContexts.set` block (lines 2113-2118)

**Context:** Today the install branch only runs on win32; the Linux branch just logs. Merge them so `installSnapshotToHostWithRetry` runs on both. The new `host-unavailable` reason means "prefix not created yet" → launch without `-autologin` gracefully (edge case E1).

- [ ] **Step 1: Replace the install branch**

In `electron/main.ts`, replace lines 2054-2072 (the `} else if (useAutologin && process.platform === 'win32') { … } else if (useAutologin) { … }` chain) with a single cross-platform branch:

```ts
  } else if (useAutologin) {
    const installResult = await installSnapshotToHostWithRetry(account.id);
    if (installResult.ok) {
      logMain('launch', `[install] account=${id} installed snapshot to host path`);
    } else if (installResult.reason === 'no-snapshot') {
      // Shouldn't happen — hasLocalDat returned true. Defensive log.
      logMainWarn('launch', `[install] account=${id} unexpected no-snapshot after hasLocalDat=true`);
      useAutologin = false;
    } else if (installResult.reason === 'host-unavailable') {
      // Proton prefix not created yet (GW2 never run through Steam). Launch
      // vanilla; snapshot-back captures Local.dat after the first login+quit.
      logMainWarn('launch', `[install] account=${id} compatdata not found; launching without -autologin`);
      useAutologin = false;
    } else {
      logMainWarn('launch', `[install] account=${id} retry exhausted (${installResult.reason}); launching without -autologin`);
      useAutologin = false;
    }
  } else {
    logMain('launch', `[local-dat] No saved login for account=${id}, launching without -autologin`);
  }
```

- [ ] **Step 2: Drop the win32 guard on launchContexts tracking**

Replace lines 2113-2118:

```ts
  if (process.platform === 'win32') {
    launchContexts.set(id, {
      installed: useAutologin,
      startedAtMs: Date.now(),
    });
  }
```

with (guard removed so Linux gets cross-contamination tracking too):

```ts
  launchContexts.set(id, {
    installed: useAutologin,
    startedAtMs: Date.now(),
  });
```

- [ ] **Step 3: Typecheck + run the existing main-related tests**

Run: `npx tsc --noEmit -p tsconfig.json` (or the project's typecheck script — check `package.json` scripts)
Expected: no type errors.
Run: `npx vitest run --maxWorkers=2 electron/`
Expected: PASS (no regressions; `installSnapshotToHostWithRetry` already exists and is now reachable on Linux).

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): install per-account Local.dat on Linux too

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: quitWatcher runs on Linux with mumble-liveness + grace window

**Files:**
- Modify: `electron/quitWatcher.ts`
- Test: `electron/quitWatcher.test.ts`

**Context:** On Windows the bound `Gw2-64.exe` PID is stable, so the current PID-set model works. On Linux/Proton the launcher re-execs into the game once (~14s in), so the bound PID dies mid-session while the same `-mumble axiam_<id>` tag continues under a new PID. We add an account-liveness path with a grace window so the re-exec isn't read as a quit.

- [ ] **Step 1: Write the failing tests**

Add to `electron/quitWatcher.test.ts`:

```ts
it('linux: fires quit after the grace window of absent liveness polls', () => {
  const events: string[] = [];
  quitWatcher.on('quit', (id: string) => events.push(id));
  let live = new Set(['acc-a']);
  quitWatcher.configure(() => [], 100, () => live);
  quitWatcher.noteLaunch('acc-a', 1000);

  quitWatcher.tick();                 // present
  expect(events).toEqual([]);
  live = new Set<string>();           // account tag gone
  quitWatcher.tick();                 // absent 1 (< grace)
  quitWatcher.tick();                 // absent 2 (< grace)
  expect(events).toEqual([]);
  quitWatcher.tick();                 // absent 3 (== grace) -> fire
  expect(events).toEqual(['acc-a']);
});

it('linux: a one-poll re-exec gap does not fire quit', () => {
  const events: string[] = [];
  quitWatcher.on('quit', (id: string) => events.push(id));
  let live = new Set(['acc-a']);
  quitWatcher.configure(() => [], 100, () => live);
  quitWatcher.noteLaunch('acc-a', 1000);

  quitWatcher.tick();                 // present
  live = new Set<string>();
  quitWatcher.tick();                 // absent 1 (re-exec gap)
  live = new Set(['acc-a']);          // game back under new pid
  quitWatcher.tick();                 // present -> counter resets
  live = new Set<string>();
  quitWatcher.tick();                 // absent 1 again
  quitWatcher.tick();                 // absent 2
  expect(events).toEqual([]);         // never reached grace
});

it('linux: noteStop drops the binding without waiting out the grace window', () => {
  const events: string[] = [];
  quitWatcher.on('quit', (id: string) => events.push(id));
  const live = new Set(['acc-a']);
  quitWatcher.configure(() => [], 100, () => live);
  quitWatcher.noteLaunch('acc-a', 1000);
  quitWatcher.tick();
  quitWatcher.noteStop('acc-a');
  live.delete('acc-a');
  quitWatcher.tick();
  quitWatcher.tick();
  quitWatcher.tick();
  expect(events).toEqual([]);
});
```

Reset between tests already happens via the existing `beforeEach` (`__resetForTests()` + `removeAllListeners('quit')`). Confirm `__resetForTests` also clears the new `absentPolls` map (Step 3 adds that).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --maxWorkers=2 electron/quitWatcher.test.ts`
Expected: FAIL — `configure` ignores the third arg; no grace logic.

- [ ] **Step 3: Implement liveness mode + grace window**

Rewrite `electron/quitWatcher.ts`:

```ts
import { EventEmitter } from 'events';

export type PidPoller = () => number[];
export type AccountLivenessPoller = () => Set<string>;

const QUIT_GRACE_POLLS = 3;

class QuitWatcher extends EventEmitter {
  private bindings = new Map<string, number>();
  private absentPolls = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private poller: PidPoller = () => [];
  private livenessPoller: AccountLivenessPoller | null = null;
  private intervalMs = 2000;

  configure(
    poller: PidPoller,
    intervalMs: number,
    livenessPoller?: AccountLivenessPoller,
  ): void {
    this.poller = poller;
    this.intervalMs = intervalMs;
    this.livenessPoller = livenessPoller ?? null;
  }

  start(): void {
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
    this.absentPolls.delete(accountId);
  }

  noteStop(accountId: string): void {
    this.bindings.delete(accountId);
    this.absentPolls.delete(accountId);
  }

  tick(): void {
    if (this.livenessPoller) {
      const live = this.livenessPoller();
      for (const accountId of Array.from(this.bindings.keys())) {
        if (live.has(accountId)) {
          this.absentPolls.delete(accountId);
          continue;
        }
        const absent = (this.absentPolls.get(accountId) ?? 0) + 1;
        if (absent >= QUIT_GRACE_POLLS) {
          this.bindings.delete(accountId);
          this.absentPolls.delete(accountId);
          this.emit('quit', accountId);
        } else {
          this.absentPolls.set(accountId, absent);
        }
      }
      return;
    }

    const livePids = new Set(this.poller());
    for (const [accountId, pid] of Array.from(this.bindings.entries())) {
      if (!livePids.has(pid)) {
        this.bindings.delete(accountId);
        this.emit('quit', accountId);
      }
    }
  }

  __resetForTests(): void {
    this.stop();
    this.bindings.clear();
    this.absentPolls.clear();
    this.livenessPoller = null;
  }
}

export const quitWatcher = new QuitWatcher();
```

Note: `start()` no longer early-returns on non-win32 — the platform decision now lives in how `main.ts` configures it (PID poller on Windows, liveness poller on Linux).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 electron/quitWatcher.test.ts`
Expected: PASS — new Linux tests green, existing Windows PID tests still green (they call `configure(poller, ms)` with no liveness poller, so `tick()` uses the PID path unchanged).

- [ ] **Step 5: Commit**

```bash
git add electron/quitWatcher.ts electron/quitWatcher.test.ts
git commit -m "feat(quit-watcher): linux mumble-liveness quit detection with grace window

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the Linux liveness poller + drop the snapshot-back guard

**Files:**
- Modify: `electron/main.ts` — `quitWatcher.configure(...)` (line 1442) and the quit handler's snapshot-back guard (lines 1462-1466)

**Context:** Provide the account-liveness poller on Linux (derived from `getActiveAccountProcesses()`, which already matches the `-mumble` tag). Then ensure the snapshot-back runs on Linux — it currently returns early only for the Windows DLL-redirect mode, which is fine; verify no other guard blocks Linux. The `snapshotHostToAccount` call now resolves the Linux host path via Task 3.

- [ ] **Step 1: Pass the liveness poller to configure**

Replace line 1442:

```ts
  quitWatcher.configure(() => getAllRunningGw2Pids(), QUIT_WATCHER_POLL_INTERVAL_MS);
```

with:

```ts
  quitWatcher.configure(
    () => getAllRunningGw2Pids(),
    QUIT_WATCHER_POLL_INTERVAL_MS,
    process.platform === 'win32'
      ? undefined
      : () => new Set(getActiveAccountProcesses().map((p) => p.accountId)),
  );
```

- [ ] **Step 2: Verify the snapshot-back path is reachable on Linux**

In the `quitWatcher.on('quit', ...)` handler (lines 1443-1497), confirm the only early returns are: win32+DLL-redirect (line 1463), junction mode (1469), other-GW2-running (1475), and fresh-account-<15s (1483-1488). None of these block a normal Linux sequential quit. No code change needed here beyond confirming — the `snapshotHostToAccount(accountId)` call at line 1491 now works on Linux because `getHostLocalDatPath()` resolves the Proton prefix (Task 3). Add a one-line comment above line 1463 noting the DLL-redirect guard is Windows-only by construction.

- [ ] **Step 3: Typecheck + full electron test run**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no type errors.
Run: `npx vitest run --maxWorkers=2 electron/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(launch): snapshot Local.dat back on Linux via mumble-liveness quit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Manual verification on real Linux/Steam

**Files:** none (manual). This is the only path that exercises the real Proton prefix layout — no CI covers it.

- [ ] **Step 1: Build and run the app**

Run the project's dev/build command (check `package.json` scripts, e.g. `npm run dev` or build the AppImage). Confirm the app starts.

- [ ] **Step 2: Two-account credential isolation**

1. Ensure two accounts exist in AxiAM.
2. Launch account **Main** → log in → **fully quit** GW2. Confirm in `~/.config/axiam/logs/main.log` a line `[snapshot] account=<Main id> copied Local.dat host → profile`, and that `~/.config/axiam/profiles/<Main id>/Guild Wars 2/Local.dat` mtime is now current.
3. Launch account **Alt** → confirm the login pre-fills **Alt's** credentials (not Main's) / lands on Alt's character. Log in → quit.
4. Launch **Main** again → confirm it pre-fills Main's credentials and Main's last character.

- [ ] **Step 3: Clear-and-resave regression (the original bug)**

1. Clear the saved login for an account.
2. Launch it (should go without `-autologin`), log in, quit.
3. Confirm the "Saved" badge returns and a fresh profile `Local.dat` was written. This is the bug the user reported ("clearing login and re-logging in doesn't save anymore").

- [ ] **Step 4: Fresh-prefix fallback**

If feasible (e.g. GW2 never run through Steam yet), confirm a launch logs `[install] account=X compatdata not found; launching without -autologin` and does not crash.

- [ ] **Step 5: Quit-state correctness**

Confirm that after fully quitting GW2, the account card transitions to **Stopped** (previously it stayed Running forever on Linux).

---

## Self-Review Notes

- **Spec coverage:** Install side → Tasks 1-4; host path + `HostUnavailableError` → Task 3; snapshot-back trigger (the revision) → Tasks 5-6; edge cases E1 (host-unavailable fallback) → Task 4 Step 1, E10 (re-exec grace) → Task 5; testing/manual → Task 7. All spec sections mapped.
- **Type consistency:** `resolveGw2CompatDataDir(steamLibraryPaths, fs?)`, `HostUnavailableError`, reason string `'host-unavailable'`, `configure(poller, intervalMs, livenessPoller?)`, `QUIT_GRACE_POLLS = 3`, liveness poller returns `Set<string>` of accountIds — used consistently across Tasks 1, 3, 4, 5, 6.
- **No placeholders:** every code step shows the full code; commands include expected output.

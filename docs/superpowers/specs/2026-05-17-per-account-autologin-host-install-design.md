# Per-account autologin via host-path install + serialized launches

**Date:** 2026-05-17
**Status:** Approved design, ready for implementation plan.

## Problem

v1.1.14-take-1 (now merged to `main`, never released) tried to give each AxiAM-managed Guild Wars 2 account its own AppData by spawning each `Gw2-64.exe` with an `APPDATA` env var pointing at a per-account profile directory. Manual testing on a real Windows install (m0mentkill3r, 2026-05-18) confirmed the approach is **structurally broken**: GW2 honors the env var for *some* writes (per-account `Local.dat` files do get created) but resolves the credential read/write path via `SHGetFolderPath(CSIDL_APPDATA)` from the registry, which is independent of the process env. The result: per-account `Local.dat` files exist on disk but `-autologin` never picks them up, even after a clean credential save with "Remember Me" checked.

Latest stable release for users is still v1.1.13 (autologin-on-first-instance-only). The broken APPDATA code sits on `main` but no release was cut from it; `v1.1.14-beta.1` is on GitHub as a prerelease and not auto-distributed.

## Goals

- Per-account `-autologin` works on Windows for *every* concurrent GW2 instance, not just the first.
- Per-account graphics/UI settings persist across single-instance sessions.
- Existing v1.1.13 saved logins continue to work through the upgrade (already covered by the merged migration).
- "Save Login" button stays gone; credential persistence is automatic.

## Non-goals

- Linux per-prefix isolation. Linux multi-instance is parked under v1.1.12's open follow-up; the new mechanism is Windows-only.
- Per-account settings persistence in *multi-instance* sessions. With one shared host `Local.dat`, concurrent writes from two GW2 processes would cross-contaminate. We accept "settings persisted only when no other GW2 is running on quit" as the trade-off (matches Gw2Launcher behavior).
- Restoring the v1.1.13 explicit Save Login button. The new flow auto-snapshots on quit when safe.

## Architecture

Replace "redirect AppData via env var" with **install the right `Local.dat` at the host path before each launch + snapshot it back when GW2 quits**. Concurrent launches serialize through a launch mutex so the next account's snapshot install doesn't overwrite the host file before the previous account's GW2 has read it.

```
Per-account snapshot:
  userData/profiles/<accountId>/Guild Wars 2/Local.dat
                                      │
       ┌──────────────────────────────┼──────────────────────────┐
       │ pre-launch                    │ post-quit (single-instance only)
       │ copy                          │ copy
       ▼                               ▼
  %APPDATA%\Guild Wars 2\Local.dat (host)
       │
       └──→ GW2 reads on startup, writes during play & on quit
```

**Boundaries:**

- **`localDat` module:** owns where snapshots live + the read/write of the host path. Same `userData/profiles/<id>/Guild Wars 2/Local.dat` storage layout already merged. Adds `installSnapshotToHost`, `snapshotHostToAccount`, internal `getHostLocalDatPath`.
- **`launchSerializer` (new tiny module):** single async mutex with a FIFO queue. Each launch acquires before its install + spawn + dwell, releases after.
- **`quitWatcher` (new module):** polls `Gw2-64.exe` PIDs; fires a `'quit'` event when a tracked PID disappears so the main process can run `snapshotHostToAccount`.
- **Launch flow in `main.ts`:** orchestrates the new sequence (serializer acquire → install → mutex-close → spawn → wait → dwell → release → noteLaunch).

Windows-only behaviorally. Linux untouched (Linux branch skips the install/dwell/snapshot steps entirely).

## Storage layout — what changes vs current `main`

Storage layout is **unchanged from current `main`**. The v1.1.14-take-1 merge already moved v1.1.13's `userData/local-dat/<id>.dat` snapshots into `userData/profiles/<id>/Guild Wars 2/Local.dat`. Those files are now treated as **source snapshots to copy from**, not as a redirected AppData target.

`electron/localDat.ts` deltas vs current `main`:

| Function | Status |
|---|---|
| `getAccountAppDataDir(accountId)` | **Remove.** No more env-var redirect. |
| `getAccountLocalDatPath(accountId)` | Keep, unchanged. Still resolves to `userData/profiles/<id>/Guild Wars 2/Local.dat`. |
| `hasLocalDat(accountId)` | Keep, unchanged. |
| `deleteLocalDat(accountId)` | Keep, unchanged. |
| `migrateLegacyLocalDat` + `MigrationFs` + `MigrationResult` | Keep, unchanged. |
| `getHostLocalDatPath()` | **New (internal).** Single source of truth for `path.join(process.env.APPDATA, 'Guild Wars 2', 'Local.dat')`. |
| `installSnapshotToHost(accountId)` | **New.** Copies the account's snapshot over the host `Local.dat`. Creates host `Guild Wars 2/` directory if missing. Returns `{ ok: boolean, reason?: string }`. Caller is expected to gate on `hasLocalDat(accountId)` first; calling without a snapshot returns `{ ok: false, reason: 'no-snapshot' }` defensively. |
| `snapshotHostToAccount(accountId)` | **New.** Copies host `Local.dat` back into the account's profile dir. Creates intermediate dirs if needed. Returns `{ ok: boolean, reason?: string }`. `{ ok: false, reason: 'no-host-file' }` if host file doesn't exist (rare; warrants a warning log). |

**On disk after upgrade:** existing per-account `userData/profiles/<id>/Guild Wars 2/Local.dat` files (from the v1.1.14-take-1 migration that already ran on the prerelease) remain in place and serve as the canonical per-account snapshots. The host `%APPDATA%\Guild Wars 2\Local.dat` is now mutated by AxiAM on every launch; users launching GW2 directly outside AxiAM see whichever account's credentials AxiAM last installed. Acceptable trade-off — matches Gw2Launcher — worth one line in release notes.

## Launch flow rewrite

The `launch-account` IPC handler grows the serializer wrapper, replaces the env injection with install + retry, and adds a dwell after process detection:

```
0. await launchSerializer.acquire()
1. (existing) multi-instance gate + mutex-close
2. (existing) gw2Path resolution / auto-locate
3. (existing) args construction (-mumble, -autologin if hasLocalDat, user args)

4. NEW: install snapshot when account has a saved login
   • If !hasLocalDat(account.id): skip the install step entirely; -autologin was already
     omitted from args in step 3.
   • Else: call installSnapshotToHost(account.id) with retry — 200ms intervals up to
     3 seconds on transient failure (EBUSY/EACCES/EPERM).
   • Log [install] account=<id> installed snapshot to host path on success.
   • If retry exhausted: log warning, drop -autologin from args, proceed without autologin.

5. (existing) preLaunch PID snapshot
6. Spawn Gw2-64.exe — NO env override anymore (revert to default inherited env)
7. (existing) waitForAccountProcess + manualAccountPidBindings

8. NEW: dwell — await sleep(LAUNCH_DWELL_AFTER_DETECTED_MS = 4000)
   • Gives GW2 time to actually read Local.dat before the next launch can install over it.

9. launchSerializer.release()
10. quitWatcher.noteLaunch(account.id, boundPid)   (on success only)
```

If the launch state machine transitions to `stopping`/`stopped` while a queued launch is waiting on the serializer, the launch bails after `acquire()` returns and skips the install + spawn entirely.

**Why drop `-autologin` on persistent install failure rather than fail the launch:** we'd rather show a manual login screen than hard-fail. The launch mutex makes the failure path extremely unlikely in normal use; this is defense-in-depth for stale-lock and concurrent-external-launch corner cases.

**Linux branch:** untouched. `installSnapshotToHost`, the dwell, the snapshot-back, and `quitWatcher` are all gated to `process.platform === 'win32'`. Linux still calls `launchViaSteam(args)` with no host-side file manipulation.

## Launch serialization

New `electron/launchSerializer.ts` — single-slot async mutex with a FIFO queue. ~30 lines. Uses a promise-chain:

```ts
let chain: Promise<void> = Promise.resolve();

export function acquire(): Promise<() => void> {
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => { release = resolve; });
  const waitFor = chain;
  chain = next;
  return waitFor.then(() => release);
}
```

The launch handler wraps itself with `acquire()` / `release()`. Uncontended `acquire()` resolves immediately (the chain head is already a resolved promise) — zero overhead on the common single-launch path. Queued acquires resolve in FIFO order, so launches stay in click order.

**Why a global serializer rather than per-account:** two different accounts launching in parallel would still race on the single host `Local.dat`, so per-account parallelism buys nothing. One queue is simpler and correct.

**Stop responsiveness:** the `stop-account-process` handler is *not* serializer-wrapped. Stops always execute immediately regardless of queue state. The cancellation check inside `doLaunch(id)` (right after `acquire`) handles the "user clicked Stop on a queued launch" case by skipping the rest of the launch.

**Renderer-side timeout:** `src/App.tsx` already uses `withTimeout(window.api.launchAccount(id), 60_000, …)`. 60 seconds is enough for a 3-deep queue (each slot ~5s install+spawn+dwell). No renderer changes needed.

## Quit detection and auto-snapshot

New `electron/quitWatcher.ts` — periodic PID poll on a 2-second interval. Tracks bindings of `accountId → pid`. When a tracked PID disappears from the system process table, emits `'quit'` with `accountId` and drops the binding.

**Public API:**

- `start()` — sets up the interval (Windows only; Linux no-op). Called once at `app.on('ready')` after the migration block.
- `stop()` — clears the interval. Called at `app.on('before-quit')`.
- `noteLaunch(accountId, pid)` — records a tracked binding. Called from the launch handler step 10.
- `noteStop(accountId)` — drops the binding silently *without* firing `'quit'`. Called from `stop-account-process` IPC handler so explicit stops don't trigger a snapshot of potentially-broken state.
- `EventEmitter` emitting `'quit'` events.

The `quit` handler in `main.ts`:

```ts
quitWatcher.on('quit', (accountId) => {
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
```

**Tracked PID source:** whichever PID was bound by detection (either via mumble-name match or the elevation-blackout fallback `manualAccountPidBindings`). If detection failed entirely (timeout, `launched=false`), no binding gets recorded and no quit event fires — fine.

**Edge cases:**

- *AxiAM quits while GW2 runs:* no copy-back happens. Host Local.dat stays as GW2 left it. Next AxiAM launch will install the requested account's snapshot, autologin works, but settings from the orphaned session are lost.
- *GW2 crashes:* same as a normal quit from the watcher's perspective — process disappears, watcher fires, copy-back proceeds if no other GW2 is running.
- *Two accounts quit simultaneously:* race on `getAllRunningGw2Pids` — the first quit event might see 1 remaining (the other quitting account, briefly still alive), skip copy-back; the second event sees 0, copies back into the second account's slot. Worst-case data: the first quitter loses its session settings. Acceptable.

## Surface delta from current `main`

**Keep as-is:**

- `userData/profiles/<accountId>/` storage layout
- `getAccountLocalDatPath`, `hasLocalDat`, `deleteLocalDat`, `migrateLegacyLocalDat`, types
- Startup migration block
- `delete-account` profile-dir cleanup
- Removed Save Login button + auto-save useEffect (still gone)
- `electron/localDat.test.ts` migration tests

**Remove:**

- `getAccountAppDataDir` from `localDat.ts` and its single import in `main.ts`
- The `getAccountAppDataDir(account.id)` call in `launch-account`
- The `[profile] account=<id> APPDATA=<path>` log line
- The `env: { ...process.env, APPDATA: accountAppDataDir }` spawn option (revert to inherit-parent-env)

**Add:**

- `localDat.ts`: `installSnapshotToHost`, `snapshotHostToAccount`, internal `getHostLocalDatPath`
- `localDat.test.ts`: tests for both new functions (extends existing file)
- `electron/launchSerializer.ts` + `electron/launchSerializer.test.ts`
- `electron/quitWatcher.ts` + `electron/quitWatcher.test.ts`

**Modify in `electron/main.ts`:**

- Import additions / removals per above
- `launch-account` handler: wrap in serializer; install instead of env-inject; dwell after detection; noteLaunch on success; cancellation check after acquire
- `stop-account-process` handler: call `quitWatcher.noteStop(accountId)` before terminating
- `app.on('ready')`: call `quitWatcher.start()` after migration
- `app.on('before-quit')`: call `quitWatcher.stop()`
- Register `quitWatcher.on('quit', …)` listener at startup

**No changes:** `mutexCloser`, `tools/mutex-closer/**`, `preload.cts`, `types.ts`, any UI file.

**New constants in `main.ts`:**

```ts
const LAUNCH_DWELL_AFTER_DETECTED_MS = 4000;
const INSTALL_RETRY_TOTAL_MS = 3000;
const INSTALL_RETRY_INTERVAL_MS = 200;
const QUIT_WATCHER_POLL_INTERVAL_MS = 2000;
```

## Testing

**Vitest unit tests** (Windows-platform-independent — same injectable-filesystem / fake-poller pattern as `mutexCloser.test.ts`):

- `installSnapshotToHost`: defensive no-snapshot return path, success path, copy-failure path, creates host dir if missing.
- `snapshotHostToAccount`: no-host-file return path, success path, creates intermediate dirs if missing, copy-failure path.
- `launchSerializer`: uncontended immediate resolve, FIFO order under contention, idempotent release.
- `quitWatcher`: tracked PID disappears → single `quit` event, `noteStop` drops binding silently, still-running PID → no event, multiple accounts tracked simultaneously with only the gone one firing, consecutive ticks after gone → only first fires.

**Manual verification on Windows:**

1. Upgrade from v1.1.13: existing saved login still autologins after install of v1.1.14.
2. Fresh account single-instance lifecycle: add account → launch → manual login + Remember Me + reach character select → change a graphics setting → quit normally → verify per-account snapshot mtime updated → relaunch autologs in with settings preserved.
3. Two concurrent accounts: with multi-instance ON, launch A then B; both autologin to the right account; main.log shows `[install] account=<A>` then `[install] account=<B>` separated by ≥4 s; quit B → log shows "skipping copy-back" (A still running); quit A → log shows copy-back succeeded; relaunch A → autologin and settings from the last single-instance A session preserved (not corrupted by the multi-instance run).
4. Stop-while-queued: launch A → immediately click Launch on B → immediately click Stop on B before A's 4 s dwell completes → B never actually spawns.
5. External GW2 users: running GW2 outside AxiAM uses whichever account's credentials AxiAM last installed. Documented behavior, not a bug.

No automated tests against a real GW2 install.

## Out of scope / future work

- Linux per-prefix isolation (parked under v1.1.12 follow-up).
- Per-account settings persistence in multi-instance sessions (would need OS-level file isolation; not viable without WinFsp or similar).
- Watching Local.dat mtime for read-completion detection instead of fixed dwell (would let us tighten the 4 s wait; deferred unless users complain about latency).
- Restoring user's original `%APPDATA%\Guild Wars 2\Local.dat` on AxiAM uninstall (would require a tracked backup of the pre-AxiAM state).

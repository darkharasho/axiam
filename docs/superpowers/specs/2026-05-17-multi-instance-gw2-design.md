# Multi-instance GW2 launch support

**Date:** 2026-05-17
**Status:** Approved design, ready for implementation plan.

## Problem

Guild Wars 2 enforces a single-instance lock via a named kernel mutex (`AN-Mutex-Window-Guild Wars 2`). Any second `Gw2-64.exe` that starts while this mutex exists exits silently. AxiAM's `-shareArchive` support solved the `.dat` file lock but did not address the mutex, so launching a second account currently fails: the spawn succeeds, the new process exits immediately, and AxiAM eventually surfaces a generic "failed to launch account" timeout. Users running tools like Gw2Launcher are accustomed to multi-boxing working — AxiAM should reach parity.

## Goals

- Launch multiple `Gw2-64.exe` instances simultaneously on Windows.
- Same capability on Linux (via Steam Proton) using the same helper binary executed under Wine.
- Gate the feature behind an explicit, off-by-default setting so users opt in knowingly.
- Fail fast with a clear error when the mutex-closing step can't run, instead of degrading into a 90-second detection timeout.

## Non-goals

- No per-account toggle for v1.
- No automatic upgrade for users who already have multiple instances running — the gate applies at launch time only; existing processes are not affected when the setting changes.
- No native (Linux-only) mutex-closing path. The wineserver kernel objects live inside Wine; the same Windows .exe running under Wine reaches them, so no separate Linux implementation is needed.
- No CI step to rebuild the helper from source for v1.

## Architecture

```
┌──────────────────────────┐
│   Electron Main (Node)   │
│                          │
│  launch-account IPC:     │
│   1. snapshot pids       │
│   2. existing GW2? ──────┼──► spawn helper.exe ──► closes mutex
│   3. spawn Gw2-64.exe    │     (Windows: direct;
│   4. detect/bind         │      Linux:   proton run helper.exe)
└──────────────────────────┘
```

A single Rust binary (`axiam-mutex-closer.exe`) ships in `extraResources`. The Electron main process invokes it as a child process when launching a GW2 instance while another is already running, gated on a new `allowMultiInstance` setting. The helper has no knowledge of Electron, accounts, or launching — it only walks the kernel handle table and closes a named mutex by process name. The renderer never sees the helper; it only sees the new setting toggle and any error messages surfaced through the existing launch state machine.

## The helper binary

**Crate location:** `tools/mutex-closer/` in the repo. Independent `Cargo.toml`.

**CLI:**

```
axiam-mutex-closer.exe \
  --process-name "Gw2-64.exe" \
  --mutex-name "AN-Mutex-Window-Guild Wars 2" \
  [--pid <N>] \
  [--json]
```

**Behavior:**

1. Enumerate processes (`CreateToolhelp32Snapshot` or `NtQuerySystemInformation`); filter to ones matching `--process-name`, or just use `--pid` if given.
2. For each target, `OpenProcess(PROCESS_DUP_HANDLE | PROCESS_QUERY_INFORMATION, …)`.
3. `NtQuerySystemInformation(SystemHandleInformation)` to enumerate all handles; filter to ones owned by the target PIDs and of type `Mutant`.
4. For each candidate: duplicate the handle into the helper process so `NtQueryObject` can read its name. If the name matches `--mutex-name`, close the duplicate, then call `DuplicateHandle(target, handle, NULL, NULL, 0, FALSE, DUPLICATE_CLOSE_SOURCE)` to close it in the source.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | At least one matching mutex was closed |
| 2 | Target processes found but no matching mutex |
| 3 | No matching target processes found |
| 4 | A Win32 call failed (details on stderr) |

**Dependencies:** only the `windows-sys` crate. No async runtime, no logging framework. Single statically-linked binary, expected ~80–120 KB.

**Build:**

- Local: `cargo build --release --target x86_64-pc-windows-gnu`.
- Output committed to `build/win/axiam-mutex-closer.exe` so CI does not require a Rust toolchain.
- A `tools/mutex-closer/README.md` documents the rebuild command.

## Settings & UX

**New setting:** `allowMultiInstance: boolean` added to the existing `settings` store. Default `false`.

**UI placement:** the existing `Settings` page, in an "Experimental" or "Advanced" section near the bottom. Match existing visual conventions.

**Labelling:**

> **Allow multiple GW2 instances**
> *Lets AxiAM launch more than one Guild Wars 2 client at a time by closing the game's single-instance lock. Multi-boxing is tolerated by ArenaNet but not officially supported — use at your own risk.*

**First-time confirm:** when the user flips the toggle on, show a one-shot modal:

> Enabling multi-instance launches involves closing a kernel object inside the running GW2 process. This is the same technique used by Gw2Launcher and similar tools, but isn't endorsed by ArenaNet. Continue?
>
> [ Cancel ] [ Enable ]

Persist `allowMultiInstance: true` only after the user clicks Enable. Don't show the modal again unless the user toggles off and back on.

**Where the setting is read:** main process only, inside `launch-account`. The renderer doesn't branch on it.

## Launch flow integration

The existing `launch-account` IPC handler grows one new step between path resolution and spawn:

```ts
const settings = store.get('settings');
const existingPids = getAllRunningGw2Pids();

if (existingPids.length > 0) {
  if (!settings?.allowMultiInstance) {
    launchStateMachine.setState(id, 'errored', 'verified',
      'Another GW2 instance is running. Enable "Allow multiple GW2 instances" in Settings to launch alongside it.');
    return false;
  }
  const result = await runMutexCloser(existingPids);
  if (!result.ok) {
    logMainError('launch', `Mutex closer failed: ${result.reason}`);
    launchStateMachine.setState(id, 'errored', 'verified',
      `Couldn't prepare GW2 for multi-instance launch: ${result.reason}`);
    return false;
  }
  logMain('launch', `[mutex] Closed AN-Mutex on ${result.closedCount} existing GW2 process(es)`);
}
```

`runMutexCloser(pids)` returns `{ ok: boolean, closedCount: number, reason?: string }`.

**Windows invocation:**

```ts
const helperPath = path.join(process.resourcesPath, 'mutex-closer', 'axiam-mutex-closer.exe');
const result = spawnSync(helperPath,
  ['--process-name', 'Gw2-64.exe', '--json'],
  { encoding: 'utf8', timeout: 5000 });
```

Result mapping by helper exit code:

- `0` → `{ ok: true, closedCount: <from json stdout> }`
- `2` → `{ ok: true, closedCount: 0 }` (no mutex found; spawn anyway — could happen if a previous run already closed it)
- `3` → `{ ok: true, closedCount: 0 }` (no target processes — but caller already checked existingPids > 0, so this is unexpected; log a warning and proceed)
- `4` → `{ ok: false, reason: <stderr> }`
- Non-zero exit or timeout → `{ ok: false, reason: 'helper exited with status N' }`

**Linux invocation:** the same helper, wrapped through Proton:

1. Read `compatdata/1284210/config_info` to discover the Proton tool path. Fall back to scanning `compatibilitytools.d/` and `steamapps/common/Proton -*` for the newest available installation.
2. Build env: `STEAM_COMPAT_DATA_PATH=<library>/steamapps/compatdata/1284210`, `STEAM_COMPAT_CLIENT_INSTALL_PATH=$HOME/.local/share/Steam`.
3. `spawnSync(protonPath, ['run', helperPath, ...args], { env, timeout: 15000 })` — longer timeout for Wine cold-start.

The mutex helper binary is identical on both platforms; only the spawn wrapper differs.

**State machine impact:** purely additive. The new errored state from the gate or helper failure short-circuits before `launch_requested`, so the UI shows a precise reason instead of a generic timeout.

**Detection path unchanged.** The PID-binding fallback for WMI elevation blackout (committed in `edbe5eb`) continues to apply after spawn. It addresses a different failure mode and is orthogonal to mutex handling.

## Packaging

**Repository layout:**

```
axiam/
├── build/
│   └── win/
│       └── axiam-mutex-closer.exe    # prebuilt, committed
├── tools/
│   └── mutex-closer/
│       ├── Cargo.toml
│       ├── README.md
│       └── src/
│           └── main.rs
```

**electron-builder addition** in `package.json` under `build`:

```json
"extraResources": [
  {
    "from": "build/win/axiam-mutex-closer.exe",
    "to": "mutex-closer/axiam-mutex-closer.exe"
  }
]
```

Resolves at runtime via `path.join(process.resourcesPath, 'mutex-closer', 'axiam-mutex-closer.exe')` on both Windows and Linux. The Windows .exe ships inside the Linux AppImage on purpose — it runs under Wine.

**Build size impact:** ~100 KB added to both Windows installer and Linux AppImage.

**Source control:** prebuilt `.exe` committed plain (not via Git LFS) at this size. Reassess if it grows. The `tools/mutex-closer/target/` directory is in `.gitignore`.

**No CI changes for v1.** Whoever changes the Rust source rebuilds locally and commits the updated `.exe`. An `npm run build:mutex-closer` script wraps the cargo invocation. A reproducibility check (CI rebuilds from source and diffs) can be added later.

## Testing

**Helper binary** (`tools/mutex-closer/`):

- `tests/integration.rs`: spawn a long-running dummy Windows process holding a known-named mutex, run the helper, verify exit 0 and the mutex is gone. Runs on Windows in `cargo test`; skipped on non-Windows hosts.
- Pure-logic units (handle-table parsing, name matching) get plain `#[test]` coverage that runs everywhere.

**Electron side:**

- Refactor `runMutexCloser` and `runUnderProton` so they take a `spawnSync`-shaped dependency, allowing unit tests to inject a fake and verify exit-code → result-object mapping.
- No automated end-to-end against a real GW2 client.

**Manual verification checklist** in `tools/mutex-closer/README.md`:

1. Toggle Setting off. Launch account A → success. Launch account B → AxiAM blocks with "Another GW2 instance is running…" message.
2. Toggle Setting on. Launch account A → success. Launch account B → both `Gw2-64.exe` appear in Task Manager, both accounts show as running in AxiAM.
3. Move/rename the bundled helper binary; launch account B → fail-fast with "Couldn't prepare GW2…" error citing the missing helper.
4. Same three steps on Linux/Proton with the same Steam install — verify Proton wrap works.
5. Toggle Setting off while two instances are running — existing instances keep running, but launching a third is blocked.

## Open questions

None at design time. Implementation plan should surface concrete sub-tasks (Rust crate scaffolding, electron-builder config, settings UI, IPC wiring) and ordering.

## Out of scope / future work

- Per-account `allowMultiInstance` override.
- CI-side rebuild + diff of the prebuilt helper binary.
- Detecting and surfacing whether mutex-closing succeeded for *some but not all* existing instances (the v1 mapping treats partial success as success; failure is binary).
- Automated end-to-end tests against a real GW2 install.

# Per-account `Local.dat` via DLL injection (take-4)

**Date:** 2026-05-19
**Status:** Approved 2026-05-19. Risks #1 (TOS) and #5 (Procmon verification of NtCreateFile path) remain open and must be resolved before external beta — see "Risks and open questions" below.
**Supersedes (for the credential-file part):** take-2 (Local.dat install-to-host), take-3 (NTFS junction).

## Problem

After take-2 (host install) and take-3 (junction), concurrent multi-instance per-account credentials still fail. Both approaches isolate the *entire* `%APPDATA%\Guild Wars 2\` directory per account, which breaks GW2's launcher: the second instance's update check sees an empty/different appdata and dies with **"Download failed (5)"**. Verified on Windows 2026-05-18 with `-shareArchive` set and a 20s pre-spawn dwell — neither helps.

The structural conflict: GW2 needs *shared* appdata for the launcher's update check and `-shareArchive` archive coordination, but *per-process* `Local.dat` for per-account credentials. No path-level isolation strategy can deliver both.

## Goal restated

Per-account credentials for every AxiAM-launched GW2 instance, including concurrent multi-instance. User quote (2026-05-18):

> "I care most that it saves the credentials per account. Clicking the launch button is fine as long as AxiAM handles the user's credentials through the local.dat."

`-autologin` does not auto-submit on current clients (memory `axiam-autologin-flag-broken`), so the deliverable is per-account *pre-fill*, not bypass.

## Architecture

Inject a small DLL into each `Gw2-64.exe` at spawn time. The DLL hooks one file-system API and redirects exactly one path — `%APPDATA%\Guild Wars 2\Local.dat` — to a per-account file. Everything else (`GFXSettings.*.xml`, `Gw2.dat`, `Tmp/`, archive shared with `-shareArchive`) passes through to the real shared appdata.

```
process A (Main)                          process B (Alt)
  Gw2-64.exe + injected DLL                Gw2-64.exe + injected DLL
    open("%APPDATA%\Guild Wars 2\Local.dat")
       │ DLL hook intercepts                  │
       ▼ rewrites to                          ▼ rewrites to
    profiles\Main\Local.dat                profiles\Alt\Local.dat
    open("%APPDATA%\Guild Wars 2\Gw2.dat")
       │ DLL hook sees, passes through       │
       ▼                                      ▼
    %APPDATA%\Guild Wars 2\Gw2.dat  ◄── shared ──┘
```

No appdata isolation → launcher's update check sees the appdata it expects → no "Download failed (5)".
Per-process `Local.dat` redirect → no file-lock contention → concurrent multi-instance works.

### Why this isn't take-3 in a trenchcoat

Take-3 isolates the whole directory by re-pointing the junction. Take-4 isolates exactly one file by hooking inside the process. The launcher, archive cache, settings, and update check all still see the real shared appdata.

## Language and build

**Rust `cdylib`** in `tools/local-dat-redirect/`. Matches the existing `tools/mutex-closer/` helper (the EOD handoff incorrectly called that one "C++ / CMake/MSVC" — it's Rust + `windows-sys`). One toolchain to maintain, same `cargo` build invocation we already use.

Crates:
- `windows-sys` — NT/Win32 bindings (already a project dependency)
- `retour` (or `minhook-sys`) — inline hooking with a safe trampoline API. `retour` is pure Rust; `minhook-sys` is FFI to the well-trodden MinHook C library. Default to `retour`; fall back to `minhook-sys` if `retour` proves unstable for `NtCreateFile`.

Output: `axiam-local-dat-redirect.dll` (x64 only — `Gw2-64.exe` is 64-bit; legacy `Gw2.exe` 32-bit is out of scope).

## Hook target

**`NtCreateFile`** (and `NtOpenFile`), exported from `ntdll.dll`.

Rationale:
- All file-open paths from user mode funnel through `NtCreateFile` eventually. `CreateFileW`, `fopen`, .NET file APIs — they all bottom out here.
- Hooking `CreateFileW` from `kernel32` would miss any direct NT calls (uncommon but possible) and would need duplicate hooks for `CreateFileA`.
- `OBJECT_ATTRIBUTES` carries the path as a `UNICODE_STRING`, which we can read and rewrite cleanly.

Trade-off accepted: `NtCreateFile`'s signature is more verbose than `CreateFileW` and the path format is NT-native (`\??\C:\Users\...`), so we need to do a small amount of path normalization. Worth it for completeness.

## Injection mechanism

**`CREATE_SUSPENDED` + `CreateRemoteThread(LoadLibraryW)` + `ResumeThread`** from the Electron parent.

Per launch:

```
1. lpEnvironment includes AXIAM_LOCAL_DAT_PATH=<profile dir>\Local.dat
2. CreateProcessW(Gw2-64.exe, ..., CREATE_SUSPENDED | dwCreationFlags, ...)
3. VirtualAllocEx(hProcess, NULL, MAX_PATH*2, MEM_COMMIT, PAGE_READWRITE)
4. WriteProcessMemory(hProcess, p, dllPathW, len)
5. CreateRemoteThread(hProcess, NULL, 0, LoadLibraryW, p, 0, &tid)
6. WaitForSingleObject(thread, 5000)  // DLL's DllMain installs hook
7. GetExitCodeThread(thread, &hModule)  // non-zero → loaded
8. VirtualFreeEx(hProcess, p, 0, MEM_RELEASE)
9. ResumeThread(mainThread)            // GW2 finally starts; first NtCreateFile is already hooked
```

Pre-resume injection guarantees the hook is installed before GW2's first `NtCreateFile` call, including the read of `Local.dat`. No race.

Per-account configuration handoff: **environment variable `AXIAM_LOCAL_DAT_PATH`**. Set via `lpEnvironment` in `CreateProcessW` so the child inherits exactly what we specify. DLL reads it in `DllMain(DLL_PROCESS_ATTACH)` and caches the resolved redirect path in process-static storage. Simple, no IPC, no shared memory, no command-line surface.

### Why not LoadLibrary inside Node?

Node's `child_process.spawn` doesn't expose `CREATE_SUSPENDED`. We need either:
- A small Rust helper binary (`axiam-injector.exe`) the Electron main process invokes via `child_process.spawn`, which handles all the Win32 dance and writes the launched PID to stdout — pattern already used by `axiam-mutex-closer`.
- Or a Node native addon. More moving parts; skip unless the helper exe approach proves slow.

**Pick the helper exe.** Build alongside `axiam-mutex-closer` under `tools/`. Output: `axiam-injector.exe`.

## Components and files

### New

- `tools/local-dat-redirect/`
  - `Cargo.toml` — `cdylib`, x64, release LTO. Mirrors `tools/mutex-closer/Cargo.toml`.
  - `src/lib.rs` — `DllMain`, env-var read, hook install/uninstall, NT path normalization.
  - `src/hook.rs` — the `NtCreateFile` detour itself.
  - `src/path.rs` — case-insensitive path match for the redirect target; normalize NT-prefixed paths (`\??\`, `\Device\HarddiskVolumeN\`).
- `tools/injector/`
  - `Cargo.toml` — `bin`, links `windows-sys`.
  - `src/main.rs` — argument parsing, suspended-spawn + remote-load orchestration, prints child PID as JSON. Exit codes mirror `mutex-closer` conventions.
- `electron/dllInjector.ts` — TypeScript wrapper that spawns `axiam-injector.exe` and returns `{ pid, handle? }`. Mirrors `electron/mutexCloser.ts`.
- `electron/dllInjector.test.ts` — vitest unit tests with mocked `child_process.spawn`; assert env var construction, DLL path resolution, error handling for non-zero exit codes.

### Modified

- `electron/main.ts` — `doLaunch`: when `settings.dllRedirectMultiInstance === true`, replace `installSnapshotToHostWithRetry` / `repointJunction` with `dllInjector.spawn(...)`. Keep existing `waitForAccountProcess`, `manualAccountPidBindings`, `quitWatcher.noteLaunch` — the helper returns a real PID we can hand to them. Strip the 4s dwell and the snapshot-back path when the flag is on. Continue auto-injecting `-shareArchive`.
- `electron/types.ts` — add `AppSettings.dllRedirectMultiInstance?: boolean`.
- `package.json` / build scripts — add a `build:native` step that runs `cargo build --release` in both `tools/local-dat-redirect/` and `tools/injector/`, then copies the artifacts into `resources/native/` for electron-builder packaging.
- `electron-builder` config — include `resources/native/*.{dll,exe}` as extra resources, code-signed alongside the main exe.

### Unchanged (kept as fallback under existing flag)

- `electron/junction.ts` + take-3 logic stay in the tree. If DLL injection misbehaves in the wild, users can flip back to junction or to take-2 via existing flags.

## Per-launch sequence (flag on)

```
1. launchSerializer.acquire()
2. cancellation check
3. multi-instance gate + mutex-close (existing)
4. dllInjector.spawn({
     gw2Exe: settings.gw2Path,
     args: [...userArgs, '-shareArchive' if absent, '-autologin' if hasLocalDat, '-mumble', ...],
     env: { ...process.env, AXIAM_LOCAL_DAT_PATH: profileDir + '\\Local.dat' },
     dllPath: resources/native/axiam-local-dat-redirect.dll,
   })  → returns { pid }
5. waitForAccountProcess(pid)
6. quitWatcher.noteLaunch(accountId, pid)
7. release serializer slot
```

No copy, no junction repoint, no dwell, no snapshot-back. The per-account `Local.dat` is the only file GW2 ever reads or writes for credentials, in-place, for the life of that process.

## Validation

### Unit (Node-side)

- `dllInjector.test.ts` — env var assembly, exit-code error mapping, DLL path resolution from `resources/native/`.

### Unit (Rust-side)

- `path.rs` — case-insensitive match, NT-prefix stripping, drive-letter normalization. Pure functions, no Win32 needed.
- `hook.rs` cannot be unit-tested in isolation because it runs in a target process. See harness below.

### Hook harness

A tiny Rust test exe in `tools/local-dat-redirect/tests/harness.rs`:

1. Reads `AXIAM_LOCAL_DAT_PATH` like the real DLL.
2. Loads the DLL via `LoadLibrary`.
3. Calls `CreateFileW("%APPDATA%\\Guild Wars 2\\Local.dat", ...)` and `NtCreateFile` directly with the same path.
4. Asserts the resolved handle is to the redirect path (use `GetFinalPathNameByHandle` to confirm).
5. Calls with a non-matching path and asserts it resolves to the real path.

Run as `cargo test --release` post-build. Catches hook regressions without needing GW2.

### Manual on Windows with real GW2

1. Two accounts (Main, Alt), each with a snapshot from take-2 (already present in m0mentkill3r's and darkharasho's environments).
2. Enable `dllRedirectMultiInstance = true` in `%APPDATA%\AxiAM\config.json`.
3. Restart AxiAM.
4. Launch Main → log in → quit. Verify `profiles/Main/Guild Wars 2/Local.dat` mtime changed and size is sane.
5. Launch Main → wait at character select → without quitting, launch Alt.
6. Verify Alt's login screen pre-fills with **Alt's** email, not Main's.
7. Log in to Alt → both Main and Alt now running concurrently.
8. Quit Alt → verify `profiles/Alt/Guild Wars 2/Local.dat` updated, `profiles/Main/...` untouched.
9. Quit Main → verify `profiles/Main/...` updated.
10. Inspect logs for any `[hook]` error lines.

### EDR / AV smoke

Before sending a beta to m0mentkill3r, run AxiAM on a Windows machine with Defender enabled (default). Confirm no detection. If detection fires, gather the signature name and reconsider strategy (signed DLL, manual-map injection that doesn't trigger `LoadLibrary` heuristics, etc.).

## Rollout

- New flag `dllRedirectMultiInstance` defaults `false` in v1.1.14-beta.3.
- m0mentkill3r runs with it `true` on his Windows box for a full session of multi-instance play.
- On clean confirmation, default `true` in v1.1.14 release. Take-2 and take-3 stay code-resident as fallbacks for v1.1.14; remove in v1.1.15.

## Risks and open questions

1. **TOS.** Gw2Launcher has done DLL injection for years without ArenaNet enforcement. Worth re-checking the current TOS before shipping. **Action:** read TOS pre-beta-3; if injection is explicitly forbidden, halt and reconsider (no good alternative exists for the concurrent multi-instance case as far as we know).
2. **AV / EDR.** `LoadLibrary`-style injection into a non-Microsoft binary is a well-known malware shape. Mitigations: sign the DLL with the same cert as the main app; consider switching to manual-map if Defender heuristics fire on the standard `CreateRemoteThread(LoadLibraryW)` pattern. **Action:** code-signing must be wired up before v1.1.14-beta.3 ships externally.
3. **`NtCreateFile` is undocumented-ish.** Microsoft does export it from `ntdll.dll` and the signature has been stable since NT 4.0, but Microsoft can change kernel32→ntdll routing across Windows versions. **Mitigation:** also hook `NtOpenFile` (same shape). Acceptable risk; thousands of products hook these.
4. **Process initialization races.** `CREATE_SUSPENDED` + remote `LoadLibraryW` is the standard pattern; many AV products inject the same way. The DLL's `DllMain` runs under the loader lock — keep it minimal (just install hooks, no file I/O, no waits).
5. **What if GW2 opens `Local.dat` via something other than `NtCreateFile`?** Memory-mapped via `NtCreateSection`, raw block via `NtFsControlFile`, etc. None plausible for a config-style file, but worth confirming with a one-time Procmon trace of a real GW2 startup. **Action:** capture trace in beta-3 testing; expand hook coverage only if Procmon shows otherwise.
6. **Pre-existing junction.** darkharasho's Windows box still has the take-3 junction in place. The DLL doesn't care — it rewrites the path before the junction is resolved — but during migration off take-3 we should remove the junction so a non-AxiAM GW2 launch (Steam icon, etc.) reads/writes the real path. Add to v1.1.14-beta.3 startup migration: if `dllRedirectMultiInstance=true` and `%APPDATA%\Guild Wars 2\` is a junction, replace it with the real default profile contents.

## Estimated work

~5-7 hours focused:

- Spec (this doc) — done.
- DLL skeleton + path module + harness test — 1.5h.
- `NtCreateFile` hook with `retour` — 1.5h.
- Injector exe — 1h.
- Electron wrapper + tests + flag wiring — 1h.
- Build/packaging integration (electron-builder, code signing) — 1h.
- Manual Windows validation + Procmon trace — 1h.

## Decisions to confirm before implementation

These are flagged inline above but consolidated here for the review pass:

1. **Rust over C++.** Recommend; matches existing helper.
2. **`NtCreateFile` over `CreateFileW`.** Recommend; completeness over simplicity.
3. **Helper exe over Node native addon.** Recommend; matches `mutex-closer` pattern.
4. **Env var over command-line for the redirect path.** Recommend; keeps the injected DLL's interface invisible to GW2's argv parsing.
5. **Default flag off for beta.3, on for release** pending one round of m0mentkill3r confirmation. Recommend.

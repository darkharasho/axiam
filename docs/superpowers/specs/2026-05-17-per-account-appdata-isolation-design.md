# Per-account GW2 AppData isolation

**Date:** 2026-05-17
**Status:** Approved design, ready for implementation plan.

## Problem

After v1.1.13 multi-instance launches work, but only the **first** account autologs in. Each account has its own saved login (`Local.dat`), but they all target the single shared `%APPDATA%\Guild Wars 2\Local.dat` file. When account A is running, GW2 holds that file open exclusively — so AxiAM cannot install account B's credentials over it. v1.1.13 papered over the symptom by catching the `EBUSY` and proceeding without autologin, but the result is half-baked: multi-boxing works only if you're willing to manually log in everywhere after the first.

## Goals

- `-autologin` works for every concurrent account on Windows, not just the first.
- No shared mutable state between concurrent GW2 instances — each instance reads and writes its own `Local.dat`.
- Existing users keep their saved logins through the upgrade.
- The Windows host's actual `%APPDATA%\Guild Wars 2\` is left untouched (users can still run GW2 outside AxiAM normally).

## Non-goals

- Linux per-prefix isolation. Wine/Proton don't honor a host `APPDATA` env var, so the equivalent on Linux would require per-account Wine prefixes — much larger project, parked under the v1.1.12 follow-up.
- Migrating non-AxiAM users' existing system-wide `Local.dat` automatically. The migration step only moves what AxiAM has already saved.
- Sharing settings (e.g. graphics) across accounts. After this change, every account gets its own `Gfx.dat` etc., which is the right default — users who want shared settings can copy files between profile dirs themselves.

## Architecture

Each spawned `Gw2-64.exe` process receives an `APPDATA` environment variable pointing at a per-account profile directory under `userData/`. GW2 resolves `%APPDATA%\Guild Wars 2\Local.dat` against that env var, so each instance reads and writes its own private file. Host AppData is never touched.

```
%APPDATA% (env, per-process)
  └─ Guild Wars 2/
       └─ Local.dat   ←  account's permanent login state
                         (plus Gfx.dat, ClientPort.txt, etc.)

Maps to:  userData/profiles/<accountId>/

  account-a  →  APPDATA=<userData>/profiles/<a>/   →  Local.dat for A
  account-b  →  APPDATA=<userData>/profiles/<b>/   →  Local.dat for B
  account-c  →  APPDATA=<userData>/profiles/<c>/   →  Local.dat for C
```

**Boundaries:**

- **Launch path** owns env injection. Computes the per-account profile dir, ensures it exists, adds `APPDATA=<that path>` to the spawned child's env.
- **`localDat` module** owns where per-account state lives on disk. Same public `hasLocalDat`/`deleteLocalDat` API, different storage layout. `saveLocalDat` and `restoreLocalDat` cease to exist.
- **Migration** runs once at startup. Moves `userData/local-dat/<id>.dat` → `userData/profiles/<id>/Guild Wars 2/Local.dat`. Idempotent.

Windows-only behaviorally. On Linux the `APPDATA` env var is ignored (Wine resolves AppData per-prefix) and the rest of the Linux Local.dat flow is unchanged.

## Per-account profile directory

**Profile root:** `userData/profiles/<accountId>/`. Lazily created on first launch.

**Contents:** whatever GW2 itself writes inside `Guild Wars 2/` — typically `Local.dat`, `Gfx.dat`, `ClientPort.txt`, plus small logs and cache files. AxiAM never pre-populates or post-processes these files. GW2 owns the inner contents; AxiAM owns only the outer directory.

**Module API after rewrite** (`electron/localDat.ts`):

| Function | New behavior |
|----------|--------------|
| `getAccountAppDataDir(accountId)` | **New.** Returns `<userData>/profiles/<accountId>/`. Creates the directory on demand. |
| `hasLocalDat(accountId)` | Returns `fs.existsSync(<that dir>/Guild Wars 2/Local.dat)`. |
| `deleteLocalDat(accountId)` | Removes the entire `<userData>/profiles/<accountId>/` directory recursively. Idempotent. |
| `saveLocalDat` | **Removed.** |
| `restoreLocalDat` | **Removed.** |
| `getLocalDatPath` (host-side resolver) | **Removed.** |
| `getStorageDir` (legacy `local-dat/` accessor) | **Removed.** |
| `getAccountLocalDatPath` (legacy file accessor) | **Removed.** |
| `getGw2DataDirectory` | Kept as-is. Only used by the Linux Local.dat handling now. Renaming for clarity is out of scope for this change; revisit if it becomes a source of confusion. |
| `getSteamLibraryPaths` | Unchanged. |

## Launch-time env var injection

In the `launch-account` IPC handler (`electron/main.ts`), the existing direct-executable spawn call grows one new env var. The full per-account path is computed once and passed to the spawn options:

```ts
const accountAppDataDir = getAccountAppDataDir(account.id);

const spawnEnv = {
  ...process.env,
  APPDATA: accountAppDataDir,
};

const child = spawn(gw2Path, args, {
  cwd: gw2WorkingDirectory,
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
  env: spawnEnv,             // new
});
```

**Linux path unchanged.** `APPDATA` is a Windows concept; Wine resolves AppData per-prefix and ignores any host env. The Linux branch still spawns via Steam/Proton with no env override.

**`-autologin` still applies.** Args construction stays as today: pass `-autologin` whenever `hasLocalDat(account.id)` is true. The only thing that changes is which `Local.dat` the spawned process ends up reading.

**`-mumble` still applies.** Mumble names are per-account and live at the args level, unrelated to AppData.

## Migration on startup

Triggered at `app.whenReady()` startup, alongside the existing AppImage / updater-cache migration blocks in `electron/main.ts`. Runs before any IPC handler is wired up.

For each account in the store:

1. Compute new path: `<userData>/profiles/<accountId>/Guild Wars 2/Local.dat`.
2. If new file already exists → skip (idempotent).
3. Else look for old file: `<userData>/local-dat/<accountId>.dat`.
4. If old file exists → ensure `<userData>/profiles/<accountId>/Guild Wars 2/` exists, then `fs.renameSync(old, new)`. Log `[migration:profiles] account=<id> moved Local.dat into per-account profile dir`.
5. Else → nothing to migrate.

After processing all accounts:

6. Read `<userData>/local-dat/`. If empty → `fs.rmdirSync`. If orphaned files remain → log a warning, leave them alone (defensive against unknown state).

Each per-account migration is wrapped in its own try/catch. Failure on one account is logged with the account id and reason; other accounts still process; startup never aborts. A failed migration retries on the next startup (idempotent — sees missing destination, tries again).

`fs.renameSync` removes the source as part of the operation; no separate delete step needed.

## Removed surface

This change has unusually high surface deletion. Concretely:

**`electron/localDat.ts`:** removes `saveLocalDat`, `restoreLocalDat`, `getLocalDatPath`, `getStorageDir`, `getAccountLocalDatPath`, and the v1.1.13 EBUSY/EACCES/EPERM `try`/`catch` (only relevant inside `restoreLocalDat`, gone with it). Adds `getAccountAppDataDir(accountId)`. Rewrites `hasLocalDat` and `deleteLocalDat` against the new layout.

**`electron/main.ts`:** drops the `saveLocalDat` and `restoreLocalDat` imports, the `save-local-dat` IPC handler, the `restoreLocalDat(account.id)` call in `launch-account`, and the three-branch log block (`hasAuth` / `hasLocalDat else` / `else`). The args construction collapses to a single `hasLocalDat(account.id)` check.

**`electron/preload.cts`:** drops the `saveLocalDat` bridge.

**`electron/types.ts`:** drops `'save-local-dat'` from `IpcEvents`.

**`src/App.tsx`:** drops the `saveLocalDat` call and its toast/state flow. `hasLocalDat` polling stays (drives the "Saved" badge).

**`src/components/AccountCard.tsx`:** drops the Save Login button. "Saved" / "Not saved" status indicator stays.

**`src/components/AddAccountModal.tsx`:** drops `onResaveLogin` prop and its conditional rendering. `onClearLogin` stays (still useful — clears the per-account `Local.dat` so the user can re-login fresh). The "Saved login" indicator stays.

**Net effect:** roughly 150 fewer lines across the project; three IPC surfaces retired; one UI button removed. The remaining Local.dat surface is just "does this account have one?" and "delete it if requested."

## Testing

**Unit tests** (new file `electron/localDat.test.ts`, vitest, injectable filesystem in the same pattern as `resolveProtonContext`):

- `hasLocalDat(id)` returns true when `Guild Wars 2/Local.dat` exists in the profile dir, false otherwise.
- `deleteLocalDat(id)` removes the entire profile dir and is idempotent on second call.
- `getAccountAppDataDir(id)` creates the dir on demand and returns the right path.
- Migration logic (extracted as a pure function taking an injectable filesystem): given a fake fs with old `local-dat/<id>.dat` files and a list of account ids, it issues the right `renameSync` calls and is idempotent on second invocation. Coverage for the orphaned-files-in-legacy-dir branch.

**Existing tests:** `mutexCloser.test.ts` untouched — that module knows nothing about Local.dat.

**Manual verification on Windows:**

1. **Upgrade path:** on v1.1.13 with a saved login, install v1.1.14. On first launch, `userData/profiles/<accountId>/Guild Wars 2/Local.dat` exists; `userData/local-dat/` empty or removed. "Saved" badge still shows. Launching the account autologs in.
2. **Fresh account:** add a new account, launch, log in manually with Remember Me, quit GW2. Verify GW2 created `userData/profiles/<id>/Guild Wars 2/Local.dat`. Relaunch autologs in.
3. **Two concurrent accounts:** launch A, manual login + Remember Me, wait ready. Launch B (toggle on), manual login + Remember Me, wait ready. Both running. Quit both. Relaunch A — autologin as A. Relaunch B with A running — autologin as B. Both running, both correctly authenticated.
4. **Host AppData untouched:** `%APPDATA%\Guild Wars 2\Local.dat` on the user's machine is *not* modified by any AxiAM launch.
5. **Clear Login:** click Clear Login on an account. Profile dir is removed. Badge flips to "Not saved." Re-launch shows login screen.

No real-GW2 automated tests. Same posture as the mutex-closer feature.

## Out of scope / future work

- Linux per-prefix isolation (requires per-account Wine prefixes; tracked under v1.1.12's Linux follow-up).
- Cross-account settings sharing (e.g. shared Gfx.dat). Users can copy files manually if they want it.
- Automated end-to-end tests against a real GW2 install.

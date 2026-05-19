# Per-account `%APPDATA%\Guild Wars 2` junction (take-3)

**Date:** 2026-05-18
**Status:** Proposed; awaiting approval.

## Problem

v1.1.14-take-2 (current `feat/per-account-autologin-host-install` branch) installs each account's `Local.dat` into `%APPDATA%\Guild Wars 2\Local.dat` immediately before spawning GW2, then snapshots host → profile when the tracked GW2 quits. This works for *single-instance* per-account credentials (verified on Windows 2026-05-18, both Main and Alt show their own pre-filled login screens), but **fails for concurrent multi-instance**:

- The first running `Gw2-64.exe` holds `Local.dat` open with an exclusive write lock for the entire session, not just briefly at startup.
- The second launch's `installSnapshotToHostWithRetry` retries `copyFileSync` for 3 seconds and exhausts with `EBUSY`.
- The second GW2 then spawns *without* `-autologin`, reading whatever was at the host path from the first account's session. The user has to clear the first account's pre-filled fields and type the second account's credentials manually.

Verified locally 2026-05-18:
```
[install] account=<Alt> retry exhausted (EBUSY); launching without -autologin
[snapshot] account=<Alt> quit but 1 other GW2 still running; skipping copy-back
```

The fundamental constraint: Windows can't overwrite a file another process holds open without `FILE_SHARE_WRITE`, which GW2 does not grant. Any approach that keeps the *single* host path shared across instances will hit the same wall.

## Goals

- Per-account pre-filled login works for *every* concurrent GW2 instance, not just the first.
- Per-account `Local.dat` persistence across both single-instance and multi-instance sessions.
- Existing v1.1.13/take-2 snapshots migrate cleanly. Existing manual GW2 installs (no AxiAM history) keep their saved login.
- No regressions in the single-instance flow that take-2 already delivers.

## Non-goals

- Bypassing the GW2 login screen entirely. `-autologin` does not auto-submit on current client versions (verified independently of AxiAM on 2026-05-18 — see memory `axiam-autologin-flag-broken`). The goal remains "per-account credentials pre-fill; user clicks Login."
- Linux changes. Steam/Proton handles isolation differently; this design is Windows-only.
- Per-account *graphics* settings in v1.1.14. Initial cut shares `GFXSettings.*.xml` and other side files; per-account graphics can come later behind a setting.

## Architecture

Replace "copy `Local.dat` to/from the host path around each launch" with **make `%APPDATA%\Guild Wars 2` itself a directory junction (NTFS reparse point) and re-point it per launch.** Each per-account profile directory becomes the *real* `Guild Wars 2` directory for that account, and GW2 reads/writes its own `Local.dat` in-place via the junction.

```
%APPDATA%\Guild Wars 2  ── reparse point ──┐
                                            │
       ┌────────────────────────────────────┼─────────────────────────┐
       │ before launch A:                   │ before launch B:        │
       │ re-point to A's profile            │ re-point to B's profile │
       ▼                                    ▼                         │
userData/profiles/<A>/Guild Wars 2/     userData/profiles/<B>/Guild Wars 2/
       Local.dat                            Local.dat                 │
       GFXSettings...                       GFXSettings... (or shared symlinks)
                                                                      │
   A's running Gw2-64.exe                   B's running Gw2-64.exe ◄──┘
   has handle to A's Local.dat              has handle to B's Local.dat
   (opened when junction pointed to A)      (opened when junction pointed to B)
```

Key NTFS behavior this relies on: **directory junctions resolve at open time**, not at handle time. Re-pointing a junction does not invalidate existing handles, because those handles are tied to a specific NTFS inode (the resolved file), not the junction path. So we can flip the junction between launches and each running GW2 keeps writing to its own file.

### Per-account profile layout

```
userData/profiles/<accountId>/Guild Wars 2/
  Local.dat                          ← GW2 reads creds on startup, writes on quit
  GFXSettings.Gw2-64.exe.xml         ← initially per-account (free)
  ...any other files GW2 creates
```

The take-2 layout already places per-account `Local.dat` at `userData/profiles/<id>/Guild Wars 2/Local.dat`, so the storage path doesn't change. What changes is whether the *host* path is a real directory or a junction.

### Default profile

A reserved profile holds the state that was at `%APPDATA%\Guild Wars 2\` before AxiAM took ownership, plus the state any non-AxiAM GW2 launch produces:

```
userData/default-gw2-state/Guild Wars 2/
  Local.dat
  GFXSettings.*.xml
  ...
```

The junction defaults to pointing here when AxiAM hasn't launched any account, when the last-launched account exits, and at AxiAM shutdown. Lets users still launch GW2 outside AxiAM (Steam, desktop shortcut) and have it work.

### Per-launch sequence

```
1. launchSerializer.acquire() — still serialized so two repoints don't race
2. cancellation check (existing)
3. multi-instance gate + mutex-close (existing)
4. repointJunction(account.profileDir)   ← replaces installSnapshotToHostWithRetry
5. spawn Gw2-64.exe (-mumble, -autologin if hasLocalDat, extras)
6. waitForAccountProcess + manualAccountPidBindings (existing)
7. quitWatcher.noteLaunch(accountId, pid) (existing)
8. NO dwell needed — re-pointing the junction is atomic and instant
9. release serializer slot
```

The 4-second dwell from take-2 existed to let GW2 finish reading `Local.dat` before the next install overwrote it. With per-account directories, no overwrite happens — drop the dwell.

### Quit / snapshot-back

Drop both. GW2 writes directly into the account's profile dir via the junction; there's no second place to copy from. The whole `snapshotHostToAccount` + cross-contamination guard + hash-fingerprint logic from take-2's quit handler comes out.

quitWatcher still runs (to keep launchStateMachine in sync and for future use), but its `quit` handler does nothing snapshot-related.

### Multi-instance flow

```
t=0   launch A
        repoint junction → profiles/A/Guild Wars 2/
        spawn A; A opens "%APPDATA%\Guild Wars 2\Local.dat"
        → resolved to profiles/A/Guild Wars 2/Local.dat
        → A holds handle to A's Local.dat

t=10s launch B
        repoint junction → profiles/B/Guild Wars 2/
        spawn B; B opens "%APPDATA%\Guild Wars 2\Local.dat"
        → resolved to profiles/B/Guild Wars 2/Local.dat (different inode)
        → B holds handle to B's Local.dat

A and B run concurrently; each writes to its own Local.dat. No locks shared.

t=...  A quits → A's Local.dat reflects A's session state, in A's profile dir
t=...  B quits → B's Local.dat reflects B's session state, in B's profile dir
       junction reverts to default profile
```

### One-time migration

On AxiAM startup, if `%APPDATA%\Guild Wars 2\` exists and is *not* already a junction:

1. Verify no `Gw2-64.exe` is running. If it is, defer migration with a clear warning ("AxiAM needs to migrate Guild Wars 2 settings — please close Guild Wars 2 and restart AxiAM"). Don't migrate while GW2 has handles into the dir.
2. Move `%APPDATA%\Guild Wars 2\` → `userData/default-gw2-state/Guild Wars 2/` (preserving Local.dat, GFXSettings, etc.).
3. Create directory junction `%APPDATA%\Guild Wars 2\` → `userData/default-gw2-state/Guild Wars 2/`.
4. Write a marker file `userData/junction-migration-complete` so we don't re-migrate.

If `%APPDATA%\Guild Wars 2\` doesn't exist at all (fresh GW2 install on this machine), just create the junction pointing at an empty default-state dir.

If it's already a junction (subsequent AxiAM runs, or a re-install), no-op.

### Junction creation/repoint

Windows directory junctions can be created/repointed without admin rights (unlike symlinks). Two viable APIs:

- **`fs.symlinkSync(target, path, 'junction')`** — Node's built-in. Creates a junction. To repoint, delete the existing junction (`fs.rmSync` or `fs.unlinkSync`) and re-create. Atomic at the filesystem level.
- **`mklink /J` via `spawnSync`** — fallback if Node's symlink-as-junction has any quirks.

We'll wrap this in a `repointJunction(target)` helper in a new `electron/junction.ts`:

```ts
export function repointJunction(junctionPath: string, target: string): void {
  if (fs.existsSync(junctionPath)) fs.rmSync(junctionPath, { recursive: false, force: true });
  fs.symlinkSync(target, junctionPath, 'junction');
}

export function isJunction(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch { return false; }
}
```

### Files affected

**New:**
- `electron/junction.ts` — `repointJunction`, `isJunction`, `migrateToJunction` (idempotent migration)
- `electron/junction.test.ts` — unit tests (mocked fs)

**Modified:**
- `electron/main.ts` — replace `installSnapshotToHostWithRetry` call with `repointJunction` in `doLaunch`. Strip dwell on Windows. Strip `snapshotHostToAccount` quit handler. Add startup migration call.
- `electron/localDat.ts` — `installSnapshotToHost` and `snapshotHostToAccount` become unused; remove or mark deprecated.
- `electron/localDat.test.ts` — drop now-unused tests.

**Removed/simplified:**
- `LAUNCH_DWELL_AFTER_DETECTED_MS`, `INSTALL_RETRY_TOTAL_MS`, `INSTALL_RETRY_INTERVAL_MS` constants
- The launch-context map + fresh-account snapshot-skip guard from today's commit (`284d2f3`) becomes unneeded — there's no longer a copy step that can clobber another account's data.

## Edge cases

- **GW2 running outside AxiAM at the moment of launch.** The mutex-closer already handles this for spawning a second instance. After repointing, the externally-launched GW2 still has its own open handle to whatever the junction pointed at *before* — fine, it keeps writing there. The newly-launched account writes to its own. No corruption.
- **AxiAM crashes mid-launch.** The junction is left pointing at the last account. Next AxiAM startup detects this and reverts to the default profile. Worst case: a manual GW2 launch from outside AxiAM sees the last account's state, which is no worse than today.
- **User manually deletes `%APPDATA%\Guild Wars 2\`.** Detected on next launch; re-create the junction pointing at default profile.
- **Antivirus / EDR blocks junction creation.** Falls back to logging a clear error and refusing to launch. Take-3's promise depends on the junction; without it, we'd silently regress to take-2's behavior, which is confusing.
- **Different drive letters for userData vs APPDATA.** Directory junctions support cross-drive targets on Windows since Vista, so a junction `C:\Users\me\AppData\Roaming\Guild Wars 2` → `D:\axiam-data\profiles\<id>\Guild Wars 2` works. Worth a manual test before shipping.

## Validation

- **Unit tests** (`junction.test.ts`): mock fs, assert `repointJunction` deletes + re-creates, `isJunction` detection, migration idempotency.
- **Integration test on Windows** (manual, the real client):
  - Add two accounts (Main, Alt), each with a snapshot.
  - Launch Main → verify it pre-fills Main's email.
  - While Main is still running, launch Alt → verify it pre-fills *Alt's* email (the bug we're fixing).
  - Log in to both, play briefly, quit each. Verify each account's `Local.dat` has been updated with that session's writes (size/mtime).
  - Relaunch Main and Alt in opposite order, same expectations.
- **Migration test:** fresh install with a pre-existing `%APPDATA%\Guild Wars 2\` from a non-AxiAM session. Run AxiAM; confirm it migrates the contents into `default-gw2-state`, creates the junction, and an outside-AxiAM GW2 launch still works (reads/writes via the junction → default state).

## Rollout

- Behind a feature flag (`settings.junctionMultiInstance = false` default) for the v1.1.14-beta cycle until we have one round of m0mentkill3r confirmation.
- Once confirmed, default to true. The take-2 code path can be removed in v1.1.15.
- Document the migration in `RELEASE_NOTES.md`: "AxiAM now manages `%APPDATA%\Guild Wars 2\` as a directory link. Your existing data is preserved in AxiAM's data folder."

## Open questions

1. Are there other files in `%APPDATA%\Guild Wars 2\` we haven't accounted for that should be per-account vs shared? Need to inspect a real install after a longer play session.
2. Does GW2's launcher ever touch the directory while a separate `Gw2-64.exe` is running (e.g., for patching)? If so, the launcher could see whichever account the junction currently points at, which might confuse update detection. Worth a test.
3. Should the per-account profile include the *same* `GFXSettings.*.xml` as the default, or is sharing GFX globally OK? Initial cut shares; revisit if users care.

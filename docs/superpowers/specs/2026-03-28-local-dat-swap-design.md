# Local.dat Swap Authentication

**Date:** 2026-03-28
**Status:** Approved

## Problem

The current UI automation approach for GW2 credential entry is:
1. **Slow** — 4+ second delays, retry loops, Play button polling
2. **Requires permissions** — xdotool needs Wayland portal approval, PowerShell needs input simulation access
3. **Inconsistent** — timing-dependent typing/pasting, coordinate-based clicking breaks across resolutions

## Solution

Replace UI automation with per-account `Local.dat` file swapping + the `-autologin` launch flag. GW2 stores authentication state in `Local.dat`. By maintaining a copy per account and swapping the right one into place before launch, the launcher skips the login screen entirely.

## Platforms

Both Linux and Windows.

## Local.dat Paths

### Source (where GW2 stores it)
- **Linux (Steam/Proton):** `~/.local/share/Steam/steamapps/compatdata/1284210/pfx/drive_c/users/steamuser/AppData/Roaming/Guild Wars 2/Local.dat`
- **Windows:** `%AppData%\Guild Wars 2\Local.dat`

### Storage (where GW2AM keeps per-account copies)
- `{app.getPath('userData')}/local-dat/{accountId}.dat`

## How It Works

### Saving Auth (one-time per account)
1. User logs into GW2 manually for a given account
2. User clicks "Save Login" button on that account's card in GW2AM
3. GW2AM copies `Local.dat` from the GW2 data directory into `{userData}/local-dat/{accountId}.dat`
4. Account card updates to show saved auth exists

### Launching (every time)
1. Check if `{userData}/local-dat/{accountId}.dat` exists
2. **If yes:** Copy it to the GW2 data directory as `Local.dat`, add `-autologin` to launch args
3. **If no:** Launch normally without `-autologin` — user logs in manually
4. No UI automation runs in either case

### Auth Expiry
- GW2 auth tokens in `Local.dat` expire after some period
- If `-autologin` fails (launcher shows login screen), user logs in manually and re-saves
- No automatic detection of expiry — user handles it when they notice

## UI Changes

### Account Card
- **"Save Login" button**: Copies current `Local.dat` into storage for that account
  - Disabled while GW2 is running (to avoid copying mid-session state)
  - Disabled if GW2 data directory path can't be resolved
- **Auth status indicator**: Shows whether the account has a saved `Local.dat`
  - e.g., a small badge, icon, or status text like "Login saved" / "No saved login"

### No New Settings
- Linux path is auto-detected at the known Steam compatdata location
- Windows path is auto-detected via `%AppData%`
- No user-configurable "Local.dat path" setting

## Launch Args Changes

### Remove
- `-email` and `-password` args no longer passed to GW2 executable

### Add (conditional)
- `-autologin` added only when a saved `Local.dat` exists for the account

### Keep
- `--mumble` and user-defined custom args unchanged

## What Gets Removed

- CLI credential args (`-email`, `-password`, `-autologin`) removed from launch arg construction
- UI automation (`startCredentialAutomation`) remains commented out — can be fully removed once Local.dat approach is proven stable
- The `passwordForArgs` variable and associated decrypt call removed from launch flow

## Data Flow

```
User clicks "Save Login"
  → GW2AM reads Local.dat from GW2 data dir
  → Copies to {userData}/local-dat/{accountId}.dat

User clicks "Launch"
  → Check {userData}/local-dat/{accountId}.dat exists?
  → YES: Copy to GW2 data dir, launch with -autologin
  → NO:  Launch without -autologin (manual login)
```

## Error Handling

- **GW2 data directory not found:** "Save Login" button disabled with tooltip explaining why
- **Local.dat doesn't exist at source:** "Save Login" shows error — user hasn't logged in yet
- **Copy fails (permissions, disk):** Log error, show user-facing message, launch without -autologin
- **-autologin doesn't work (expired token):** User sees normal login screen, logs in manually, re-saves

## Security

- `Local.dat` contains auth tokens — same sensitivity as stored passwords
- Files stored in the app's userData directory (same protection level as the encrypted password store)
- No credentials passed via command-line args or environment variables (improvement over both previous approaches)

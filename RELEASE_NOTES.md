# Release Notes

Version v1.1.11 — May 17, 2026

## Fixes

- `-shareArchive` now works on Windows. The launcher used to route Windows accounts through Steam's `steam://` URI, which only ever runs one copy of GW2 — so launching a second account silently killed the first one's login panel. The launcher now finds `Gw2-64.exe` automatically (Program Files, `C:\Guild Wars 2`, or any Steam library on any drive) and spawns it directly. No more "the first window just disappeared" when opening multiple clients.
- You don't have to point the launcher at `Gw2-64.exe` manually anymore. If you haven't set a path in settings, it'll find your install on its own — works for both the standalone arena.net installer and Steam-installed copies.

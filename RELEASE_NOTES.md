# Release Notes

Version v1.1.12 — May 17, 2026

## Multi-instance GW2 launches (Windows)

You can now launch more than one Guild Wars 2 client at a time. There's a new toggle in `Settings → Experimental` called **Allow multiple GW2 instances** — flip it on (you'll get a one-time confirmation), and launching a second account no longer gets stopped by GW2's single-instance lock. Same technique Gw2Launcher uses: a tiny bundled helper closes ArenaNet's window-mutex on the running client before the next one starts. The toggle is off by default; if it's off and you try to launch a second account, you'll get a clear message instead of a confusing failure.

NOTE: On Linux, this toggle is currently a no-op. GW2 under Proton doesn't actually create the mutex we close — single-instancing on Linux comes from Steam itself, which we'd have to bypass entirely. That's a bigger project, parked for a follow-up release.

## Fixes

- Failed launches now tell you *why* they failed. The old "GW2 did not report as launched. Check Steam and launcher state." toast is gone in favor of the actual reason from the launcher's internal state — e.g. "Another GW2 instance is running. Enable...", "Couldn't prepare GW2 for multi-instance launch: ...", or the specific timeout that fired.
- Process detection no longer hangs forever when GW2 runs elevated. If Windows hides the elevated process's command line from us, we now match it by the new `Gw2-64.exe` PID that appeared right after we spawned the game, instead of waiting 90 seconds for a match that's never going to come.

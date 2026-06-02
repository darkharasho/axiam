# Release Notes

Version v1.2.1 — June 2, 2026

## No more "needs to be patched first" crash after updates

When Guild Wars 2 got a Steam update, launching an account would sometimes crash on startup with a "Client needs to be patched first" error. That happened because auto-login skips the GW2 launcher's patcher, so the game tried to start with out-of-date files.

Now the launcher notices when your `Gw2.dat` is stale and quietly runs the game's patcher once before logging you in — you'll see a brief "patching" state, then it launches normally. If you hit Stop while it's patching, it cleanly bails out instead of launching anyway.

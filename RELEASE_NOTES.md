# Release Notes

Version v1.2.3 — June 8, 2026

## No more relaunching straight back into a crash

The "needs to be patched first" recovery from 1.2.2 had a bad failure mode: after a crash it would run the patcher and relaunch you — even when the patcher didn't actually do anything. On Steam/Linux that meant it often relaunched right back into the same crash.

Now it only relaunches if the patcher genuinely updated the game. If nothing was actually patched — which usually means the crash wasn't an update problem in the first place (an addon or Proton hiccup, say) — it stops and tells you instead of looping you through the same crash.

NOTE: If your account keeps crashing and this doesn't kick in, the crash probably isn't update-related — check your addons (ArcDPS/Nexus) and the game's `Crash.dmp`.

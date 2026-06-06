# Release Notes

Version v1.2.2 — June 5, 2026

## The "needs to be patched first" crash, actually fixed this time

v1.2.1 tried to catch this but didn't really work: it guessed whether GW2 needed patching by looking at file dates, and that guess never fired for the way GW2 actually updates — so the crash kept happening after an update.

Now AxiAM watches the launch instead of guessing. If an account starts and the game crashes right away with a fresh crash report, it quietly runs the patcher and relaunches you once — no manual relaunch needed. A normal exit (you just closed the game) is left alone, and it won't loop if something else is wrong.

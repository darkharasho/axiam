# Release Notes

Version v1.1.13 — May 17, 2026

## Fixes

- Multi-instance launches no longer get stuck silently. When account A is already running with its saved login restored, GW2 holds `Local.dat` open exclusively — and trying to install account B's `Local.dat` over it would fail with a filesystem error that aborted the launch handler with no log output past the mutex-close step. The launcher now tolerates the locked file, logs a clear warning, and proceeds to launch the second account without `-autologin` (you'll log in manually for the second client). Bound to be the most common cause of "the second launch silently does nothing" reports.

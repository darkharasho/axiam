# Release Notes

Version v1.1.10 — May 17, 2026

## Fixes

- `-shareArchive` works on Linux now. The launcher used to refuse to start a second GW2 process, which defeated the whole point of the flag. No more "Another GW2 instance is already running" when you actually want multiple clients sharing the archive.
- Per-account launch detection on Linux no longer hangs for 3 minutes before giving up. The launcher now recognizes GW2 when it's running under Proton (the command line uses Windows-style backslash paths) and passes `-mumble` the way GW2 actually expects, so Steam stops dropping the flag. Accounts that had a saved login were technically launching fine — you just never saw the UI stop spinning.
- If Steam isn't installed or isn't on `PATH`, the failure now shows up in the diagnostic log instead of silently failing.

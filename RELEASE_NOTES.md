# Release Notes

Version v1.1.2 — April 10, 2026

## Fixes

Fixed Local.dat detection when GW2 is installed on a non-default Steam library folder (e.g. a second drive). AxiAM now reads Steam's `libraryfolders.vdf` to find all library paths instead of only checking `~/.local/share/Steam`. This also fixes GW2 executable auto-detection for the same scenario.

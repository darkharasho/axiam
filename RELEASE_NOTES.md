# Release Notes

Version v1.1.3 — April 11, 2026

## Fixes

Fixed GW2 on Linux launching without Proton when a GW2 path was configured. AxiAM was spawning the `.exe` directly instead of going through Steam, which bypassed Proton entirely — causing lag (no DXVK) and missing addons like ArcDPS and Nexus (no DLL override loading). Now always launches via `steam -applaunch` on Linux.

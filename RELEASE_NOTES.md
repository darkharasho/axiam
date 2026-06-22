# Release Notes

Version v1.2.6 — June 21, 2026

## New app icon
AxiAM has a new duotone **rocket** icon, part of a suite-wide refresh. Updated installer/taskbar icon and in-app logo. No functional changes in this release.

Version v1.2.5 — June 10, 2026

## Fixed "Download failed (5)" on Linux launches

If you play on Linux through Steam/Proton and every AxiAM launch was stalling on the launcher with "Download failed! Please check your internet connection and try again. (5)" — while launching straight from Steam worked fine — that's fixed.

AxiAM was always telling GW2 to share its game archive, which broke the launcher's connection check and left you stuck on that error, even when the game was fully up to date. Now AxiAM only shares the archive when you're actually launching a second copy alongside a running one, so a normal launch connects and starts like it should.

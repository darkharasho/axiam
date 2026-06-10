# Release Notes

Version v1.2.5 — June 10, 2026

## Fixed "Download failed (5)" on Linux launches

If you play on Linux through Steam/Proton and every AxiAM launch was stalling on the launcher with "Download failed! Please check your internet connection and try again. (5)" — while launching straight from Steam worked fine — that's fixed.

AxiAM was always telling GW2 to share its game archive, which keeps the patcher from applying a pending update. So any time ArenaNet pushed a client update, AxiAM launches couldn't patch and got stuck on that error. Now AxiAM only shares the archive when you're actually launching a second copy alongside a running one, so a normal launch can patch itself like it should.

NOTE: If you're still stuck on the old version, launch GW2 once directly through Steam to let it patch, then update AxiAM.

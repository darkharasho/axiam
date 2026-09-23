# Release Notes

Version v1.3.0 — September 23, 2026

## A full redesign in the axi design language

AxiAM now wears the same design language as the rest of the axi suite — flat, outlined, dark, drawn in saturated ink. Every surface, button, card, menu, and modal has been redrawn: hard outlines and offset blocks instead of glows and gradients, hover lifts instead of fades, and a giant AxiAM mark etched into the background.

## Themes are now the official accent palette

The old theme list has been replaced by the suite's 11 official accent colors. Your accent still cycles from the paintbrush, and the whole UI recolors around it.

## Account cards: smaller status, bigger name

The status text chip on collapsed cards is now a compact status dot, so your full GW2 account name finally fits without truncating. Hover the dot for the full status (including whether it's inferred), and expand the card for the complete detail rows — status, API name, launch args, saved login, and certainty.

## Polish

- The titlebar carries the AxiAM glyph again, and the duplicate What's New button is gone (it lives in the left rail).
- Context menu items now highlight properly on hover.
- Tooltips no longer clip against the card they belong to.

Version v1.2.6 — June 21, 2026

## New app icon
AxiAM has a new duotone **rocket** icon, part of a suite-wide refresh. Updated installer/taskbar icon and in-app logo. No functional changes in this release.

Version v1.2.5 — June 10, 2026

## Fixed "Download failed (5)" on Linux launches

If you play on Linux through Steam/Proton and every AxiAM launch was stalling on the launcher with "Download failed! Please check your internet connection and try again. (5)" — while launching straight from Steam worked fine — that's fixed.

AxiAM was always telling GW2 to share its game archive, which broke the launcher's connection check and left you stuck on that error, even when the game was fully up to date. Now AxiAM only shares the archive when you're actually launching a second copy alongside a running one, so a normal launch connects and starts like it should.

# Release Notes

Version v1.5.0 — October 5, 2026

## Access check

AxiAM now checks a public access list when it starts and every few hours. Access to the Axi apps can be revoked for accounts, guilds or Discord servers that violate the terms of use, and a revoked install shows a block screen instead of the app.

The list is downloaded from `config.axi.link` and holds only one-way hashes. AxiAM checks your vault's GW2 account names and guilds against it on your device and never sends them anywhere. To find a key's account and guilds, it asks the official Guild Wars 2 API using that key.

If the list can't be reached, AxiAM keeps working as before. The README has a new **Access** section that spells out exactly what is checked and how to appeal.

Version v1.4.2 — October 4, 2026

## Fixes

- Title bar chip labels stay on one line everywhere in the app, not just in the title bar. The shared chip style now keeps its labels from wrapping.

Version v1.4.1 — October 4, 2026

## Fixes

- Multi-word labels in the title bar chips, like "UP TO DATE", no longer wrap onto a second line.

Version v1.4.0 — October 1, 2026

## Pick how AxiAM looks

Settings has a new **Surface** control beside the accent picker, with three choices. **Axi** is what AxiAM has always looked like — flat and outlined, square corners, hard offset blocks instead of blurred shadows — and it stays the default. **Flat** keeps those shapes but rounds the corners and uses real shadows. **Glass** makes panels translucent, with depth and blur behind them.

Your choice sticks between launches and repaints the whole app at once.

## The Windows helper binaries are gone

AxiAM no longer ships `axiam-injector.exe`, `axiam-mutex-closer.exe` or `axiam_local_dat_redirect.dll`. The experimental DLL-injection route to per-account credentials never worked outside Win32 and had stopped being used, so it has been removed along with the code that called it. The installer is smaller for it.

**Allow multiple GW2 instances** still works exactly as before, and so does junction mode — neither depended on those helpers. The only thing that changed is the explanatory text under the toggle, which used to describe mutex closing and DLL injection that no longer happen.

## Fixes

- On Flat and Glass the window's rounded corners are now actually round; the page used to paint square corners over them.
- Buttons that came out with a black background on the new surfaces are drawn in the right token now.

Version v1.3.1 — September 23, 2026

## Fixes

- The update badge (and the DEV tag) no longer looks oversized in the title bar — it's now a slim tag that actually fits the strip.
- The minimize/maximize/close icons are properly centered in their buttons instead of sitting slightly low and off to the side.

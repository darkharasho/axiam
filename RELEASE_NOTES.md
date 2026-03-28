# Release Notes

Version v1.0.0 — March 28, 2026

## AxiAM

GW2AM is now AxiAM. New name, new branding, new title bar with the Cinzel font. Your existing settings and accounts migrate automatically from the old GW2AM data directory on first launch.

## Save Login

Completely reworked how login saving works. Instead of passing credentials as launch arguments (which was fragile and got stripped by the client), AxiAM now saves and swaps `Local.dat` files per account. You can save your login from the account card, and it auto-saves on first login. Re-save and clear options are in account settings.

## No More UI Automation

The old auto-login system that tried to type credentials into the game client is gone. It never worked reliably on Linux and was always finicky on Windows. Over 2,000 lines of automation code removed. The Local.dat approach above replaces it entirely.

## QoL Improvements

- Toast notifications are now compact, centered above the bottom bar, and use neutral colors instead of the old red styling.
- The "AM" text in the title bar now uses your theme's accent color.
- `Local.dat` auto-saves on game exit so your session stays fresh.

## Fixes

- Fixed a migration bug that checked for a directory instead of `config.json`.
- Launch args like `-provider` are no longer incorrectly stripped.
- Logo icon properly shows in the title bar again.

# Release Notes

Version v1.2.4 — June 9, 2026

## Per-account logins now work on Linux/Steam

If you run AxiAM on Linux through Steam/Proton, your saved logins finally stick. Before, clearing a login and logging back in never re-saved it, and every account dropped you onto the same first character — AxiAM was passing `-autologin` but never actually swapping each account's saved login into the game. Now it loads the right account's login before launch and saves it back when you quit, so each account logs into itself and lands on its own last-played character.

NOTE: This is Linux/Steam only. Windows is unchanged. The first time you launch an account after updating, log in once so AxiAM can capture that account's login going forward.

## Accounts now show "Stopped" on Linux when you quit

Close GW2 on Linux and the account card flips back to Stopped instead of showing Running forever.

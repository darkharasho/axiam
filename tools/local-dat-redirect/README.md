# axiam-local-dat-redirect

Per-process Local.dat redirect DLL injected into `Gw2-64.exe` so AxiAM can
run concurrent multi-instance with per-account credentials. Hooks
`NtCreateFile` and rewrites any open of
`%APPDATA%\Guild Wars 2\Local.dat` to the per-account path supplied via
the `AXIAM_LOCAL_DAT_PATH` environment variable.

See `docs/superpowers/specs/2026-05-19-dll-injection-design.md` for the
full design.

## Build

    cargo build --release --target x86_64-pc-windows-gnu

Output: `target/x86_64-pc-windows-gnu/release/axiam_local_dat_redirect.dll`.

There's an `npm run build:local-dat-redirect` wrapper at the repo root.

## Tests

    cargo test                # pure-Rust unit tests (path matching)

The hook itself can only be exercised inside a real target process — see
the integration harness under `tests/` (Windows host only).

## Runtime

Injected by `axiam-injector.exe` via `CREATE_SUSPENDED` +
`CreateRemoteThread(LoadLibraryW)` before the target's main thread
resumes. `DllMain` reads `AXIAM_LOCAL_DAT_PATH`, installs the hook, and
returns. Unhooks on `DLL_PROCESS_DETACH`.

If `AXIAM_LOCAL_DAT_PATH` is unset or empty, the DLL is a no-op and the
target sees the unmodified `%APPDATA%\Guild Wars 2\Local.dat`. This is
intentional: it makes the DLL safe to load outside of AxiAM-orchestrated
spawns.

# axiam-mutex-closer

Tiny native helper that closes ArenaNet's `AN-Mutex-Window-Guild Wars 2`
single-instance kernel mutex in running `Gw2-64.exe` processes so AxiAM
can launch multiple GW2 clients side-by-side.

## CLI

    axiam-mutex-closer.exe \
      --process-name "Gw2-64.exe" \
      --mutex-name "AN-Mutex-Window-Guild Wars 2" \
      [--pid <N>] \
      [--json]

Exit codes:

| Code | Meaning |
|------|---------|
| 0    | At least one matching mutex was closed |
| 2    | Target processes found but no matching mutex |
| 3    | No matching target processes found |
| 4    | A Win32 / argument call failed (details on stderr) |

## Build

Prerequisites (on Linux): `rustup target add x86_64-pc-windows-gnu` and
the mingw-w64 cross-compiler (`sudo apt install mingw-w64` or distro
equivalent). On Windows, just install Rust via rustup — no cross-compile
required.

    cargo build --release --target x86_64-pc-windows-gnu
    cp target/x86_64-pc-windows-gnu/release/axiam-mutex-closer.exe \
       ../../build/win/axiam-mutex-closer.exe

There's an `npm run build:mutex-closer` wrapper at the repo root that
runs the above.

## Tests

Unit tests (no Windows needed):

    cargo test

Integration tests (Windows host or Linux with Wine):

    cargo test --target x86_64-pc-windows-gnu --release

## Manual verification checklist

After wiring the helper into AxiAM, run these against a real Guild Wars 2
install before merging:

1. With "Allow multiple GW2 instances" toggled **off**:
   - Launch account A → succeeds.
   - Launch account B → blocked with the message "Another GW2 instance
     is running. Enable 'Allow multiple GW2 instances' in Settings to
     launch alongside it."
2. With the toggle **on**:
   - Launch account A → succeeds.
   - Launch account B → both `Gw2-64.exe` processes appear in Task
     Manager, both accounts show "running" in the AxiAM UI.
3. Move or rename `build/win/axiam-mutex-closer.exe` in the installed
   AxiAM resources directory, then launch account B with the toggle on:
   AxiAM should fail fast with "Couldn't prepare GW2 for multi-instance
   launch: <reason>". Restore the binary afterward.
4. Repeat steps 1 and 2 on Linux with Steam/Proton. Confirm Proton
   wraps the helper correctly via the launch log.
5. Toggle "Allow multiple GW2 instances" **off** while two GW2
   instances are running: existing instances keep running; launching a
   third is blocked.

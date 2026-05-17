# Multi-instance GW2 Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship multi-instance GW2 launch support for AxiAM — a settings-gated feature that closes ArenaNet's single-instance mutex via a bundled native helper so multiple `Gw2-64.exe` processes can run concurrently on Windows and (via Wine/Proton) on Linux.

**Architecture:** A small Rust binary (`axiam-mutex-closer.exe`) walks the kernel handle table of running `Gw2-64.exe` processes and closes their `AN-Mutex-Window-Guild Wars 2` handle via `DuplicateHandle(..., DUPLICATE_CLOSE_SOURCE)`. Electron main spawns the helper before launching a second GW2 instance, gated on a new `allowMultiInstance` setting. The same Windows .exe runs under Wine via Proton on Linux. Spec: `docs/superpowers/specs/2026-05-17-multi-instance-gw2-design.md`.

**Tech Stack:** Rust (`windows-sys` crate, mingw cross-compile to `x86_64-pc-windows-gnu`), Node/Electron (existing), TypeScript, electron-builder. Adds `vitest` as a JS dev dep for unit tests of the new `mutexCloser` module (the repo has no JS test runner today).

---

## File Structure

**New files:**

- `tools/mutex-closer/Cargo.toml` — Rust crate manifest
- `tools/mutex-closer/src/main.rs` — helper binary entry point + logic
- `tools/mutex-closer/src/handles.rs` — pure-logic helpers (handle-table parsing, name matching) for unit testability
- `tools/mutex-closer/tests/integration.rs` — Windows-only integration test
- `tools/mutex-closer/README.md` — build instructions + manual verification checklist
- `build/win/axiam-mutex-closer.exe` — committed prebuilt binary
- `electron/mutexCloser.ts` — Node-side wrapper (`runMutexCloser`, `runUnderProton`) with injectable spawn dependency
- `electron/mutexCloser.test.ts` — vitest unit tests for exit-code → result mapping
- `vitest.config.ts` — minimal vitest configuration

**Modified files:**

- `package.json` — add `vitest` devDep, `extraResources` build config, `build:mutex-closer` and `test` scripts
- `.gitignore` — exclude `tools/mutex-closer/target/`
- `electron/types.ts` — add `allowMultiInstance` to `AppSettings`
- `electron/main.ts` — wire `runMutexCloser` into `launch-account` (insert after gw2Path resolution, before spawn)
- `src/components/SettingsModal.tsx` — add experimental section with toggle + first-time-confirm modal

---

## Task 1: Rust crate scaffolding

**Files:**
- Create: `tools/mutex-closer/Cargo.toml`
- Create: `tools/mutex-closer/src/main.rs` (stub)
- Modify: `.gitignore`

- [ ] **Step 1: Create `tools/mutex-closer/Cargo.toml`**

```toml
[package]
name = "axiam-mutex-closer"
version = "0.1.0"
edition = "2021"
publish = false

[[bin]]
name = "axiam-mutex-closer"
path = "src/main.rs"

[profile.release]
lto = true
codegen-units = 1
opt-level = "z"
strip = true
panic = "abort"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_Foundation",
    "Win32_System_Threading",
    "Win32_System_Diagnostics_ToolHelp",
    "Win32_Security",
] }

[dev-dependencies]
```

- [ ] **Step 2: Create stub `tools/mutex-closer/src/main.rs`**

```rust
fn main() {
    eprintln!("axiam-mutex-closer: not yet implemented");
    std::process::exit(4);
}
```

- [ ] **Step 3: Add `tools/mutex-closer/target/` to `.gitignore`**

Append the following line to `.gitignore`:

```
tools/mutex-closer/target/
```

- [ ] **Step 4: Verify the crate builds for the Windows target**

Run: `cd tools/mutex-closer && cargo build --release --target x86_64-pc-windows-gnu`
Expected: build succeeds. Produces `tools/mutex-closer/target/x86_64-pc-windows-gnu/release/axiam-mutex-closer.exe`.

If `x86_64-pc-windows-gnu` target is missing, install with `rustup target add x86_64-pc-windows-gnu` and (on Linux) `sudo apt install mingw-w64` or distro equivalent. Document this prerequisite in Task 9.

- [ ] **Step 5: Commit**

```bash
git add tools/mutex-closer/Cargo.toml tools/mutex-closer/src/main.rs .gitignore
git commit -m "chore(mutex-closer): scaffold Rust crate"
```

---

## Task 2: CLI argument parsing

**Files:**
- Modify: `tools/mutex-closer/src/main.rs`

- [ ] **Step 1: Write the failing test inline**

Replace the stub `main.rs` with the following so the binary exposes a parser:

```rust
mod args;

fn main() {
    let parsed = match args::parse(std::env::args().skip(1)) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("argument error: {e}");
            std::process::exit(4);
        }
    };
    // For now just echo what was parsed.
    eprintln!("parsed: process_name={} mutex_name={} pid={:?} json={}",
        parsed.process_name, parsed.mutex_name, parsed.pid, parsed.json);
    std::process::exit(3); // no targets found
}
```

Create `tools/mutex-closer/src/args.rs`:

```rust
#[derive(Debug, PartialEq)]
pub struct Args {
    pub process_name: String,
    pub mutex_name: String,
    pub pid: Option<u32>,
    pub json: bool,
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Args, String> {
    let mut process_name: Option<String> = None;
    let mut mutex_name: Option<String> = None;
    let mut pid: Option<u32> = None;
    let mut json = false;
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--process-name" => process_name = Some(it.next().ok_or("--process-name needs a value")?),
            "--mutex-name" => mutex_name = Some(it.next().ok_or("--mutex-name needs a value")?),
            "--pid" => {
                let v = it.next().ok_or("--pid needs a value")?;
                pid = Some(v.parse::<u32>().map_err(|e| format!("--pid: {e}"))?);
            }
            "--json" => json = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args {
        process_name: process_name.ok_or("--process-name required")?,
        mutex_name: mutex_name.ok_or("--mutex-name required")?,
        pid,
        json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_required_flags() {
        let result = parse(args(&["--process-name", "Gw2-64.exe", "--mutex-name", "AN-Mutex"]).into_iter()).unwrap();
        assert_eq!(result.process_name, "Gw2-64.exe");
        assert_eq!(result.mutex_name, "AN-Mutex");
        assert_eq!(result.pid, None);
        assert!(!result.json);
    }

    #[test]
    fn parses_pid_and_json() {
        let result = parse(args(&[
            "--process-name", "X", "--mutex-name", "Y",
            "--pid", "1234", "--json",
        ]).into_iter()).unwrap();
        assert_eq!(result.pid, Some(1234));
        assert!(result.json);
    }

    #[test]
    fn errors_on_missing_required() {
        assert!(parse(args(&["--process-name", "X"]).into_iter()).is_err());
    }

    #[test]
    fn errors_on_unknown_flag() {
        assert!(parse(args(&["--bogus"]).into_iter()).is_err());
    }
}
```

- [ ] **Step 2: Run tests — they should pass on first run**

Run: `cd tools/mutex-closer && cargo test --target $(rustc -vV | sed -n 's/host: //p')`

Expected: all four tests pass on the host target (no Windows APIs touched yet, so they run cross-platform).

- [ ] **Step 3: Commit**

```bash
git add tools/mutex-closer/src/main.rs tools/mutex-closer/src/args.rs
git commit -m "feat(mutex-closer): CLI argument parsing"
```

---

## Task 3: Process enumeration & opening

**Files:**
- Create: `tools/mutex-closer/src/process.rs`
- Modify: `tools/mutex-closer/src/main.rs`

- [ ] **Step 1: Create `tools/mutex-closer/src/process.rs`**

```rust
#![cfg(windows)]

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_DUP_HANDLE, PROCESS_QUERY_INFORMATION,
};

#[derive(Debug)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

pub fn enumerate() -> Result<Vec<ProcessInfo>, String> {
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return Err("CreateToolhelp32Snapshot failed".into());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry);
        while ok != 0 {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = OsString::from_wide(&entry.szExeFile[..len])
                .to_string_lossy()
                .into_owned();
            out.push(ProcessInfo { pid: entry.th32ProcessID, name });
            ok = Process32NextW(snap, &mut entry);
        }
        CloseHandle(snap);
    }
    Ok(out)
}

pub fn matches_name(candidate: &str, target: &str) -> bool {
    candidate.eq_ignore_ascii_case(target)
}

pub struct OwnedHandle(pub HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0); }
    }
}

pub fn open_for_handle_dup(pid: u32) -> Result<OwnedHandle, String> {
    unsafe {
        let handle = OpenProcess(PROCESS_DUP_HANDLE | PROCESS_QUERY_INFORMATION, 0, pid);
        if handle == 0 {
            return Err(format!("OpenProcess({pid}) failed; possibly insufficient privileges"));
        }
        Ok(OwnedHandle(handle))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_name_is_case_insensitive() {
        assert!(matches_name("Gw2-64.exe", "gw2-64.exe"));
        assert!(matches_name("GW2-64.EXE", "Gw2-64.exe"));
        assert!(!matches_name("Gw2.exe", "Gw2-64.exe"));
    }
}
```

- [ ] **Step 2: Update `tools/mutex-closer/src/main.rs` to surface enumeration**

```rust
mod args;
#[cfg(windows)]
mod process;

fn main() {
    let parsed = match args::parse(std::env::args().skip(1)) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("argument error: {e}");
            std::process::exit(4);
        }
    };

    #[cfg(not(windows))]
    {
        eprintln!("axiam-mutex-closer only runs on Windows (or Wine)");
        let _ = parsed;
        std::process::exit(4);
    }

    #[cfg(windows)]
    {
        run(parsed);
    }
}

#[cfg(windows)]
fn run(parsed: args::Args) -> ! {
    let processes = match process::enumerate() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("process enumeration failed: {e}");
            std::process::exit(4);
        }
    };
    let targets: Vec<u32> = match parsed.pid {
        Some(pid) => processes.iter().filter(|p| p.pid == pid).map(|p| p.pid).collect(),
        None => processes
            .iter()
            .filter(|p| process::matches_name(&p.name, &parsed.process_name))
            .map(|p| p.pid)
            .collect(),
    };
    if targets.is_empty() {
        if parsed.json {
            println!("{{\"closed\":0,\"targets\":0}}");
        }
        std::process::exit(3);
    }
    // Step into handle work in a later task.
    if parsed.json {
        println!("{{\"closed\":0,\"targets\":{}}}", targets.len());
    }
    std::process::exit(2);
}
```

- [ ] **Step 3: Build and unit-test**

Run on host:
```
cd tools/mutex-closer && cargo test
```
Expected: existing args tests + `matches_name_is_case_insensitive` pass.

Run Windows build:
```
cargo build --release --target x86_64-pc-windows-gnu
```
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add tools/mutex-closer/src/process.rs tools/mutex-closer/src/main.rs
git commit -m "feat(mutex-closer): enumerate processes and resolve targets"
```

---

## Task 4: Handle enumeration & mutex closing

**Files:**
- Create: `tools/mutex-closer/src/handles.rs`
- Modify: `tools/mutex-closer/src/main.rs`

This task implements the core mutex-closing logic via `NtQuerySystemInformation(SystemHandleInformation)` and `DuplicateHandle`. Most of the code is `unsafe` Windows FFI — keep purity to a minimum, expose enough surface to test via the integration test in Task 5.

- [ ] **Step 1: Create `tools/mutex-closer/src/handles.rs`**

```rust
#![cfg(windows)]

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows_sys::Win32::Foundation::{
    CloseHandle, DuplicateHandle, GetCurrentProcess, DUPLICATE_CLOSE_SOURCE, DUPLICATE_SAME_ACCESS,
    HANDLE, STATUS_INFO_LENGTH_MISMATCH,
};

// NtQuerySystemInformation isn't in windows-sys directly — declare it manually.
#[repr(C)]
#[derive(Copy, Clone)]
struct SystemHandleTableEntryInfo {
    process_id: u32,
    object_type_number: u8,
    flags: u8,
    handle: u16,
    object: *mut core::ffi::c_void,
    granted_access: u32,
}

const SYSTEM_HANDLE_INFORMATION: u32 = 16;
const OBJECT_NAME_INFORMATION: u32 = 1;

#[link(name = "ntdll")]
extern "system" {
    fn NtQuerySystemInformation(
        info_class: u32,
        info: *mut core::ffi::c_void,
        info_len: u32,
        return_len: *mut u32,
    ) -> i32;
    fn NtQueryObject(
        handle: HANDLE,
        info_class: u32,
        info: *mut core::ffi::c_void,
        info_len: u32,
        return_len: *mut u32,
    ) -> i32;
}

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
struct ObjectNameInformation {
    name: UnicodeString,
    // Buffer follows inline in the allocation we hand to NtQueryObject.
}

pub struct CandidateHandle {
    pub pid: u32,
    pub raw_handle: u16,
}

pub fn enumerate_handles_for_pids(target_pids: &[u32]) -> Result<Vec<CandidateHandle>, String> {
    let mut buf: Vec<u8> = vec![0u8; 1 << 20]; // start at 1 MiB
    loop {
        let mut needed: u32 = 0;
        let status = unsafe {
            NtQuerySystemInformation(
                SYSTEM_HANDLE_INFORMATION,
                buf.as_mut_ptr() as *mut _,
                buf.len() as u32,
                &mut needed,
            )
        };
        if status == STATUS_INFO_LENGTH_MISMATCH {
            buf.resize((needed as usize).max(buf.len() * 2), 0);
            continue;
        }
        if status < 0 {
            return Err(format!("NtQuerySystemInformation failed: 0x{:08x}", status));
        }
        break;
    }

    // Layout: ULONG NumberOfHandles followed by SystemHandleTableEntryInfo[NumberOfHandles]
    // On 64-bit, the ULONG is followed by 4 bytes of padding before the array.
    let count = unsafe { *(buf.as_ptr() as *const u32) } as usize;
    let entry_size = std::mem::size_of::<SystemHandleTableEntryInfo>();
    let header_size = std::mem::size_of::<usize>(); // ULONG + padding on 64-bit
    let mut out = Vec::with_capacity(target_pids.len() * 8);
    for i in 0..count {
        let offset = header_size + i * entry_size;
        if offset + entry_size > buf.len() {
            break;
        }
        let entry = unsafe { *(buf.as_ptr().add(offset) as *const SystemHandleTableEntryInfo) };
        if target_pids.contains(&entry.process_id) {
            out.push(CandidateHandle {
                pid: entry.process_id,
                raw_handle: entry.handle,
            });
        }
    }
    Ok(out)
}

pub fn handle_name_matches(
    target_process: HANDLE,
    raw_handle: u16,
    expected_name: &str,
) -> Result<bool, String> {
    unsafe {
        // Step 1: duplicate handle into our process so we can query its name.
        let mut dup: HANDLE = 0;
        let ok = DuplicateHandle(
            target_process,
            raw_handle as HANDLE,
            GetCurrentProcess(),
            &mut dup,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        );
        if ok == 0 || dup == 0 {
            // Many handles can't be duped (kernel-only types). Treat as non-match.
            return Ok(false);
        }
        let mut buf = vec![0u8; 2048];
        let mut needed: u32 = 0;
        let status = NtQueryObject(
            dup,
            OBJECT_NAME_INFORMATION,
            buf.as_mut_ptr() as *mut _,
            buf.len() as u32,
            &mut needed,
        );
        let result = if status < 0 {
            Ok(false)
        } else {
            let info = &*(buf.as_ptr() as *const ObjectNameInformation);
            if info.name.length == 0 {
                Ok(false)
            } else {
                let chars =
                    std::slice::from_raw_parts(info.name.buffer, (info.name.length / 2) as usize);
                let s = OsString::from_wide(chars).to_string_lossy().into_owned();
                Ok(s.ends_with(expected_name))
            }
        };
        CloseHandle(dup);
        result
    }
}

pub fn close_handle_in_source(target_process: HANDLE, raw_handle: u16) -> Result<(), String> {
    unsafe {
        let mut ignored: HANDLE = 0;
        let ok = DuplicateHandle(
            target_process,
            raw_handle as HANDLE,
            0 as HANDLE,
            &mut ignored,
            0,
            0,
            DUPLICATE_CLOSE_SOURCE,
        );
        if ok == 0 {
            return Err(format!(
                "DuplicateHandle(DUPLICATE_CLOSE_SOURCE) failed for raw_handle=0x{:x}",
                raw_handle
            ));
        }
        Ok(())
    }
}
```

- [ ] **Step 2: Wire `handles.rs` into `main.rs::run`**

Replace the `run` function in `tools/mutex-closer/src/main.rs` with the full pipeline:

```rust
#[cfg(windows)]
fn run(parsed: args::Args) -> ! {
    let processes = match process::enumerate() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("process enumeration failed: {e}");
            std::process::exit(4);
        }
    };
    let targets: Vec<u32> = match parsed.pid {
        Some(pid) => processes.iter().filter(|p| p.pid == pid).map(|p| p.pid).collect(),
        None => processes
            .iter()
            .filter(|p| process::matches_name(&p.name, &parsed.process_name))
            .map(|p| p.pid)
            .collect(),
    };
    if targets.is_empty() {
        if parsed.json { println!("{{\"closed\":0,\"targets\":0}}"); }
        std::process::exit(3);
    }

    let candidates = match handles::enumerate_handles_for_pids(&targets) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("handle enumeration failed: {e}");
            std::process::exit(4);
        }
    };

    let mut closed = 0usize;
    for pid in &targets {
        let owned = match process::open_for_handle_dup(*pid) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("warning: {e}");
                continue;
            }
        };
        for c in candidates.iter().filter(|c| c.pid == *pid) {
            match handles::handle_name_matches(owned.0, c.raw_handle, &parsed.mutex_name) {
                Ok(true) => {
                    match handles::close_handle_in_source(owned.0, c.raw_handle) {
                        Ok(()) => {
                            closed += 1;
                            eprintln!("closed mutex handle 0x{:x} in pid={}", c.raw_handle, pid);
                        }
                        Err(e) => eprintln!("warning: {e}"),
                    }
                }
                Ok(false) => {}
                Err(e) => eprintln!("warning: handle name query failed: {e}"),
            }
        }
    }

    if parsed.json {
        println!("{{\"closed\":{},\"targets\":{}}}", closed, targets.len());
    }
    if closed > 0 { std::process::exit(0) } else { std::process::exit(2) }
}
```

Also add the module declaration at the top of `main.rs`:

```rust
#[cfg(windows)]
mod handles;
```

- [ ] **Step 3: Build on host (unit tests) and Windows target**

```
cd tools/mutex-closer && cargo test
cargo build --release --target x86_64-pc-windows-gnu
```

Expected: tests pass, Windows build succeeds.

- [ ] **Step 4: Commit**

```bash
git add tools/mutex-closer/src/handles.rs tools/mutex-closer/src/main.rs
git commit -m "feat(mutex-closer): close named mutex in target processes"
```

---

## Task 5: Integration test (Windows-only)

**Files:**
- Create: `tools/mutex-closer/tests/integration.rs`

This test spawns a long-running Windows process that holds a known-named mutex, runs the helper against it, and verifies the helper exited 0 and the mutex is gone. It's Windows-only so it runs on a Windows host or under Wine.

- [ ] **Step 1: Create the test**

```rust
#![cfg(windows)]

use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;
use std::thread;

fn helper_binary_path() -> PathBuf {
    // cargo sets CARGO_BIN_EXE_<name> for integration tests of bin crates.
    PathBuf::from(env!("CARGO_BIN_EXE_axiam-mutex-closer"))
}

// Path to a tiny helper test fixture binary that holds a named mutex.
// Built inline via a build.rs-free approach: we exec PowerShell to create the mutex.
fn start_mutex_holder(mutex_name: &str) -> std::process::Child {
    let script = format!(
        r#"$m = New-Object System.Threading.Mutex($false, "{name}", [ref]$null); Start-Sleep -Seconds 30"#,
        name = mutex_name
    );
    Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to start PowerShell mutex holder")
}

#[test]
fn closes_named_mutex_in_target() {
    let mutex_name = format!("AxiAM-Test-Mutex-{}", std::process::id());
    let mut holder = start_mutex_holder(&mutex_name);
    // Give PowerShell time to create the mutex.
    thread::sleep(Duration::from_secs(2));

    let result = Command::new(helper_binary_path())
        .args([
            "--process-name", "powershell.exe",
            "--mutex-name", &mutex_name,
            "--pid", &holder.id().to_string(),
            "--json",
        ])
        .output()
        .expect("failed to run helper");

    let _ = holder.kill();

    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert_eq!(
        result.status.code(),
        Some(0),
        "helper did not exit 0. stdout={stdout} stderr={stderr}"
    );
    assert!(
        stdout.contains("\"closed\":1"),
        "expected closed:1 in stdout, got: {stdout}"
    );
}

#[test]
fn exits_3_when_no_target_processes() {
    let result = Command::new(helper_binary_path())
        .args([
            "--process-name", "this-process-definitely-does-not-exist.exe",
            "--mutex-name", "Whatever",
        ])
        .output()
        .expect("failed to run helper");
    assert_eq!(result.status.code(), Some(3));
}
```

- [ ] **Step 2: Run the integration tests on the Windows target via Wine (Linux dev) or natively**

If developing on Linux with `wine` installed:
```
cd tools/mutex-closer
cargo test --target x86_64-pc-windows-gnu --release
```
(Cargo invokes wine automatically via the `runner` config; if not configured, set `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=wine` in env.)

Expected: both tests pass. If `wine` or `powershell.exe` (under Wine) isn't available, document the skip in the README and run on a Windows host instead.

- [ ] **Step 3: Commit**

```bash
git add tools/mutex-closer/tests/integration.rs
git commit -m "test(mutex-closer): integration test for mutex closing"
```

---

## Task 6: Build and commit the prebuilt helper binary

**Files:**
- Create: `build/win/axiam-mutex-closer.exe`
- Create: `tools/mutex-closer/README.md`
- Modify: `package.json` (add `build:mutex-closer` script)

- [ ] **Step 1: Build the release binary**

```bash
cd tools/mutex-closer
cargo build --release --target x86_64-pc-windows-gnu
```

Verify the binary size: `ls -lh target/x86_64-pc-windows-gnu/release/axiam-mutex-closer.exe`. Expect under 200 KB. If over 500 KB, something's off — review `Cargo.toml` profile settings.

- [ ] **Step 2: Copy to the committed path**

```bash
mkdir -p ../../build/win
cp target/x86_64-pc-windows-gnu/release/axiam-mutex-closer.exe ../../build/win/axiam-mutex-closer.exe
```

- [ ] **Step 3: Create `tools/mutex-closer/README.md`**

```markdown
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
```

- [ ] **Step 4: Add `build:mutex-closer` npm script**

Edit `package.json` and add to the `scripts` section:

```json
"build:mutex-closer": "cd tools/mutex-closer && cargo build --release --target x86_64-pc-windows-gnu && cp target/x86_64-pc-windows-gnu/release/axiam-mutex-closer.exe ../../build/win/axiam-mutex-closer.exe"
```

- [ ] **Step 5: Commit**

```bash
git add build/win/axiam-mutex-closer.exe tools/mutex-closer/README.md package.json
git commit -m "build(mutex-closer): commit prebuilt helper binary"
```

---

## Task 7: Configure electron-builder to ship the helper

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `extraResources` to the `build` block**

In `package.json`, locate the `"build"` object. Add an `extraResources` array:

```json
"extraResources": [
  {
    "from": "build/win/axiam-mutex-closer.exe",
    "to": "mutex-closer/axiam-mutex-closer.exe"
  }
]
```

- [ ] **Step 2: Verify the build pipeline still works**

Run: `npm run build:electron && npm run build`
Expected: TypeScript and Vite builds succeed.

Then a packaging dry-run if you have electron-builder set up locally:
```
npx electron-builder --dir
```
Expected: produces `dist_out/{linux,win}-unpacked` with `resources/mutex-closer/axiam-mutex-closer.exe` present in each.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: ship axiam-mutex-closer via extraResources"
```

---

## Task 8: Add `allowMultiInstance` to AppSettings type

**Files:**
- Modify: `electron/types.ts`

- [ ] **Step 1: Add the field**

Update `electron/types.ts` lines 20-24 to:

```ts
export interface AppSettings {
    gw2Path: string;
    masterPasswordPrompt: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never';
    themeId: string;
    allowMultiInstance?: boolean;
}
```

The field is optional so existing stored settings without it keep working (treated as `false`).

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.electron.json --noEmit && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/types.ts
git commit -m "feat: add allowMultiInstance to AppSettings"
```

---

## Task 9: Set up vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

The repo has no JS test runner today. Vitest handles TypeScript out of the box and is the minimum viable setup.

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^1.6.0
```

(Pinning to `^1.6.0` keeps it on a stable line known to work with the existing Vite 5 setup.)

- [ ] **Step 2: Create `vitest.config.ts` at repo root**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 3: Add `test` script to `package.json`**

Update the `scripts` section in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: vitest runs, reports "No test files found, exiting with code 0" (or similar — no failures). If it errors on "no tests," that's still fine for now; next task adds the first test.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "test: set up vitest for electron-side unit tests"
```

---

## Task 10: Implement mutexCloser module (TDD)

**Files:**
- Create: `electron/mutexCloser.ts`
- Create: `electron/mutexCloser.test.ts`

The module wraps the helper binary as `runMutexCloser(pids)` returning `{ ok, closedCount, reason? }`. The function takes a `spawn`-like dependency so tests can inject a fake. A second function `runUnderProton` constructs the env + arg shape for Linux.

- [ ] **Step 1: Write the failing tests first**

Create `electron/mutexCloser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpretHelperResult, type SpawnResult } from './mutexCloser.js';

function result(status: number | null, stdout = '', stderr = ''): SpawnResult {
  return { status, stdout, stderr, error: null };
}

describe('interpretHelperResult', () => {
  it('returns ok=true with closedCount on exit 0', () => {
    const r = interpretHelperResult(result(0, '{"closed":2,"targets":2}'));
    expect(r).toEqual({ ok: true, closedCount: 2 });
  });

  it('returns ok=true closedCount=0 on exit 2 (no matching mutex)', () => {
    const r = interpretHelperResult(result(2, ''));
    expect(r.ok).toBe(true);
    expect(r.closedCount).toBe(0);
  });

  it('returns ok=true closedCount=0 on exit 3 (no target processes)', () => {
    const r = interpretHelperResult(result(3, ''));
    expect(r.ok).toBe(true);
    expect(r.closedCount).toBe(0);
  });

  it('returns ok=false with stderr on exit 4', () => {
    const r = interpretHelperResult(result(4, '', 'OpenProcess failed'));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('OpenProcess');
  });

  it('returns ok=false on unknown exit code', () => {
    const r = interpretHelperResult(result(99));
    expect(r.ok).toBe(false);
  });

  it('returns ok=false when spawn errored (e.g. binary missing)', () => {
    const r = interpretHelperResult({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT: no such file or directory'),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ENOENT');
  });

  it('parses closed count from stdout when JSON is well-formed', () => {
    const r = interpretHelperResult(result(0, '{"closed":5,"targets":7}'));
    expect(r.closedCount).toBe(5);
  });

  it('defaults closedCount to 1 on exit 0 when JSON is missing or malformed', () => {
    const r = interpretHelperResult(result(0, 'not-json'));
    expect(r).toEqual({ ok: true, closedCount: 1 });
  });
});
```

- [ ] **Step 2: Run the tests — they should fail because the module doesn't exist**

Run: `npm test`
Expected: failures referencing the missing `mutexCloser.js` import.

- [ ] **Step 3: Create the minimal `electron/mutexCloser.ts`**

```ts
import path from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

export interface MutexCloserResult {
  ok: boolean;
  closedCount: number;
  reason?: string;
}

const MUTEX_NAME = 'AN-Mutex-Window-Guild Wars 2';
const PROCESS_NAME = 'Gw2-64.exe';

export function interpretHelperResult(result: SpawnResult): MutexCloserResult {
  if (result.error) {
    return { ok: false, closedCount: 0, reason: result.error.message };
  }
  switch (result.status) {
    case 0: {
      const parsed = parseJsonClosedCount(result.stdout);
      return { ok: true, closedCount: parsed ?? 1 };
    }
    case 2:
    case 3:
      return { ok: true, closedCount: 0 };
    case 4:
      return { ok: false, closedCount: 0, reason: (result.stderr || 'helper reported failure').trim() };
    default:
      return {
        ok: false,
        closedCount: 0,
        reason: `helper exited with status ${result.status ?? 'null'}`,
      };
  }
}

function parseJsonClosedCount(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed?.closed === 'number') return parsed.closed;
  } catch {
    // fall through
  }
  return null;
}

export function getHelperPath(): string {
  // process.resourcesPath in packaged builds; fall back to repo path in dev.
  const packagedPath = path.join(process.resourcesPath || '', 'mutex-closer', 'axiam-mutex-closer.exe');
  if (fs.existsSync(packagedPath)) return packagedPath;
  return path.join(process.cwd(), 'build', 'win', 'axiam-mutex-closer.exe');
}

export function runMutexCloserDirect(helperPath: string): MutexCloserResult {
  const result = spawnSync(helperPath, [
    '--process-name', PROCESS_NAME,
    '--mutex-name', MUTEX_NAME,
    '--json',
  ], { encoding: 'utf8', timeout: 5000 });
  return interpretHelperResult({
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ?? null,
  });
}

export interface ProtonContext {
  protonPath: string;          // .../proton
  compatDataPath: string;       // .../steamapps/compatdata/1284210
  clientInstallPath: string;    // $HOME/.local/share/Steam
}

export function runMutexCloserUnderProton(helperPath: string, ctx: ProtonContext): MutexCloserResult {
  const env = {
    ...process.env,
    STEAM_COMPAT_DATA_PATH: ctx.compatDataPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: ctx.clientInstallPath,
  };
  const result = spawnSync(ctx.protonPath, [
    'run',
    helperPath,
    '--process-name', PROCESS_NAME,
    '--mutex-name', MUTEX_NAME,
    '--json',
  ], { encoding: 'utf8', timeout: 15000, env });
  return interpretHelperResult({
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ?? null,
  });
}
```

- [ ] **Step 4: Run the tests — they should pass**

Run: `npm test`
Expected: all 8 tests in `mutexCloser.test.ts` pass.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/mutexCloser.ts electron/mutexCloser.test.ts
git commit -m "feat: add mutexCloser module with exit-code interpretation"
```

---

## Task 11: Proton detection helper (Linux only)

**Files:**
- Modify: `electron/mutexCloser.ts` (add `resolveProtonContext`)
- Modify: `electron/mutexCloser.test.ts` (add tests)

`resolveProtonContext()` returns the `ProtonContext` (Proton binary path, compatdata path, Steam home) needed to wrap the helper through Proton. Pure-ish: takes the filesystem as an injectable dependency for testing.

- [ ] **Step 1: Add failing tests**

Append to `electron/mutexCloser.test.ts`:

```ts
import { resolveProtonContext, type Filesystem } from './mutexCloser.js';

function fakeFs(files: Set<string>): Filesystem {
  return {
    existsSync: (p: string) => files.has(p),
    readFileSync: () => '',
    readdirSync: () => [],
  };
}

describe('resolveProtonContext', () => {
  it('returns null when no compatdata exists', () => {
    const fs = fakeFs(new Set());
    expect(resolveProtonContext('/home/u', ['/home/u/.local/share/Steam'], fs)).toBeNull();
  });

  it('finds compatdata and a Proton install in the same library', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      `${lib}/steamapps/common/Proton - Experimental/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: () => '',
      readdirSync: (dir) => dir.endsWith('steamapps/common') ? ['Proton - Experimental'] : [],
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx).not.toBeNull();
    expect(ctx!.compatDataPath).toBe(`${lib}/steamapps/compatdata/1284210`);
    expect(ctx!.protonPath).toBe(`${lib}/steamapps/common/Proton - Experimental/proton`);
    expect(ctx!.clientInstallPath).toBe(`${home}/.local/share/Steam`);
  });

  it('picks the newest Proton-prefixed directory by name when multiple exist', () => {
    const home = '/home/u';
    const lib = `${home}/.local/share/Steam`;
    const files = new Set([
      `${lib}/steamapps/compatdata/1284210`,
      `${lib}/steamapps/common/Proton 8.0/proton`,
      `${lib}/steamapps/common/Proton 9.0/proton`,
    ]);
    const fs: Filesystem = {
      existsSync: (p) => files.has(p),
      readFileSync: () => '',
      readdirSync: (dir) => dir.endsWith('steamapps/common')
        ? ['Proton 8.0', 'Proton 9.0', 'NotProton']
        : [],
    };
    const ctx = resolveProtonContext(home, [lib], fs);
    expect(ctx!.protonPath).toBe(`${lib}/steamapps/common/Proton 9.0/proton`);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `npm test`
Expected: failures for missing `resolveProtonContext` / `Filesystem`.

- [ ] **Step 3: Implement in `electron/mutexCloser.ts`**

Append the following to `electron/mutexCloser.ts`:

```ts
export interface Filesystem {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding?: BufferEncoding) => string;
  readdirSync: (path: string) => string[];
}

const STEAM_GW2_APP_ID = '1284210';

export function resolveProtonContext(
  home: string,
  steamLibraryPaths: string[],
  filesystem: Filesystem,
): ProtonContext | null {
  for (const lib of steamLibraryPaths) {
    const compat = path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID);
    if (!filesystem.existsSync(compat)) continue;
    const proton = findProtonInLibrary(lib, filesystem);
    if (!proton) continue;
    return {
      compatDataPath: compat,
      protonPath: proton,
      clientInstallPath: path.join(home, '.local', 'share', 'Steam'),
    };
  }
  return null;
}

function findProtonInLibrary(libraryPath: string, filesystem: Filesystem): string | null {
  const commonDir = path.join(libraryPath, 'steamapps', 'common');
  if (!filesystem.existsSync(commonDir)) return null;
  const entries = filesystem.readdirSync(commonDir);
  const protonDirs = entries
    .filter((name) => /^Proton(\s|-)/i.test(name))
    .sort()
    .reverse(); // newest by name comes first
  for (const dir of protonDirs) {
    const candidate = path.join(commonDir, dir, 'proton');
    if (filesystem.existsSync(candidate)) return candidate;
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all `mutexCloser` tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/mutexCloser.ts electron/mutexCloser.test.ts
git commit -m "feat: resolve Proton context for Linux mutex-closer execution"
```

---

## Task 12: Wire mutexCloser into launch-account

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add import**

Near the existing imports at the top of `electron/main.ts`, add:

```ts
import {
  getHelperPath,
  runMutexCloserDirect,
  runMutexCloserUnderProton,
  resolveProtonContext,
  type MutexCloserResult,
} from './mutexCloser.js';
```

- [ ] **Step 2: Add the platform-dispatch wrapper inside `electron/main.ts`**

Add this function near the other launch-related helpers (after `launchViaSteam`):

```ts
function closeAnyExistingGw2Mutex(existingPidCount: number): MutexCloserResult {
  const helperPath = getHelperPath();
  if (!fs.existsSync(helperPath)) {
    return { ok: false, closedCount: 0, reason: `helper binary not found at ${helperPath}` };
  }
  if (process.platform === 'win32') {
    logMain('launch', `[mutex] Running mutex-closer against ${existingPidCount} existing GW2 process(es)`);
    return runMutexCloserDirect(helperPath);
  }
  if (process.platform === 'linux') {
    const home = os.homedir();
    const libraryPaths = getSteamLibraryPaths();
    // Ensure default library is checked even if libraryfolders.vdf missed it.
    const defaultLib = path.join(home, '.local', 'share', 'Steam');
    const allLibs = libraryPaths.includes(defaultLib) ? libraryPaths : [defaultLib, ...libraryPaths];
    const ctx = resolveProtonContext(home, allLibs, {
      existsSync: fs.existsSync,
      readFileSync: (p, enc) => fs.readFileSync(p, enc ?? 'utf-8') as string,
      readdirSync: (p) => fs.readdirSync(p) as string[],
    });
    if (!ctx) {
      return { ok: false, closedCount: 0, reason: 'could not resolve a Steam Proton install for Guild Wars 2' };
    }
    logMain('launch', `[mutex] Running mutex-closer under Proton (${ctx.protonPath})`);
    return runMutexCloserUnderProton(helperPath, ctx);
  }
  return { ok: false, closedCount: 0, reason: `mutex closing not supported on platform ${process.platform}` };
}
```

- [ ] **Step 3: Insert the mutex-close step into `launch-account`**

In `electron/main.ts`, find the `launch-account` handler. After the `gw2Path` resolution and auto-locate block (around line 1518 in the current file, just **before** the `const extraArgs = splitLaunchArguments(...)` line), insert:

```ts
  // Multi-instance gate + mutex preparation.
  const existingGw2Pids = getAllRunningGw2Pids();
  if (existingGw2Pids.length > 0) {
    const settingsForGate = (store.get('settings') as { allowMultiInstance?: boolean } | undefined) || {};
    if (!settingsForGate.allowMultiInstance) {
      logMainWarn('launch', `[mutex] Blocking launch of account=${id}: another GW2 instance is running and allowMultiInstance is off`);
      launchStateMachine.setState(
        id,
        'errored',
        'verified',
        'Another GW2 instance is running. Enable "Allow multiple GW2 instances" in Settings to launch alongside it.',
      );
      return false;
    }
    const mutexResult = closeAnyExistingGw2Mutex(existingGw2Pids.length);
    if (!mutexResult.ok) {
      logMainError('launch', `[mutex] ${mutexResult.reason}`);
      launchStateMachine.setState(
        id,
        'errored',
        'verified',
        `Couldn't prepare GW2 for multi-instance launch: ${mutexResult.reason}`,
      );
      return false;
    }
    logMain('launch', `[mutex] Closed AN-Mutex on ${mutexResult.closedCount} existing GW2 process(es)`);
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 11 `mutexCloser` tests still pass.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: gate and prepare multi-instance launches via mutex-closer"
```

---

## Task 13: Settings UI — toggle + first-time confirm

**Files:**
- Modify: `src/components/SettingsModal.tsx`

The toggle goes in an "Experimental" section near the bottom of the existing modal. The first-time confirm uses a simple `window.confirm`-style modal that matches the rest of the app (look at existing modals for a reference pattern; if there's already a `ConfirmModal`-style helper, reuse it — otherwise a simple inline `Dialog` works).

- [ ] **Step 1: Read the current SettingsModal to understand its conventions**

Run: `head -120 src/components/SettingsModal.tsx`

Note the structure: existing sections use `<div className="..."><h3>Section title</h3>...</div>`. State is held with `useState`. Settings are saved via `await window.electronAPI.saveSettings(...)`.

- [ ] **Step 2: Add `allowMultiInstance` state**

Find the existing `useState` declarations near the top of the component (around line 25-27) and add:

```tsx
const [allowMultiInstance, setAllowMultiInstance] = useState<boolean>(false);
const [showMultiInstanceConfirm, setShowMultiInstanceConfirm] = useState<boolean>(false);
```

- [ ] **Step 3: Include the field in load/save**

Find where `settings?.gw2Path || ''` is read (around line 97). Add the new field to the normalization and the local state:

```tsx
const normalized = {
    gw2Path: settings?.gw2Path || '',
    masterPasswordPrompt: settings?.masterPasswordPrompt ?? 'every_time',
    // ... existing fields ...
    allowMultiInstance: settings?.allowMultiInstance ?? false,
};
// ... existing setters ...
setAllowMultiInstance(normalized.allowMultiInstance);
```

Then find the save call (around lines 55 and 135) and include the field in both occurrences of the settings object being passed to `saveSettings`:

```tsx
{
    gw2Path,
    masterPasswordPrompt,
    // ... existing fields ...
    allowMultiInstance,
}
```

- [ ] **Step 4: Add the toggle UI**

Near the bottom of the modal body (before the close/save buttons), add a new section. Match the existing className conventions — for example:

```tsx
<div className="border-t border-[var(--theme-border)] pt-4 mt-4">
    <h3 className="text-sm font-medium text-[var(--theme-text)] mb-2">Experimental</h3>
    <label className="flex items-start gap-3 cursor-pointer">
        <input
            type="checkbox"
            className="mt-1"
            checked={allowMultiInstance}
            onChange={(e) => {
                if (e.target.checked && !allowMultiInstance) {
                    setShowMultiInstanceConfirm(true);
                } else {
                    setAllowMultiInstance(false);
                }
            }}
        />
        <div>
            <div className="text-sm text-[var(--theme-text)]">Allow multiple GW2 instances</div>
            <div className="text-xs text-[var(--theme-text-dim)] mt-1">
                Lets AxiAM launch more than one Guild Wars 2 client at a time by closing the
                game's single-instance lock. Multi-boxing is tolerated by ArenaNet but not
                officially supported — use at your own risk.
            </div>
        </div>
    </label>
</div>
```

- [ ] **Step 5: Add the confirm modal**

Just before the closing tag of the outermost modal element, add a conditional inline confirm overlay:

```tsx
{showMultiInstanceConfirm && (
    <div
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
    >
        <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg max-w-sm w-full p-4">
            <h4 className="text-sm font-medium text-[var(--theme-text)] mb-2">
                Enable multi-instance launches?
            </h4>
            <p className="text-xs text-[var(--theme-text-dim)] mb-4">
                This closes a kernel object inside the running GW2 process so a
                second client can start. It's the same technique used by
                Gw2Launcher, but isn't endorsed by ArenaNet. Continue?
            </p>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    className="btn-surface px-3 py-1.5 text-xs"
                    onClick={() => setShowMultiInstanceConfirm(false)}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={() => {
                        setAllowMultiInstance(true);
                        setShowMultiInstanceConfirm(false);
                    }}
                >
                    Enable
                </button>
            </div>
        </div>
    </div>
)}
```

(If the existing modal uses different button class names like `.btn-primary`/`.btn-surface` — adopt whatever the rest of the file already does. The snippet above uses common Tailwind shorthand based on what's visible in the file at line 220/298; substitute as needed.)

- [ ] **Step 6: Manual smoke**

Run: `npm run dev` (or the existing dev command). Open the settings modal, scroll to "Experimental", toggle it on — confirm the modal appears with two buttons. Click Cancel — toggle should stay off. Toggle on again, click Enable — toggle should stay on. Save settings. Re-open the modal — toggle should still be on. Toggle off — should switch off without prompting.

- [ ] **Step 7: Typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: settings toggle and confirm for multi-instance launches"
```

---

## Task 14: Manual verification on a real GW2 install

This task is exclusively manual; nothing to write, but the changes shouldn't merge until this is done at least once on Windows.

- [ ] **Step 1: Install and launch the dev build of AxiAM on a Windows machine with GW2**

Build per the existing Windows packaging path. Install from `dist_out/AxiAM Setup <version>.exe`.

- [ ] **Step 2: Walk through the README's manual verification checklist**

Follow `tools/mutex-closer/README.md` § Manual verification checklist, steps 1–3 and 5. (Skip step 4 if you don't have a Linux machine handy; it'll be the first thing m0mentkill3r or another Linux user verifies post-merge.)

- [ ] **Step 3: Record results**

Add a brief note to the PR description: e.g. "Verified all five steps on Windows 11 + GW2 standalone install. Linux not yet tested." Update the spec's status footer if needed.

---

## Self-Review

**Spec coverage:**

- Helper binary requirements (CLI, exit codes, dependencies, build) → Tasks 1–6
- Settings + UX (toggle, first-time confirm, no per-account override) → Task 13
- Launch flow integration (gate, fail-fast, logging) → Task 12
- Packaging (`extraResources`, prebuilt binary committed) → Tasks 6–7
- Linux/Proton wrapping (resolveProtonContext, Steam library detection) → Task 11
- Testing (Rust unit + integration, electron-side unit tests, manual checklist) → Tasks 2, 3, 5, 9–11, 14
- Detection path untouched (per spec: "Detection path unchanged") → confirmed in Task 12 (no edits to `waitForAccountProcess` or `manualAccountPidBindings`)

**Placeholder scan:** none — every code step has full code, no TBD/TODO references.

**Type consistency:**
- `MutexCloserResult` shape `{ ok: boolean; closedCount: number; reason?: string }` is consistent across Tasks 10, 11, 12.
- `ProtonContext` defined in Task 10 and consumed unchanged in Task 11.
- Helper exit codes (0/2/3/4) match across Rust crate (Tasks 3–4), README (Task 6), and JS interpretation (Task 10).
- `allowMultiInstance` is `boolean | undefined` (optional) in the type (Task 8); UI defaults to `false` (Task 13); main process reads via narrowed object access (Task 12). Consistent.

**Spec requirement → task spot-check:**
- "Same Windows .exe runs natively on Windows and under Wine via Proton" → Task 7 (extraResources covers both targets) + Task 11/12 (Proton wrap).
- "Helper has no knowledge of Electron, accounts, or launching" → confirmed by Rust crate scope in Tasks 1–6.
- "Exit code 3 unexpected but log warning and proceed" → currently mapped to `ok: true, closedCount: 0` in Task 10 — equivalent behavior (caller proceeds with spawn). Spec language matches.

No gaps. Plan ready for execution.

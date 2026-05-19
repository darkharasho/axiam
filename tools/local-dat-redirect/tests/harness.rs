//! End-to-end harness for the NtCreateFile redirect hook.
//!
//! What this proves:
//!  1. Loading the DLL into a fresh process installs the hook (DllMain →
//!     `install_from_env`).
//!  2. A `CreateFileW` of `%APPDATA%\Guild Wars 2\Local.dat` actually
//!     returns a handle whose final path on disk is the per-account
//!     redirect target — i.e. the rewrite reached the kernel.
//!  3. Sibling files in the same directory (Gw2.dat-style) are NOT
//!     redirected; they resolve to themselves.
//!
//! All three assertions live in one `#[test]` because:
//!  - MinHook installs hooks process-wide; once installed, subsequent
//!    tests would see a half-loaded state.
//!  - We mutate APPDATA / AXIAM_LOCAL_DAT_PATH which is per-process.
//!  - Cargo runs integration tests in parallel threads by default.
//!
//! Run with `cargo test --release` (or plain `cargo test`).

#![cfg(windows)]

use std::ffi::OsStr;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::ptr;

use windows_sys::Win32::Foundation::{
    CloseHandle, FreeLibrary, GENERIC_READ, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetFinalPathNameByHandleW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, OPEN_ALWAYS,
};
use windows_sys::Win32::System::LibraryLoader::LoadLibraryW;

fn to_wide(s: impl AsRef<OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}

/// Locate the freshly-built DLL. `cargo test` builds the cdylib into
/// `target/<profile>/`; integration tests run with `CARGO_MANIFEST_DIR`
/// set to the crate root. `cfg!(debug_assertions)` tells us which
/// profile the test itself was compiled in, which lines up with the
/// profile cargo built the cdylib under.
fn dll_path() -> PathBuf {
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("target");
    p.push(profile);
    p.push("axiam_local_dat_redirect.dll");
    p
}

/// Return the on-disk final path of an open handle, with the `\\?\` /
/// `\??\` prefix stripped so it can be compared to a plain DOS path.
unsafe fn final_path_of(handle: *mut std::ffi::c_void) -> String {
    let mut buf = vec![0u16; 1024];
    let len = GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), buf.len() as u32, 0);
    assert!(len > 0, "GetFinalPathNameByHandleW failed");
    assert!((len as usize) < buf.len(), "buffer too small for final path");
    let s = std::ffi::OsString::from_wide(&buf[..len as usize])
        .into_string()
        .expect("final path is not valid utf-8");
    s.strip_prefix(r"\\?\")
        .or_else(|| s.strip_prefix(r"\??\"))
        .map(str::to_owned)
        .unwrap_or(s)
}

fn case_eq(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

#[test]
fn nt_create_file_redirect_end_to_end() {
    // ---- Per-run temp layout ----
    let mut temp = std::env::temp_dir();
    temp.push(format!(
        "axiam-harness-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&temp).expect("create temp dir");

    // Fake "APPDATA" — when the DLL reads %APPDATA% it sees this path.
    let appdata = temp.join("appdata");
    let gw2_dir = appdata.join("Guild Wars 2");
    std::fs::create_dir_all(&gw2_dir).expect("create gw2 appdata dir");

    // The host path the game would normally open. Intentionally NOT
    // created on disk — the only way an open of this path can succeed
    // is if the hook rewrites it to the redirect file (which exists).
    let host_local_dat = gw2_dir.join("Local.dat");

    // Per-account redirect target. This is the file the handle should
    // ultimately point at.
    let redirect_file = temp.join("profiles").join("acc-A").join("Local.dat");
    std::fs::create_dir_all(redirect_file.parent().unwrap()).expect("create profile dir");
    std::fs::write(&redirect_file, b"REDIRECT_TARGET").expect("write redirect file");

    // Sibling file — actually on disk, so the open succeeds and we can
    // GetFinalPathNameByHandle it. Should NOT be redirected.
    let sibling = gw2_dir.join("Gw2.dat");
    std::fs::write(&sibling, b"SIBLING_NOT_REDIRECTED").expect("write sibling file");

    // ---- Configure env before loading the DLL ----
    // DllMain reads both env vars in its install_from_env path, so they
    // MUST be set before LoadLibraryW.
    //
    // SAFETY: this test process is single-threaded at this point;
    // env-mutation race conditions don't apply.
    unsafe {
        std::env::set_var("APPDATA", &appdata);
        std::env::set_var("AXIAM_LOCAL_DAT_PATH", &redirect_file);
    }

    // ---- Load the DLL → hook installs ----
    let dll = dll_path();
    assert!(
        dll.exists(),
        "DLL not built at {dll:?} — run `cargo build` first",
    );
    let dll_wide = to_wide(&dll);
    let h_module = unsafe { LoadLibraryW(dll_wide.as_ptr()) };
    assert!(!h_module.is_null(), "LoadLibraryW returned NULL");

    // ---- Open the host path → must hit the redirect ----
    let host_wide = to_wide(&host_local_dat);
    let h_redirected = unsafe {
        CreateFileW(
            host_wide.as_ptr(),
            GENERIC_READ as u32,
            FILE_SHARE_READ,
            ptr::null(),
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            ptr::null_mut(),
        )
    };
    assert!(
        h_redirected != INVALID_HANDLE_VALUE,
        "CreateFileW on host Local.dat failed; hook didn't fire or redirect path is wrong",
    );
    let redirected_final = unsafe { final_path_of(h_redirected) };
    unsafe { CloseHandle(h_redirected) };

    // ---- Open a sibling path → must NOT be redirected ----
    let sibling_wide = to_wide(&sibling);
    let h_sibling = unsafe {
        CreateFileW(
            sibling_wide.as_ptr(),
            GENERIC_READ as u32,
            FILE_SHARE_READ,
            ptr::null(),
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            ptr::null_mut(),
        )
    };
    assert!(
        h_sibling != INVALID_HANDLE_VALUE,
        "CreateFileW on sibling Gw2.dat failed unexpectedly",
    );
    let sibling_final = unsafe { final_path_of(h_sibling) };
    unsafe { CloseHandle(h_sibling) };

    // Unload the DLL so we don't leave the hook installed in the test
    // process if there are later tests (there aren't, but be tidy).
    unsafe { FreeLibrary(h_module) };

    // ---- Assertions ----
    let expected_redirect = redirect_file.to_string_lossy().into_owned();
    assert!(
        case_eq(&redirected_final, &expected_redirect),
        "redirect failed: opening host Local.dat resolved to {redirected_final:?}, expected {expected_redirect:?}",
    );

    let expected_sibling = sibling.to_string_lossy().into_owned();
    assert!(
        case_eq(&sibling_final, &expected_sibling),
        "sibling was wrongly redirected: resolved to {sibling_final:?}, expected {expected_sibling:?}",
    );

    // ---- Cleanup ----
    let _ = std::fs::remove_dir_all(&temp);

    // Quiet unused-import warning on Path under some configurations.
    let _: Option<&Path> = None;
}

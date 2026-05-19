//! axiam-local-dat-redirect
//!
//! DLL injected into `Gw2-64.exe` that hooks `NtCreateFile` and redirects
//! opens of `%APPDATA%\Guild Wars 2\Local.dat` to a per-account file
//! supplied via the `AXIAM_LOCAL_DAT_PATH` environment variable.
//!
//! No-op on non-Windows. No-op when the env var is unset / empty.

#![cfg(windows)]

mod path;

#[cfg(windows)]
mod hook;

use windows_sys::Win32::Foundation::{BOOL, HINSTANCE, TRUE};
use windows_sys::Win32::System::SystemServices::{
    DLL_PROCESS_ATTACH, DLL_PROCESS_DETACH,
};

#[no_mangle]
#[allow(non_snake_case, unused_variables)]
pub extern "system" fn DllMain(
    _hinst: HINSTANCE,
    reason: u32,
    _reserved: *mut core::ffi::c_void,
) -> BOOL {
    match reason {
        DLL_PROCESS_ATTACH => {
            // DllMain runs under the loader lock — keep this minimal.
            // No file I/O, no waits, no allocations beyond what the hook
            // install itself requires.
            let _ = hook::install_from_env();
        }
        DLL_PROCESS_DETACH => {
            let _ = hook::uninstall();
        }
        _ => {}
    }
    TRUE
}

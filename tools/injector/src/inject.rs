//! Spawn-suspended → remote LoadLibraryW → resume orchestration.
//!
//! Standard CreateRemoteThread/LoadLibraryW injection pattern. Works
//! because `kernel32.dll` is mapped at the same base address in every
//! process on the same boot (Windows preserves this for system DLLs),
//! so `LoadLibraryW`'s address in our process is the same as in the
//! freshly-spawned child.

#![cfg(windows)]

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, FALSE, HANDLE, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, CreateRemoteThread, GetExitCodeThread, ResumeThread, TerminateProcess,
    WaitForSingleObject, CREATE_SUSPENDED, DETACHED_PROCESS, PROCESS_INFORMATION, STARTUPINFOW,
};

use crate::args::Args;

const DLL_LOAD_TIMEOUT_MS: u32 = 5000;

fn to_wide_z(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Build a Windows command line from a program path and args. Quotes
/// values that contain spaces or quotes per CommandLineToArgvW rules
/// (good enough for the args GW2 cares about — flag-style with simple
/// values).
fn build_command_line(exe: &str, args: &[String]) -> String {
    let mut s = String::new();
    s.push('"');
    s.push_str(exe);
    s.push('"');
    for a in args {
        s.push(' ');
        if a.contains(' ') || a.contains('"') {
            s.push('"');
            for c in a.chars() {
                if c == '"' {
                    s.push('\\');
                }
                s.push(c);
            }
            s.push('"');
        } else {
            s.push_str(a);
        }
    }
    s
}

pub fn spawn_and_inject(args: &Args) -> Result<u32, String> {
    // The DLL reads AXIAM_LOCAL_DAT_PATH at DllMain time. Since the
    // child will inherit our env block (we pass NULL for lpEnvironment),
    // setting it here is sufficient.
    //
    // SAFETY: the injector is single-threaded when this runs.
    if let Some(local_dat) = &args.local_dat {
        unsafe { std::env::set_var("AXIAM_LOCAL_DAT_PATH", local_dat) };
    }

    let exe_wide = to_wide_z(&args.exe);
    let cmd_line = build_command_line(&args.exe, &args.child_args);
    let mut cmd_line_wide = to_wide_z(&cmd_line);
    let cwd_wide = args.cwd.as_ref().map(|c| to_wide_z(c));

    let mut si: STARTUPINFOW = unsafe { core::mem::zeroed() };
    si.cb = core::mem::size_of::<STARTUPINFOW>() as u32;
    let mut pi: PROCESS_INFORMATION = unsafe { core::mem::zeroed() };

    // DETACHED_PROCESS: the child does not inherit the parent's console.
    // GW2 is a GUI app and doesn't use a console; severing the handle
    // prevents the spawning Electron process (or a PowerShell smoke test)
    // from hanging on the child's stdio.
    let creation_flags = CREATE_SUSPENDED | DETACHED_PROCESS;
    let create_ok = unsafe {
        CreateProcessW(
            exe_wide.as_ptr(),
            cmd_line_wide.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            FALSE,
            creation_flags,
            ptr::null(),
            cwd_wide.as_ref().map_or(ptr::null(), |c| c.as_ptr()),
            &si,
            &mut pi,
        )
    };
    if create_ok == 0 {
        let err = unsafe { GetLastError() };
        return Err(format!(
            "CreateProcessW({}) failed: GetLastError={err}",
            args.exe
        ));
    }

    // From here on, on any error we must TerminateProcess the suspended
    // child to avoid leaving a zombied Gw2-64.exe in memory.
    match inject_dll(&pi, &args.dll) {
        Ok(()) => {
            let resume_result = unsafe { ResumeThread(pi.hThread) };
            if resume_result == u32::MAX {
                // ResumeThread returns -1 (cast to u32) on failure.
                let err = unsafe { GetLastError() };
                unsafe {
                    TerminateProcess(pi.hProcess, 1);
                    CloseHandle(pi.hThread);
                    CloseHandle(pi.hProcess);
                }
                return Err(format!("ResumeThread failed: GetLastError={err}"));
            }
            let pid = pi.dwProcessId;
            unsafe {
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
            }
            Ok(pid)
        }
        Err(e) => {
            unsafe {
                TerminateProcess(pi.hProcess, 1);
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
            }
            Err(e)
        }
    }
}

fn inject_dll(pi: &PROCESS_INFORMATION, dll_path: &str) -> Result<(), String> {
    let dll_wide = to_wide_z(dll_path);
    let bytes_len = dll_wide.len() * 2;

    let remote_buf = unsafe {
        VirtualAllocEx(
            pi.hProcess,
            ptr::null(),
            bytes_len,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        )
    };
    if remote_buf.is_null() {
        let err = unsafe { GetLastError() };
        return Err(format!("VirtualAllocEx failed: GetLastError={err}"));
    }

    let result = (|| -> Result<(), String> {
        let mut written: usize = 0;
        let wpm_ok = unsafe {
            WriteProcessMemory(
                pi.hProcess,
                remote_buf,
                dll_wide.as_ptr() as *const core::ffi::c_void,
                bytes_len,
                &mut written,
            )
        };
        if wpm_ok == 0 || written != bytes_len {
            let err = unsafe { GetLastError() };
            return Err(format!(
                "WriteProcessMemory failed: wrote={written}/{bytes_len}, GetLastError={err}"
            ));
        }

        let kernel32 =
            unsafe { GetModuleHandleW(to_wide_z("kernel32.dll").as_ptr()) };
        if kernel32.is_null() {
            return Err("GetModuleHandleW(kernel32) failed".into());
        }
        let load_lib_raw = unsafe { GetProcAddress(kernel32, b"LoadLibraryW\0".as_ptr()) };
        let Some(load_lib_raw) = load_lib_raw else {
            return Err("GetProcAddress(LoadLibraryW) failed".into());
        };
        // LPTHREAD_START_ROUTINE = Option<unsafe extern "system" fn(*mut c_void) -> u32>.
        // LoadLibraryW = unsafe extern "system" fn(LPCWSTR) -> HMODULE.
        // ABIs match on x64 (single pointer arg, pointer-sized return).
        let start_routine: Option<unsafe extern "system" fn(*mut core::ffi::c_void) -> u32> =
            Some(unsafe { core::mem::transmute(load_lib_raw) });

        let mut tid: u32 = 0;
        let thread: HANDLE = unsafe {
            CreateRemoteThread(
                pi.hProcess,
                ptr::null(),
                0,
                start_routine,
                remote_buf,
                0,
                &mut tid,
            )
        };
        if thread.is_null() {
            let err = unsafe { GetLastError() };
            return Err(format!("CreateRemoteThread failed: GetLastError={err}"));
        }

        let wait_result = unsafe { WaitForSingleObject(thread, DLL_LOAD_TIMEOUT_MS) };
        if wait_result != WAIT_OBJECT_0 {
            unsafe { CloseHandle(thread) };
            return Err(format!(
                "remote LoadLibraryW didn't return in {DLL_LOAD_TIMEOUT_MS}ms: wait={wait_result}"
            ));
        }

        let mut exit_code: u32 = 0;
        let exit_ok = unsafe { GetExitCodeThread(thread, &mut exit_code) };
        unsafe { CloseHandle(thread) };
        if exit_ok == 0 {
            let err = unsafe { GetLastError() };
            return Err(format!("GetExitCodeThread failed: GetLastError={err}"));
        }
        if exit_code == 0 {
            // LoadLibraryW returns NULL/0 on failure.
            return Err("remote LoadLibraryW returned NULL (DLL failed to load)".into());
        }

        Ok(())
    })();

    // Free the remote buffer regardless. Best-effort — failure here
    // doesn't fail the inject.
    let _ = unsafe { VirtualFreeEx(pi.hProcess, remote_buf, 0, MEM_RELEASE) };

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_quoting() {
        let cl = build_command_line(r"C:\gw2\Gw2-64.exe", &[]);
        assert_eq!(cl, r#""C:\gw2\Gw2-64.exe""#);

        let cl = build_command_line(
            r"C:\gw2\Gw2-64.exe",
            &["-mumble".into(), "alt mumble".into(), "-shareArchive".into()],
        );
        assert_eq!(
            cl,
            r#""C:\gw2\Gw2-64.exe" -mumble "alt mumble" -shareArchive"#
        );
    }

    #[test]
    fn command_line_escapes_embedded_quotes() {
        let cl = build_command_line("exe", &[r#"foo"bar"#.into()]);
        assert_eq!(cl, r#""exe" "foo\"bar""#);
    }
}

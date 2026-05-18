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
        if handle.is_null() {
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

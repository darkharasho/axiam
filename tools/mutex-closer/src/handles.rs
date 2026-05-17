#![cfg(windows)]

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows_sys::Win32::Foundation::{
    CloseHandle, DuplicateHandle, DUPLICATE_CLOSE_SOURCE, DUPLICATE_SAME_ACCESS, HANDLE,
    STATUS_INFO_LENGTH_MISMATCH,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

// NtQuerySystemInformation and NtQueryObject aren't in windows-sys — declare manually.
#[repr(C)]
#[derive(Copy, Clone)]
#[allow(dead_code)]
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
    // 64-bit Windows only: ULONG count (4 bytes) + 4 bytes padding = 8 = size_of::<usize>().
    let header_size = std::mem::size_of::<usize>();
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
        let mut dup: HANDLE = std::ptr::null_mut();
        let ok = DuplicateHandle(
            target_process,
            raw_handle as usize as HANDLE,
            GetCurrentProcess(),
            &mut dup,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        );
        if ok == 0 || dup.is_null() {
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
        let mut dup: HANDLE = std::ptr::null_mut();
        let ok = DuplicateHandle(
            target_process,
            raw_handle as usize as HANDLE,
            GetCurrentProcess(),
            &mut dup,
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
        CloseHandle(dup);
        Ok(())
    }
}

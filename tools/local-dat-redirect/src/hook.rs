//! `NtCreateFile` hook that redirects `%APPDATA%\Guild Wars 2\Local.dat`
//! to the path supplied via `AXIAM_LOCAL_DAT_PATH`.
//!
//! ## Strategy
//!
//! `NtCreateFile`'s 3rd parameter is `POBJECT_ATTRIBUTES`, whose
//! `ObjectName` field is a `PUNICODE_STRING`. When the path matches our
//! target we build a replacement `OBJECT_ATTRIBUTES` pointing at the
//! per-account redirect path (in NT form: `\??\<dos-path>`) and pass that
//! to the original `NtCreateFile` via the MinHook trampoline. The caller
//! never sees our buffer — the redirect path is owned by static storage
//! that lives for the life of the process.

#![cfg(windows)]

use core::ffi::c_void;
use core::ptr;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;

use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Win32::Foundation::{HANDLE, NTSTATUS, UNICODE_STRING};
use windows_sys::Win32::Storage::FileSystem::FILE_ACCESS_RIGHTS;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

use crate::path;

/// `IO_STATUS_BLOCK` is laid out as a union of NTSTATUS + Pointer in
/// `windows-sys`, so we re-declare the bits we need.
#[repr(C)]
#[allow(non_camel_case_types, non_snake_case)]
struct IO_STATUS_BLOCK {
    StatusOrPointer: *mut c_void,
    Information: usize,
}

#[allow(non_snake_case)]
type NtCreateFileFn = unsafe extern "system" fn(
    FileHandle: *mut HANDLE,
    DesiredAccess: FILE_ACCESS_RIGHTS,
    ObjectAttributes: *const OBJECT_ATTRIBUTES,
    IoStatusBlock: *mut IO_STATUS_BLOCK,
    AllocationSize: *const i64,
    FileAttributes: u32,
    ShareAccess: u32,
    CreateDisposition: u32,
    CreateOptions: u32,
    EaBuffer: *const c_void,
    EaLength: u32,
) -> NTSTATUS;

use minhook_sys::{
    MH_CreateHook, MH_DisableHook, MH_EnableHook, MH_Initialize, MH_OK, MH_RemoveHook,
    MH_Uninitialize,
};

struct Config {
    /// `%APPDATA%` resolved at DllMain time. Used as-is for the match;
    /// `path::is_local_dat` handles case-insensitive comparison.
    appdata_dir: String,
    /// Per-account redirect target in NT form (`\??\C:\...`), as wide bytes,
    /// NUL-terminated. `UNICODE_STRING.Length` excludes the NUL.
    redirect_nt_wide: Vec<u16>,
}

static CONFIG: OnceLock<Option<Config>> = OnceLock::new();

/// Pointer to the original `NtCreateFile`, written by `MH_CreateHook` and
/// read by the detour to call through the trampoline. `AtomicPtr` so the
/// store in `install_from_env` is visible to subsequent detour calls
/// without unsafe interior mutation.
static ORIGINAL: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

/// Address of the hooked `NtCreateFile`, cached so `uninstall` can pass it
/// back to `MH_RemoveHook` without re-resolving via `GetProcAddress`.
static HOOK_TARGET: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

pub fn install_from_env() -> Result<(), &'static str> {
    let config = load_config();
    let _ = CONFIG.set(config);

    // No env var → don't hook at all. Process behaves like a vanilla GW2.
    if CONFIG.get().and_then(|c| c.as_ref()).is_none() {
        return Ok(());
    }

    let ntdll = unsafe { GetModuleHandleW(wide_z("ntdll.dll").as_ptr()) };
    if ntdll.is_null() {
        return Err("GetModuleHandleW(ntdll) failed");
    }
    let proc = unsafe { GetProcAddress(ntdll, b"NtCreateFile\0".as_ptr()) };
    let Some(target_fn) = proc else {
        return Err("GetProcAddress(NtCreateFile) failed");
    };
    let target = target_fn as *mut c_void;

    unsafe {
        if MH_Initialize() != MH_OK {
            // MH_ERROR_ALREADY_INITIALIZED is fine in theory, but we should
            // never be double-loaded into the same process — fail loudly.
            return Err("MH_Initialize failed");
        }
        let mut original_ptr: *mut c_void = ptr::null_mut();
        if MH_CreateHook(
            target,
            nt_create_file_detour as *mut c_void,
            &mut original_ptr as *mut *mut c_void,
        ) != MH_OK
        {
            let _ = MH_Uninitialize();
            return Err("MH_CreateHook failed");
        }
        ORIGINAL.store(original_ptr, Ordering::Release);
        HOOK_TARGET.store(target, Ordering::Release);
        if MH_EnableHook(target) != MH_OK {
            let _ = MH_RemoveHook(target);
            let _ = MH_Uninitialize();
            ORIGINAL.store(ptr::null_mut(), Ordering::Release);
            HOOK_TARGET.store(ptr::null_mut(), Ordering::Release);
            return Err("MH_EnableHook failed");
        }
    }
    Ok(())
}

pub fn uninstall() -> Result<(), &'static str> {
    let target = HOOK_TARGET.load(Ordering::Acquire);
    if target.is_null() {
        // Never installed — nothing to do.
        return Ok(());
    }
    unsafe {
        let _ = MH_DisableHook(target);
        let _ = MH_RemoveHook(target);
        let _ = MH_Uninitialize();
    }
    ORIGINAL.store(ptr::null_mut(), Ordering::Release);
    HOOK_TARGET.store(ptr::null_mut(), Ordering::Release);
    Ok(())
}

fn load_config() -> Option<Config> {
    let redirect = std::env::var("AXIAM_LOCAL_DAT_PATH").ok()?;
    if redirect.is_empty() {
        return None;
    }
    let appdata = std::env::var("APPDATA").ok()?;
    if appdata.is_empty() {
        return None;
    }
    let nt_form = format!(r"\??\{}", redirect);
    let mut wide: Vec<u16> = nt_form.encode_utf16().collect();
    wide.push(0); // NUL terminator; UNICODE_STRING.Length excludes it.
    Some(Config {
        appdata_dir: appdata,
        redirect_nt_wide: wide,
    })
}

fn wide_z(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(core::iter::once(0)).collect()
}

unsafe fn read_unicode_string(us: &UNICODE_STRING) -> Option<String> {
    if us.Buffer.is_null() || us.Length == 0 {
        return None;
    }
    let len_u16 = (us.Length / 2) as usize;
    let slice = core::slice::from_raw_parts(us.Buffer, len_u16);
    let os: OsString = OsString::from_wide(slice);
    os.into_string().ok()
}

#[allow(clippy::too_many_arguments)]
unsafe extern "system" fn nt_create_file_detour(
    file_handle: *mut HANDLE,
    desired_access: FILE_ACCESS_RIGHTS,
    object_attributes: *const OBJECT_ATTRIBUTES,
    io_status_block: *mut IO_STATUS_BLOCK,
    allocation_size: *const i64,
    file_attributes: u32,
    share_access: u32,
    create_disposition: u32,
    create_options: u32,
    ea_buffer: *const c_void,
    ea_length: u32,
) -> NTSTATUS {
    let original_raw = ORIGINAL.load(Ordering::Acquire);
    let original: NtCreateFileFn = core::mem::transmute(original_raw);

    let Some(Some(config)) = CONFIG.get().map(|c| c.as_ref()) else {
        return original(
            file_handle,
            desired_access,
            object_attributes,
            io_status_block,
            allocation_size,
            file_attributes,
            share_access,
            create_disposition,
            create_options,
            ea_buffer,
            ea_length,
        );
    };

    let path_str = if !object_attributes.is_null() {
        let oa = &*object_attributes;
        if oa.ObjectName.is_null() {
            None
        } else {
            read_unicode_string(&*oa.ObjectName)
        }
    } else {
        None
    };

    let matched = path_str
        .as_deref()
        .map(|p| path::is_local_dat(p, &config.appdata_dir))
        .unwrap_or(false);

    if !matched {
        return original(
            file_handle,
            desired_access,
            object_attributes,
            io_status_block,
            allocation_size,
            file_attributes,
            share_access,
            create_disposition,
            create_options,
            ea_buffer,
            ea_length,
        );
    }

    // Build a replacement OBJECT_ATTRIBUTES whose ObjectName points at
    // our redirect path. The redirect buffer is owned by CONFIG (static
    // for the life of the process), so we don't need to extend its
    // lifetime here.
    let oa_orig = &*object_attributes;
    let wide_len_u16 = config.redirect_nt_wide.len().saturating_sub(1); // excl NUL
    let length_bytes = (wide_len_u16 * 2) as u16;
    let mut new_name = UNICODE_STRING {
        Length: length_bytes,
        MaximumLength: length_bytes + 2,
        Buffer: config.redirect_nt_wide.as_ptr() as *mut u16,
    };
    // Clear RootDirectory: our path is absolute NT form, no parent dir.
    let new_oa = OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: ptr::null_mut(),
        ObjectName: &mut new_name as *mut UNICODE_STRING,
        Attributes: oa_orig.Attributes,
        SecurityDescriptor: oa_orig.SecurityDescriptor,
        SecurityQualityOfService: oa_orig.SecurityQualityOfService,
    };

    original(
        file_handle,
        desired_access,
        &new_oa as *const OBJECT_ATTRIBUTES,
        io_status_block,
        allocation_size,
        file_attributes,
        share_access,
        create_disposition,
        create_options,
        ea_buffer,
        ea_length,
    )
}

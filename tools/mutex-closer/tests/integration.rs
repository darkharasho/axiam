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

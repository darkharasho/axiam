//! Smoke-test fixture for axiam-injector. Spawns, sleeps 30s, exits.
//! Spawned as a target by the smoke test so we have a benign, long-lived
//! GUI-style process to inject the redirect DLL into.

fn main() {
    std::thread::sleep(std::time::Duration::from_secs(30));
}

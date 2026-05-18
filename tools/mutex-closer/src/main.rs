mod args;
#[cfg(windows)]
mod handles;
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
    if closed > 0 {
        std::process::exit(0);
    } else {
        std::process::exit(2);
    }
}

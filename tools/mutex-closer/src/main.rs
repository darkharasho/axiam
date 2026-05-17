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

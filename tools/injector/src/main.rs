mod args;
#[cfg(windows)]
mod inject;

/// Exit codes (mirror axiam-mutex-closer):
///   0  success — PID printed to stdout
///   2  reserved
///   3  reserved
///   4  argument error or Win32 failure
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
        eprintln!("axiam-injector only runs on Windows");
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
    match inject::spawn_and_inject(&parsed) {
        Ok(pid) => {
            if parsed.json {
                println!("{{\"pid\":{pid}}}");
            } else {
                println!("{pid}");
            }
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("inject failed: {e}");
            std::process::exit(4);
        }
    }
}

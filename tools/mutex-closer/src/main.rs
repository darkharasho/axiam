mod args;

fn main() {
    let parsed = match args::parse(std::env::args().skip(1)) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("argument error: {e}");
            std::process::exit(4);
        }
    };
    // For now just echo what was parsed.
    eprintln!("parsed: process_name={} mutex_name={} pid={:?} json={}",
        parsed.process_name, parsed.mutex_name, parsed.pid, parsed.json);
    std::process::exit(3); // no targets found
}

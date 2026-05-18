#[derive(Debug, PartialEq)]
pub struct Args {
    pub process_name: String,
    pub mutex_name: String,
    pub pid: Option<u32>,
    pub json: bool,
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Args, String> {
    let mut process_name: Option<String> = None;
    let mut mutex_name: Option<String> = None;
    let mut pid: Option<u32> = None;
    let mut json = false;
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--process-name" => process_name = Some(it.next().ok_or("--process-name needs a value")?),
            "--mutex-name" => mutex_name = Some(it.next().ok_or("--mutex-name needs a value")?),
            "--pid" => {
                let v = it.next().ok_or("--pid needs a value")?;
                pid = Some(v.parse::<u32>().map_err(|e| format!("--pid: {e}"))?);
            }
            "--json" => json = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args {
        process_name: process_name.ok_or("--process-name required")?,
        mutex_name: mutex_name.ok_or("--mutex-name required")?,
        pid,
        json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_required_flags() {
        let result = parse(args(&["--process-name", "Gw2-64.exe", "--mutex-name", "AN-Mutex"]).into_iter()).unwrap();
        assert_eq!(result.process_name, "Gw2-64.exe");
        assert_eq!(result.mutex_name, "AN-Mutex");
        assert_eq!(result.pid, None);
        assert!(!result.json);
    }

    #[test]
    fn parses_pid_and_json() {
        let result = parse(args(&[
            "--process-name", "X", "--mutex-name", "Y",
            "--pid", "1234", "--json",
        ]).into_iter()).unwrap();
        assert_eq!(result.pid, Some(1234));
        assert!(result.json);
    }

    #[test]
    fn errors_on_missing_required() {
        assert!(parse(args(&["--process-name", "X"]).into_iter()).is_err());
    }

    #[test]
    fn errors_on_unknown_flag() {
        assert!(parse(args(&["--bogus"]).into_iter()).is_err());
    }
}

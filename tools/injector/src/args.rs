#[derive(Debug, PartialEq)]
pub struct Args {
    /// Absolute path to the target executable (e.g. Gw2-64.exe).
    pub exe: String,
    /// Working directory for the child. If None, the child inherits ours.
    pub cwd: Option<String>,
    /// Absolute path to the DLL to inject (axiam-local-dat-redirect.dll).
    pub dll: String,
    /// Value for the `AXIAM_LOCAL_DAT_PATH` env var the child sees. When
    /// None, the child still inherits any env var set in the parent.
    pub local_dat: Option<String>,
    /// Repeatable `--arg`s, appended to the child's command line in order.
    /// Quoting/escaping happens internally.
    pub child_args: Vec<String>,
    /// Emit the PID as `{"pid":N}` on stdout instead of a bare integer.
    pub json: bool,
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Args, String> {
    let mut exe: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut dll: Option<String> = None;
    let mut local_dat: Option<String> = None;
    let mut child_args: Vec<String> = Vec::new();
    let mut json = false;
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--exe" => exe = Some(it.next().ok_or("--exe needs a value")?),
            "--cwd" => cwd = Some(it.next().ok_or("--cwd needs a value")?),
            "--dll" => dll = Some(it.next().ok_or("--dll needs a value")?),
            "--local-dat" => local_dat = Some(it.next().ok_or("--local-dat needs a value")?),
            "--arg" => child_args.push(it.next().ok_or("--arg needs a value")?),
            "--json" => json = true,
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args {
        exe: exe.ok_or("--exe required")?,
        cwd,
        dll: dll.ok_or("--dll required")?,
        local_dat,
        child_args,
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
        let r = parse(args(&["--exe", "C:\\gw2\\Gw2-64.exe", "--dll", "C:\\axiam\\redirect.dll"])).unwrap();
        assert_eq!(r.exe, "C:\\gw2\\Gw2-64.exe");
        assert_eq!(r.dll, "C:\\axiam\\redirect.dll");
        assert_eq!(r.cwd, None);
        assert_eq!(r.local_dat, None);
        assert!(r.child_args.is_empty());
        assert!(!r.json);
    }

    #[test]
    fn collects_repeated_args_in_order() {
        let r = parse(args(&[
            "--exe", "x", "--dll", "y",
            "--arg", "-mumble", "--arg", "alt-mumble",
            "--arg", "-shareArchive",
        ])).unwrap();
        assert_eq!(r.child_args, vec!["-mumble", "alt-mumble", "-shareArchive"]);
    }

    #[test]
    fn parses_optional_cwd_local_dat_json() {
        let r = parse(args(&[
            "--exe", "x", "--dll", "y",
            "--cwd", "C:\\gw2",
            "--local-dat", "C:\\axiam\\profiles\\acc\\Local.dat",
            "--json",
        ])).unwrap();
        assert_eq!(r.cwd.as_deref(), Some("C:\\gw2"));
        assert_eq!(r.local_dat.as_deref(), Some("C:\\axiam\\profiles\\acc\\Local.dat"));
        assert!(r.json);
    }

    #[test]
    fn errors_on_missing_required() {
        assert!(parse(args(&["--exe", "x"])).is_err());
        assert!(parse(args(&["--dll", "y"])).is_err());
    }

    #[test]
    fn errors_on_unknown_flag() {
        assert!(parse(args(&["--bogus"])).is_err());
    }

    #[test]
    fn errors_when_value_missing() {
        assert!(parse(args(&["--exe"])).is_err());
        assert!(parse(args(&["--arg"])).is_err());
    }
}

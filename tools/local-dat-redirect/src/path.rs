//! Path-matching helpers for the Local.dat redirect.
//!
//! These are intentionally pure functions so they can be unit-tested on
//! any platform without a Windows host.

/// Normalize a Win32/NT path for comparison: strip a leading `\??\` or
/// `\\?\`, lowercase ASCII, replace `/` with `\`.
///
/// We don't try to resolve `\Device\HarddiskVolumeN\` here — those forms
/// only appear from kernel callers, not from GW2's user-mode opens.
/// If a real trace shows otherwise we can extend this later.
pub fn normalize(input: &str) -> String {
    let mut s = input;
    for prefix in [r"\??\", r"\\?\", r"\\.\"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest;
            break;
        }
    }
    s.chars()
        .map(|c| {
            let c = if c == '/' { '\\' } else { c };
            c.to_ascii_lowercase()
        })
        .collect()
}

/// True iff `candidate` refers to `%APPDATA%\Guild Wars 2\Local.dat`
/// for the given `appdata_dir`. Case-insensitive, NT-prefix tolerant.
pub fn is_local_dat(candidate: &str, appdata_dir: &str) -> bool {
    let n_candidate = normalize(candidate);
    let n_target = normalize(&format!(r"{}\Guild Wars 2\Local.dat", appdata_dir));
    n_candidate == n_target
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_nt_prefix() {
        assert_eq!(normalize(r"\??\C:\foo"), r"c:\foo");
        assert_eq!(normalize(r"\\?\C:\foo"), r"c:\foo");
        assert_eq!(normalize(r"\\.\C:\foo"), r"c:\foo");
    }

    #[test]
    fn normalize_passthrough_for_plain_dos_path() {
        assert_eq!(normalize(r"C:\Users\me\file.dat"), r"c:\users\me\file.dat");
    }

    #[test]
    fn normalize_case_and_slashes() {
        assert_eq!(normalize(r"C:/Users/Me/File.DAT"), r"c:\users\me\file.dat");
    }

    #[test]
    fn matches_with_nt_prefix() {
        let appdata = r"C:\Users\me\AppData\Roaming";
        let cand = r"\??\C:\Users\me\AppData\Roaming\Guild Wars 2\Local.dat";
        assert!(is_local_dat(cand, appdata));
    }

    #[test]
    fn matches_with_mixed_case() {
        let appdata = r"C:\Users\me\AppData\Roaming";
        let cand = r"C:\USERS\ME\APPDATA\ROAMING\guild wars 2\LOCAL.DAT";
        assert!(is_local_dat(cand, appdata));
    }

    #[test]
    fn does_not_match_sibling_files() {
        let appdata = r"C:\Users\me\AppData\Roaming";
        let cand = r"C:\Users\me\AppData\Roaming\Guild Wars 2\Gw2.dat";
        assert!(!is_local_dat(cand, appdata));
    }

    #[test]
    fn does_not_match_other_app() {
        let appdata = r"C:\Users\me\AppData\Roaming";
        let cand = r"C:\Users\me\AppData\Roaming\OtherApp\Local.dat";
        assert!(!is_local_dat(cand, appdata));
    }
}

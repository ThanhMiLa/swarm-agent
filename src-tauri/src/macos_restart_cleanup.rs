//! Remove the obsolete restart job submitted by the local macOS 0.1.0 install.
//! launchd kept it alive, so it opened the app every 45 seconds.

use std::io;
use std::process::{Command, Stdio};

const LEGACY_JOB: &str = "com.swarm-agent.local-restart-v0-1-0";

/// Best-effort, on GUI startup only. Don't block the window or restart the app.
pub fn start() {
    tauri::async_runtime::spawn_blocking(|| {
        if let Err(error) = remove_legacy_job(|action, label| {
            Command::new("/bin/launchctl")
                .args([action, label])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
        }) {
            eprintln!("macOS restart cleanup: {error}");
        }
    });
}

fn remove_legacy_job(mut launchctl: impl FnMut(&str, &str) -> io::Result<bool>) -> io::Result<()> {
    // Check the exact label in the current login session. On later startups,
    // and on machines that never had the job, there is nothing to remove.
    if launchctl("list", LEGACY_JOB)? && !launchctl("remove", LEGACY_JOB)? {
        return Err(io::Error::other(format!("could not remove {LEGACY_JOB}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_the_legacy_job_if_present() {
        let mut calls = Vec::new();
        remove_legacy_job(|action, label| {
            assert_eq!(label, "com.swarm-agent.local-restart-v0-1-0");
            calls.push(action.to_owned());
            Ok(true)
        })
        .unwrap();
        assert_eq!(calls, ["list", "remove"]);
    }

    #[test]
    fn leaves_launchd_unchanged_if_the_job_is_absent() {
        remove_legacy_job(|action, label| {
            assert_eq!(action, "list");
            assert_eq!(label, LEGACY_JOB);
            Ok(false)
        })
        .unwrap();
    }

    #[test]
    fn reports_a_failed_removal() {
        let result = remove_legacy_job(|action, _| Ok(action == "list"));
        assert!(result.is_err());
    }
}

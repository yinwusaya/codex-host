#[cfg(target_os = "macos")]
use std::env;
use std::error::Error;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use codexhost_platform::configure_background_command;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::request::validate_version;
use crate::request::{
    Installation, MacOsInstallation, NpmInstallation, UpdateRequest, WindowsInstallation,
};
#[cfg(target_os = "macos")]
use crate::status::unix_seconds;

const NPM_PACKAGE_NAME: &str = "@codexhost/cli";
const DISTRIBUTION_FILE: &str = "codexhost-distribution.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DistributionMetadata {
    schema_version: u8,
    version: String,
    distribution: String,
    target: String,
    #[serde(default, rename = "repository")]
    _repository: Option<String>,
    #[serde(default, rename = "commit")]
    _commit: Option<String>,
}

fn sha256_file(path: &Path) -> Result<String, Box<dyn Error>> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn verify_artifact(path: &Path, expected: &str) -> Result<(), Box<dyn Error>> {
    let actual = sha256_file(path)?;
    if actual != expected {
        return Err(
            format!("update artifact SHA-256 mismatch: expected {expected}, got {actual}").into(),
        );
    }
    Ok(())
}

fn distribution_metadata(path: &Path) -> Result<DistributionMetadata, Box<dyn Error>> {
    let metadata = serde_json::from_slice::<DistributionMetadata>(&fs::read(path)?)?;
    if metadata.schema_version != 1 || metadata.target.is_empty() {
        return Err("installed distribution metadata is invalid".into());
    }
    validate_version(&metadata.version)?;
    Ok(metadata)
}

fn verify_distribution(
    path: &Path,
    version: &str,
    expected_distribution: &str,
) -> Result<(), Box<dyn Error>> {
    let metadata = distribution_metadata(path)?;
    if metadata.version != version || metadata.distribution != expected_distribution {
        return Err(format!(
            "installed distribution metadata does not match {expected_distribution} {version}"
        )
        .into());
    }
    Ok(())
}

fn run_checked(command: &mut Command, label: &str) -> Result<(), Box<dyn Error>> {
    let status = command.status()?;
    if !status.success() {
        return Err(format!("{label} failed with {status}").into());
    }
    Ok(())
}

fn npm_prefix(package_root: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let modules = package_root
        .parent()
        .and_then(Path::parent)
        .ok_or("invalid npm package root")?;
    if modules.file_name().and_then(|name| name.to_str()) != Some("node_modules") {
        return Err("npm platform package is not in a global node_modules directory".into());
    }
    let parent = modules
        .parent()
        .ok_or("npm installation prefix is unavailable")?;
    if cfg!(target_os = "windows") {
        Ok(parent.to_path_buf())
    } else if parent.file_name().and_then(|name| name.to_str()) == Some("lib") {
        Ok(parent
            .parent()
            .ok_or("npm installation prefix is unavailable")?
            .to_path_buf())
    } else {
        Err("npm global node_modules must be under the installation prefix's lib directory".into())
    }
}

fn npm_install_command(
    request: &UpdateRequest,
    npm: &NpmInstallation,
) -> Result<Command, Box<dyn Error>> {
    let mut command = Command::new(&npm.node_path);
    command
        .arg(&npm.npm_cli_path)
        .args(["install", "--global", "--no-audit", "--no-fund", "--prefix"])
        .arg(npm_prefix(
            npm.npm_launcher_path
                .parent()
                .and_then(Path::parent)
                .ok_or("npm CLI package root is unavailable")?,
        )?);
    if let Some(artifacts) = &npm.artifacts {
        verify_artifact(&artifacts.cli_path, &artifacts.cli_sha256)?;
        verify_artifact(&artifacts.platform_path, &artifacts.platform_sha256)?;
        command
            .arg("--omit=optional")
            .arg(&artifacts.cli_path)
            .arg(&artifacts.platform_path);
    } else {
        command.arg(format!("{NPM_PACKAGE_NAME}@{}", request.version));
    }
    Ok(command)
}

fn install_npm(request: &UpdateRequest, npm: &NpmInstallation) -> Result<(), Box<dyn Error>> {
    let mut command = npm_install_command(request, npm)?;
    // The installer runs this step itself for an EXE install. npm does not, so close
    // what still runs from the platform package (for example a Shim the stopped
    // Desktop left behind) before npm replaces those locked executables. The shared
    // Node runtime is not a target.
    #[cfg(target_os = "windows")]
    crate::prepare_install::prepare(&npm.npm_package_root)?;
    configure_background_command(&mut command);
    if let Some(log) = operation_log(request, "npm-install.log") {
        command.stdout(log.try_clone()?).stderr(log);
    }
    run_checked(&mut command, "npm update")
}

fn refresh_npm_package_root(request: &mut UpdateRequest) -> Result<(), Box<dyn Error>> {
    let Installation::Npm(npm) = &mut request.installation else {
        return Ok(());
    };
    if npm.artifacts.is_none() {
        return Ok(());
    }
    let scope = npm
        .npm_launcher_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or("npm CLI package scope is unavailable")?;
    let root = scope.join(
        npm.npm_package_root
            .file_name()
            .ok_or("npm platform package name is unavailable")?,
    );
    verify_distribution(
        &root.join("app").join(DISTRIBUTION_FILE),
        &request.version,
        "npm",
    )?;
    // Explicit global tarballs replace an optional payload previously nested inside the CLI.
    npm.npm_package_root = root;
    Ok(())
}

/// A diagnostic log beside the operation status; updates proceed without it.
fn operation_log(request: &UpdateRequest, name: &str) -> Option<File> {
    File::create(request.status_path.parent()?.join(name)).ok()
}

#[cfg(target_os = "windows")]
fn install_windows(
    request: &UpdateRequest,
    windows: &WindowsInstallation,
) -> Result<(), Box<dyn Error>> {
    verify_artifact(&windows.installer_path, &windows.artifact_sha256)?;
    // Close the console, Node, Shim and Launcher still running from this
    // installation. Installers released before `prepare-install` do not, and
    // Inno aborts a silent install when Restart Manager cannot close them.
    crate::prepare_install::prepare(&windows.install_root)?;
    let mut command = Command::new(&windows.installer_path);
    command.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"]);
    // Keep the running installation's directory, and leave Inno's log beside the
    // operation status for diagnosis.
    let mut directory = std::ffi::OsString::from("/DIR=");
    directory.push(&windows.install_root);
    command.arg(directory);
    if let Some(operation) = request.status_path.parent() {
        let mut log = std::ffi::OsString::from("/LOG=");
        log.push(operation.join("installer.log"));
        command.arg(log);
    }
    configure_background_command(&mut command);
    run_checked(&mut command, "Windows installer")?;
    verify_distribution(
        &windows.install_root.join("app").join(DISTRIBUTION_FILE),
        &request.version,
        "installer",
    )
}

#[cfg(not(target_os = "windows"))]
fn install_windows(
    _request: &UpdateRequest,
    _windows: &WindowsInstallation,
) -> Result<(), Box<dyn Error>> {
    Err("Windows installer updates require Windows".into())
}

#[cfg(target_os = "macos")]
fn install_macos(request: &UpdateRequest, macos: &MacOsInstallation) -> Result<(), Box<dyn Error>> {
    verify_artifact(&macos.dmg_path, &macos.artifact_sha256)?;
    let parent = macos
        .app_path
        .parent()
        .ok_or("macOS application path has no parent")?;
    let unique = format!("{}-{}", std::process::id(), unix_seconds());
    let mount = env::temp_dir().join(format!("codexhost-update-mount-{unique}"));
    let staged = parent.join(format!(".codexhost-update-{unique}.app"));
    let backup = parent.join(format!(".codexhost-backup-{unique}.app"));
    fs::create_dir_all(&mount)?;
    if staged.exists() || backup.exists() {
        return Err("macOS update staging path already exists".into());
    }
    let attach_result = run_checked(
        Command::new("/usr/bin/hdiutil")
            .args(["attach", "-nobrowse", "-readonly", "-mountpoint"])
            .arg(&mount)
            .arg(&macos.dmg_path),
        "macOS DMG mount",
    );
    if let Err(error) = attach_result {
        let _ = fs::remove_dir_all(&mount);
        return Err(error);
    }

    let prepare_result = (|| -> Result<(), Box<dyn Error>> {
        let source = mount.join("codexhost.app");
        if !source.is_dir() {
            return Err("macOS DMG does not contain codexhost.app".into());
        }
        run_checked(
            Command::new("/usr/bin/ditto").arg(&source).arg(&staged),
            "macOS application staging",
        )?;
        verify_distribution(
            &staged
                .join("Contents")
                .join("Resources")
                .join("app")
                .join(DISTRIBUTION_FILE),
            &request.version,
            "installer",
        )?;
        run_checked(
            Command::new("/usr/bin/codesign")
                .args(["--verify", "--deep", "--strict"])
                .arg(&staged),
            "macOS application integrity check",
        )
    })();
    let detach_result = run_checked(
        Command::new("/usr/bin/hdiutil").arg("detach").arg(&mount),
        "macOS DMG detach",
    );
    let _ = fs::remove_dir_all(&mount);
    if let Err(error) = prepare_result {
        let _ = fs::remove_dir_all(&staged);
        return Err(error);
    }
    detach_result?;

    fs::rename(&macos.app_path, &backup)?;
    if let Err(error) = fs::rename(&staged, &macos.app_path) {
        let _ = fs::rename(&backup, &macos.app_path);
        return Err(format!("could not activate updated macOS application: {error}").into());
    }
    if let Err(error) = verify_distribution(
        &macos
            .app_path
            .join("Contents")
            .join("Resources")
            .join("app")
            .join(DISTRIBUTION_FILE),
        &request.version,
        "installer",
    ) {
        let _ = fs::remove_dir_all(&macos.app_path);
        let _ = fs::rename(&backup, &macos.app_path);
        return Err(error);
    }
    fs::remove_dir_all(backup)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn install_macos(
    _request: &UpdateRequest,
    _macos: &MacOsInstallation,
) -> Result<(), Box<dyn Error>> {
    Err("macOS DMG updates require macOS".into())
}

pub(crate) fn install(request: &mut UpdateRequest) -> Result<(), Box<dyn Error>> {
    match &request.installation {
        Installation::Npm(npm) => install_npm(request, npm),
        Installation::WindowsInstaller(windows) => install_windows(request, windows),
        Installation::MacosDmg(macos) => install_macos(request, macos),
    }?;
    refresh_npm_package_root(request)
}

#[cfg(all(test, any(target_os = "windows", target_os = "macos")))]
mod tests {
    use super::DistributionMetadata;

    #[test]
    fn distribution_metadata_rejects_unknown_fields() {
        let metadata = br#"{"schemaVersion":1,"version":"1.2.3","distribution":"npm","target":"macos-arm64","extra":true}"#;
        assert!(serde_json::from_slice::<DistributionMetadata>(metadata).is_err());
    }
}

#[cfg(test)]
mod npm_tests {
    use super::{
        npm_install_command, npm_prefix, refresh_npm_package_root, sha256_file, verify_artifact,
    };
    use crate::request::{Installation, NpmInstallation, UpdateRequest};
    use serde_json::json;

    #[test]
    fn preserves_the_prefix_of_the_installed_platform_package() {
        let prefix = std::env::temp_dir().join("codexhost-prefix");
        let modules = if cfg!(target_os = "windows") {
            prefix.join("node_modules")
        } else {
            prefix.join("lib/node_modules")
        };
        assert_eq!(
            npm_prefix(&modules.join("@codexhost/cli-linux-x64")).unwrap(),
            prefix
        );
        assert!(npm_prefix(&prefix.join("not-a-global-install")).is_err());
    }

    #[test]
    fn rejects_tampered_npm_artifacts() {
        assert!(verify_artifact(&std::env::current_exe().unwrap(), &"00".repeat(32)).is_err());
    }

    #[test]
    fn restarts_from_the_verified_global_payload_after_a_nested_package_upgrade() {
        let prefix =
            std::env::temp_dir().join(format!("codexhost-npm-relocate-{}", std::process::id()));
        let scope = prefix.join("node_modules/@codexhost");
        let cli_root = scope.join("cli");
        let root = scope.join("cli-linux-x64");
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(root.join("app/codexhost-distribution.json"), serde_json::to_vec(&json!({
            "schemaVersion": 1, "version": "1.2.3", "distribution": "npm", "target": "linux-x64",
            "repository": "yinwusaya/codex-host", "commit": "a".repeat(40),
        })).unwrap()).unwrap();
        let mut request: UpdateRequest = serde_json::from_value(json!({
            "schema_version": 1, "version": "1.2.3", "wait_pid": 1,
            "wait_executable": "unused", "runtime_descriptor_path": "unused", "status_path": "unused",
            "installation": { "kind": "npm", "node_path": "unused", "npm_cli_path": "unused",
                "npm_launcher_path": cli_root.join("bin/codexhost.js"),
                "npm_package_root": cli_root.join("node_modules/@codexhost/cli-linux-x64"),
                "artifacts": { "cli_path": "unused", "cli_sha256": "unused", "platform_path": "unused", "platform_sha256": "unused" },
            },
        })).unwrap();
        let old_root = request.installation.resources_root();
        request.version = "1.2.4".into();
        assert!(refresh_npm_package_root(&mut request).is_err());
        assert_eq!(request.installation.resources_root(), old_root);
        request.version = "1.2.3".into();
        refresh_npm_package_root(&mut request).unwrap();
        assert_eq!(request.installation.resources_root(), root);
        assert_eq!(
            request.installation.launcher_path(),
            root.join("bin")
                .join(format!("codexhost{}", std::env::consts::EXE_SUFFIX))
        );
        std::fs::remove_dir_all(prefix).unwrap();
    }

    #[test]
    fn installs_verified_tarballs_at_the_cli_prefix_even_with_a_nested_platform_package() {
        let prefix = std::env::temp_dir().join("codexhost-custom-prefix");
        let modules = if cfg!(target_os = "windows") {
            prefix.join("node_modules")
        } else {
            prefix.join("lib/node_modules")
        };
        let cli_root = modules.join("@codexhost/cli");
        let artifact = std::env::current_exe().unwrap();
        let digest = sha256_file(&artifact).unwrap();
        let npm: NpmInstallation = serde_json::from_value(json!({
            "node_path": "node",
            "npm_cli_path": "npm-cli.js",
            "npm_launcher_path": cli_root.join("bin/codexhost.js"),
            "npm_package_root": cli_root.join("node_modules/@codexhost/cli-linux-x64"),
            "artifacts": {
                "cli_path": artifact, "cli_sha256": digest,
                "platform_path": artifact, "platform_sha256": digest,
            },
        }))
        .unwrap();
        let request = UpdateRequest {
            schema_version: 1,
            version: "1.2.3".into(),
            wait_pid: 1,
            wait_executable: artifact.clone(),
            runtime_descriptor_path: artifact.clone(),
            restart_target: Default::default(),
            data_directory: None,
            service_managed: false,
            status_path: artifact.clone(),
            installation: Installation::Npm(npm),
        };
        let Installation::Npm(npm) = &request.installation else {
            unreachable!()
        };
        let command = npm_install_command(&request, npm).unwrap();
        let args = command
            .get_args()
            .map(|arg| arg.to_os_string())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            vec![
                "npm-cli.js".into(),
                "install".into(),
                "--global".into(),
                "--no-audit".into(),
                "--no-fund".into(),
                "--prefix".into(),
                prefix.into_os_string(),
                "--omit=optional".into(),
                artifact.clone().into_os_string(),
                artifact.into_os_string(),
            ]
        );
    }
}

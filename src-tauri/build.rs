fn main() {
    // tauri_build embeds the bundle icons into the binary (they become the
    // default window icon, and on macOS the Dock icon in `tauri dev`, which
    // runs an unbundled executable). Cargo only reruns a build script when
    // something it was told to watch changes, and tauri_build does not declare
    // the icon directory — so regenerating icons alone leaves a stale icon
    // compiled in, with nothing in the build output to say so.
    println!("cargo:rerun-if-changed=icons");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        // Embed the Windows Common Controls v6 manifest via linker flags so
        // `cargo test` harnesses also receive it (tauri-build only embeds its
        // default manifest into the main binary, causing 0xc0000139 on tests).
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
        let manifest = std::path::Path::new(&manifest_dir).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run tauri-build");
    } else {
        tauri_build::build();
    }
}

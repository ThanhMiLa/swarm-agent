# Releasing SwarmAgent for Windows

SwarmAgent ships as an NSIS installer (`SwarmAgent_<version>_x64-setup.exe`),
built locally on a Windows machine. The build is **deliberately unsigned** —
see the SmartScreen section for what users see and why that is acceptable for
now. The updater artifact is the installer itself plus a minisign signature;
auto-update security never depended on Windows code signing.

The overall flow (bump → tag → build → publish) lives in
[release-process.md](release-process.md).

## One-time setup

1. **Rust (MSVC):** install from https://rustup.rs — accept the default
   `x86_64-pc-windows-msvc` toolchain.
2. **Visual Studio Build Tools** with the *Desktop development with C++*
   workload (the linker and Windows SDK Tauri needs).
3. **Node 20+** and `npm`.
4. **GitHub CLI:** `winget install GitHub.cli`, then `gh auth login`
   (the publish step drives `gh`).
5. **The updater signing key:** copy `swarm-agent-updater.key` from the mac's
   `~/Developer/apple-signing/` over a private channel (USB stick — never the
   repo, never a chat upload). Keep it outside the repo checkout.
6. Clone the repo, `npm install`, then:

   ```powershell
   Copy-Item .env.release.example .env.release   # gitignored
   ```

   Fill in only the two updater variables (Windows paths):

   ```
   TAURI_SIGNING_PRIVATE_KEY=C:\Users\<you>\secrets\swarm-agent-updater.key
   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<from swarm-agent-updater.key.password>
   ```

   The Apple variables stay empty on this machine.

## Releasing

```powershell
npm run release:win        # NSIS installer + updater .sig, with assertions
npm run release:publish    # upload to the shared draft release
```

The build script dies early with a named fix if the signing key is missing,
and asserts afterwards that both the installer and its `.sig` exist and carry
the version from `tauri.conf.json`. Output lands in
`src-tauri\target\release\bundle\nsis\`.

To sanity-check the installer locally: run it (per-user install, no admin
prompt), launch SwarmAgent, then uninstall via Settings → Apps.

## Manual unsigned build (no auto-updater)

To build an unsigned `SwarmAgent_<version>_x64-setup.exe` without setting up
updater signing keys (matching manual macOS DMG releases):

- **Locally on Windows:** run `npx tauri build --bundles nsis` (requires Rust,
  VS Build Tools C++, and `npm install`).
- **Via GitHub Actions:** [`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml)
  builds `SwarmAgent_<version>_x64-setup.exe` on `windows-latest` and attaches
  it to the matching `v<version>` GitHub Release automatically on `v*` tag
  pushes (or on `main` pushes when that release exists without the Windows
  installer). You can also run it manually from the Actions tab
  (`workflow_dispatch`).

## SmartScreen: what unsigned means

Windows does not block unsigned apps under standard SmartScreen — it warns. A
user downloading the installer sees **"Windows protected your PC"** with the
publisher listed as *Unknown*. The path through is **More info → Run anyway**;
the browser may add its own "keep file?" step before that.

> **Windows 11 Smart App Control:** If a user's machine has **Smart App Control**
> set to **On**, Windows blocks unsigned installers outright without a *Run
> anyway* option until Smart App Control is turned **Off** in *Windows Security
> → App & browser control → Smart App Control settings* (or the installer is
> Authenticode-signed).

Put a line like this in every release's notes:

> Windows: the installer is not code-signed yet. SmartScreen will warn —
> click **More info**, then **Run anyway**.

Two things worth knowing:

- The **auto-updater never re-triggers SmartScreen** — the plugin verifies
  the minisign signature and runs the installer itself (passive mode), so the
  warning is a first-install experience only.
- Buying an Authenticode certificate later slots into `release-windows.ps1`
  as an extra signing step and changes nothing else in the pipeline — the
  updater trust chain is independent of it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `link.exe not found` / C++ toolchain errors | VS Build Tools missing the C++ workload | re-run the Build Tools installer, add *Desktop development with C++* |
| script dies: `TAURI_SIGNING_PRIVATE_KEY is unset` | `.env.release` missing or empty | copy `.env.release.example`, fill the two updater vars |
| build succeeds but no `.sig` beside the installer | key env vars not visible to the build | run through `npm run release:win` (it loads `.env.release`), not `tauri build` directly |
| `gh: not authenticated` from publish | `gh auth login` never ran on this machine | run it once; the token persists |
| installer runs but app won't start | WebView2 missing (rare — NSIS bundles the bootstrapper) | install the WebView2 Evergreen runtime from Microsoft |

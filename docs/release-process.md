# Releasing SwarmAgent

Start here. Platform specifics live in [release-macos.md](release-macos.md)
and [release-windows.md](release-windows.md); this page is the flow that ties
the two machines together and the rules that keep auto-update working.

## Manual macOS releases

SwarmAgent 0.0.2 ships as an Apple Silicon DMG for manual installation, like
0.0.1. Build the app on Apple Silicon with `npm run tauri build -- --bundles app`,
sign the bundle ad hoc, and verify its signature and version before packaging
it into a DMG. Publish the DMG with the version tag and the matching changelog
entry. Mention the architecture and ad-hoc signature in the release notes.

Use the full release flow below when distributing signed auto-updates. Once
the repository serves an updater manifest, keep it available on the latest
release.

## The five steps

```
[Mac]                                    [Windows]
1. npm run bump -- 0.2.0
   → package.json, Cargo.toml, Cargo.lock, tauri.conf.json
   → commit
2. git tag v0.2.0 && git push origin v0.2.0
3. npm run release:mac                   3. npm run release:win
   → .dmg (new installs)                    → SwarmAgent_0.2.0_x64-setup.exe
   → SwarmAgent.app.tar.gz + .sig            → …setup.exe.sig
4. npm run release:publish               4. npm run release:publish
        └──────────► draft release "v0.2.0" ◄──────────┘
5. npm run release:publish -- --publish   (either machine; refuses while any
   → the draft goes public                 platform is missing)
```

The **GitHub draft release is the transfer medium** — the two machines never
copy files to each other. `release:publish` uploads whatever the local build
produced (`--clobber`, so re-runs are harmless), then reassembles
`latest.json` from every asset currently on the draft. Run it from either
machine, in either order, as many times as you like — while the release is a
draft. Once it is published the script refuses to touch it; pass
`-- --live` only to deliberately repair a live release. (The refusal exists
because a failed `git pull` once left a build machine on the previous
version, and its `release:publish` clobbered the already-shipped installer.)

Drafts are inherently safe: the updater endpoint
`releases/latest/download/latest.json` only resolves against **published**
releases, so installed apps cannot see a half-assembled draft. The
`--publish` flag is the single go-live switch, and it refuses to fire until
all three platform entries exist.

Release notes: write them on the draft's GitHub page (or `gh release edit`)
any time before publishing — every `release:publish` run copies the current
body into `latest.json`, including the `--publish` run itself.

## The updater signing key

Updates are trusted via **minisign**, not via Apple/Windows code signing.
Release scripts sign updater artifacts with the private key and embed the
matching `SWARM_AGENT_UPDATER_PUBLIC_KEY` from `.env.release`. Development
builds have no updater endpoint.

- Private key: `~/Developer/apple-signing/swarm-agent-updater.key`
- Its password: `~/Developer/apple-signing/swarm-agent-updater.key.password`
- Both referenced from `.env.release` as `TAURI_SIGNING_PRIVATE_KEY` (path)
  and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- The **same key file** must exist on every build machine — copy it to the
  Windows box over a private channel (AirDrop, USB stick), never through the
  repo or a chat upload.

> **Losing the private key or its password permanently strands every shipped
> app** — they verify updates against the baked-in public key and will never
> accept an artifact signed by a replacement. Back up both files with the
> Apple credentials. Leaking the key is bad but not fatal (an attacker would
> also need write access to GitHub Releases); losing it is fatal.

## Analytics keys

Official builds report anonymous usage to Google Analytics (see the user
guide's *Telemetry* section for exactly what is sent). The keys are baked in
at **compile** time via `option_env!`, so they must be present in
`.env.release` on **both** build machines:

- `SWARM_AGENT_GA_MEASUREMENT_ID` — the GA4 web stream's `G-…` id.
- `SWARM_AGENT_GA_API_SECRET` — Measurement Protocol API secret, created under
  the same stream (Admin → Data streams → Measurement Protocol API secrets).

Forgetting them does not fail the build — it silently ships a release that
reports nothing (exactly what community source builds get). If usage drops to
zero after a release, check this first. Leaking the secret only lets someone
send garbage events into the property; rotate it in GA and rebuild.

## `latest.json` anatomy

Assembled by `scripts/release/manifest.mjs` (unit-tested; the publish script
is a thin `gh` wrapper around it):

```json
{
  "version": "0.2.0",
  "notes": "…release body…",
  "pub_date": "2026-08-12T00:00:00Z",
  "platforms": {
    "darwin-aarch64":  { "signature": "…", "url": "…/v0.2.0/SwarmAgent.app.tar.gz" },
    "darwin-x86_64":   { "signature": "…", "url": "…/v0.2.0/SwarmAgent.app.tar.gz" },
    "windows-x86_64":  { "signature": "…", "url": "…/v0.2.0/SwarmAgent_0.2.0_x64-setup.exe" }
  }
}
```

Both `darwin-*` keys point at the one universal `.app.tar.gz`. The Windows
entry points at the NSIS installer itself. Signatures are the contents of the
`.sig` files the build emitted. URLs use the published-release form — draft
asset URLs are ephemeral and die on publish, which is why the script never
uses them.

## Rules that keep updates working

- **Keep updater artifacts on the latest release once auto-updates ship.** `releases/latest`
  would start serving a 404 manifest and every installed app's update check
  fails (silently on startup, visibly via the tray) until the next good
  release. The publish script's refusal logic enforces this — don't hand-roll
  releases in the web UI.
- **Don't rotate the signing key.** See the warning above.
- The in-app flow: silent check ~5 s after launch; tray → **Check for
  Updates…** for a talkative manual check; download only on click; macOS
  restarts via the toast, Windows hands off to the NSIS installer
  (`installMode: passive`).

## What is deliberately not here

CI releases (GitHub Actions) remain future work — every step above is
headless-capable (plain env vars, no prompts) so the eventual workflow is a
lift-and-shift. Linux bundles: additive later (`linux-x86_64` key in the same
manifest). Windows Authenticode: see the SmartScreen section of
[release-windows.md](release-windows.md).


SwarmAgent development builds have no updater endpoint. Release builds must set
`SWARM_AGENT_UPDATER_PUBLIC_KEY` in `.env.release` alongside its matching
private key. The platform release scripts enable updater artifacts and point the
installer to this repository's releases.

# Releasing Stride (macOS and Windows)

Stride updates itself from GitHub releases with the Tauri v2 updater. Every installed copy checks
`https://github.com/ishaanpilar/stride/releases/latest/download/latest.json` about 30 seconds after
launch and every 6 hours (Settings → About → "Automatically check for updates", on by default). When
`latest.json` lists a newer version, Stride shows "Stride X.Y.Z is available" with the release notes and
three choices: **Install and restart**, **Later** (asks again after 24 hours) and **Skip this version**.
Install downloads the `.app.tar.gz`, verifies its signature against the public key built into the app,
replaces `Stride.app`, saves pending changes and relaunches. After the relaunch Stride shows "What's
new in X.Y.Z" once.

The in-app updater runs for direct (GitHub) installs on macOS and Windows (`IN_APP_UPDATE_PLATFORMS`
in `apps/desktop/src/lib/app-updater.ts`). It installs only when `latest.json` has an entry for the
machine: `darwin-aarch64` (Apple silicon) and, when the Windows build was signed, `windows-x86_64`.
When the entry is missing (an Intel Mac, or a Windows release built without the updater secrets) the
check falls back to the GitHub release and the dialog offers **Download from GitHub** instead of
**Install and restart**. App Store, Homebrew, Microsoft Store, winget, Scoop, Chocolatey, portable and
Linux installs keep their existing "update available" reminder.

On Windows the NSIS installer closes Stride as soon as it starts, so the app saves pending changes after
the download and before handing over; the installer then starts the new version.

## The signing key

The updater only installs bundles signed by the private key that matches `plugins.updater.pubkey` in
`apps/desktop/src-tauri/tauri.conf.json`.

| What | Where |
| --- | --- |
| Private key (minisign, password-protected) | `~/.tauri/stride-updater.key` (mode 600) |
| Public key (also in `tauri.conf.json`) | `~/.tauri/stride-updater.key.pub` |
| Key password | macOS login keychain, generic password, service `Stride updater signing key`, account `stride-updater` |

Neither the private key nor the password is ever committed, and the release script passes them only in the
environment of the build process.

**If the private key or its password is lost, every copy of Stride already installed can never update
itself again.** A new key means shipping a new public key, and old installs only trust the old one, so
their users would have to download a new build by hand.

### Back it up now

Store both in your password manager (one secure note named "Stride updater signing key"):

1. The key file contents: `cat ~/.tauri/stride-updater.key | pbcopy`, paste into the note, then clear the
   clipboard.
2. The password: `security find-generic-password -a stride-updater -s "Stride updater signing key" -w | pbcopy`,
   paste into the note, then clear the clipboard.
3. Optionally the public key from `~/.tauri/stride-updater.key.pub` for reference.

To restore on a new Mac: write the key back to `~/.tauri/stride-updater.key`, `chmod 600` it, and run
`security add-generic-password -a stride-updater -s "Stride updater signing key" -w '<password>' -U`.

## Building

- Dev build without updater artifacts: `cd apps/desktop && bun run build:local`. When
  `TAURI_SIGNING_PRIVATE_KEY` is unset the build skips `createUpdaterArtifacts` and still succeeds.
- Signed build: set `TAURI_SIGNING_PRIVATE_KEY` (key path or contents) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; `build:local` then adds `src-tauri/tauri.updater.conf.json`, and
  Tauri writes `bundle/macos/Stride.app.tar.gz` and `Stride.app.tar.gz.sig`.

## Cutting a release

1. Bump the version and commit: `bun scripts/set-version.ts X.Y.Z`, write the release notes to a file,
   commit on your working branch.
2. Dry run (the default): `bun scripts/release-mac.ts X.Y.Z --notes-file notes.md`.
   It checks the tree is clean (`CLAUDE.md` is ignored; `--allow-dirty` relaxes the check for dry runs),
   builds with the `CloseQuit Local` identity (override with `APPLE_SIGNING_IDENTITY`) and the updater
   key, and writes to `dist/release/vX.Y.Z/` (or `--out <dir>`):
   - `Stride-X.Y.Z-macOS.zip`: first installs (unzip, move to Applications).
   - `Stride_X.Y.Z_aarch64.app.tar.gz` and `.sig`: the in-app update bundle.
   - `latest.json`: the Tauri v2 manifest
     `{version, notes, pub_date, platforms: {"darwin-aarch64": {signature, url}}}`, where `url` is
     `https://github.com/ishaanpilar/stride/releases/download/vX.Y.Z/Stride_X.Y.Z_aarch64.app.tar.gz`.
   - `SHA256SUMS.txt` and `release-notes.md`.

   It verifies the signature against the public key in `tauri.conf.json` and prints the exact publish
   commands, including `gh release create`. Nothing is pushed.
3. Publish: rerun with `--publish` from a clean tree. This follows the squashed public-history pattern:

   ```sh
   git fetch stride main
   commit=$(git commit-tree 'HEAD^{tree}' -p stride/main -F <message>)   # "Stride X.Y.Z" + notes
   git push stride "$commit:refs/heads/main"
   git tag -a vX.Y.Z "$commit" -m "Stride X.Y.Z" && git push stride vX.Y.Z
   gh release create vX.Y.Z --repo ishaanpilar/stride --title "Stride X.Y.Z" --notes-file release-notes.md \
     Stride-X.Y.Z-macOS.zip Stride_X.Y.Z_aarch64.app.tar.gz Stride_X.Y.Z_aarch64.app.tar.gz.sig latest.json SHA256SUMS.txt
   ```

   The release must be marked "latest" (the `gh` default) because the updater reads
   `releases/latest/download/latest.json`.

## Windows (beta)

Windows x64 installers are built on GitHub Actions by the **Release Windows** workflow
(`.github/workflows/release-windows.yml`) and attached to the release the macOS script already published.
The workflow runs only when you dispatch it; it never creates tags or releases.

1. Publish the macOS release first (above). The tag `vX.Y.Z` must exist on `ishaanpilar/stride` and the
   GitHub release must exist; `tauri.conf.json` at that tag must say `X.Y.Z`.
2. Run the workflow:

   ```sh
   gh workflow run release-windows.yml --repo ishaanpilar/stride -f tag=vX.Y.Z \
     -f prerelease_note="**Windows (beta):** download Stride_X.Y.Z_x64-setup.exe. SmartScreen may warn: More info → Run anyway."
   gh run watch --repo ishaanpilar/stride "$(gh run list --repo ishaanpilar/stride --workflow release-windows.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

   `prerelease_note` is optional; it is appended once to the release notes (the release itself stays
   "latest", which the macOS updater needs). The workflow checks out the tag, installs Bun from
   `.bun-version` and stable Rust, and runs `bunx tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi`.
3. Verify the release has:
   - `Stride_X.Y.Z_x64-setup.exe` (NSIS, per-user install; the one to recommend) and
     `Stride_X.Y.Z_x64_en-US.msi`.
   - Windows lines in `SHA256SUMS.txt` (the workflow re-uploads it with the new lines appended).
   - With updater signing on: `Stride_X.Y.Z_x64-setup.exe.sig`, and `latest.json` listing both
     `darwin-aarch64` and `windows-x86_64`:
     `curl -sL https://github.com/ishaanpilar/stride/releases/latest/download/latest.json | jq '.platforms | keys'`.
   - The run summary says whether in-app updates and Authenticode were on.

   Re-running the workflow for the same tag is safe: assets are uploaded with `--clobber`, the checksum
   lines and the `windows-x86_64` entry are replaced, not duplicated.

### In-app updates on Windows (optional GitHub secrets)

Without secrets the workflow still publishes the installers, leaves `latest.json` untouched, and Windows
users are offered a GitHub download link when a new version is out. To ship signed Windows in-app updates,
give the workflow the same updater key the Mac releases use (never a new one: installed copies only trust
the public key in `tauri.conf.json`):

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo ishaanpilar/stride < ~/.tauri/stride-updater.key
security find-generic-password -a stride-updater -s "Stride updater signing key" -w \
  | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo ishaanpilar/stride
```

With both secrets set, the build adds `src-tauri/tauri.updater.conf.json`, Tauri signs the NSIS installer,
`scripts/add-windows-updater-entry.ts` verifies the `.sig` against the public key in `tauri.conf.json`,
then adds `windows-x86_64` (URL: the uploaded `-setup.exe`) to the release's `latest.json` and re-uploads
it. The installers are uploaded before `latest.json`, so the manifest never points at a missing file.
Secrets are passed only to the build step, not to `bun install`. Storing the key in GitHub means trusting
GitHub with it; the local key file and password-manager backup above stay the source of truth.

The updater uses the NSIS installer for every Windows install. Recommend the `-setup.exe`; people who
install the `.msi` should update by installing the next `.msi`.

### Authenticode signing (optional, off by default)

Unsigned installers trigger SmartScreen ("Windows protected your PC"). The workflow can sign `stride.exe`,
the NSIS installer and the MSI with [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/)
through Tauri's `bundle.windows.signCommand` (signing happens before the updater signature is made). To turn
it on, create a Trusted Signing account and certificate profile, an app registration with the
"Trusted Signing Certificate Profile Signer" role, then set:

- Repository variables: `WINDOWS_CODE_SIGNING=azure-trusted-signing`, `AZURE_TRUSTED_SIGNING_ENDPOINT`
  (for example `https://weu.codesigning.azure.net`), `AZURE_TRUSTED_SIGNING_ACCOUNT`,
  `AZURE_TRUSTED_SIGNING_PROFILE`.
- Repository secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`.

The workflow then fails if any of these is missing, and checks that both installers carry a valid
Authenticode signature. Signing does not remove SmartScreen warnings instantly; reputation builds up over
downloads.

### SmartScreen guidance for users

Until the installers are signed (and have reputation), tell Windows users, in the release notes and the
README: download `Stride_X.Y.Z_x64-setup.exe`; if SmartScreen says "Windows protected your PC", click
**More info → Run anyway**; optionally compare `Get-FileHash .\Stride_X.Y.Z_x64-setup.exe` with
`SHA256SUMS.txt`. The installer is per-user and needs no administrator rights. WebView2 ships with
Windows 10 and 11; the installer downloads it if it is missing.

### What is Mac-only

macOS Calendar sync (EventKit), renderer-crash window recovery, native vibrancy (the tray panel and floating
timer are opaque on Windows) and the menu bar (Windows uses the tray: left click opens the panel, right
click the menu). Windows-specific Rust compiles in CI only; there is no Windows machine in the loop, so
smoke-test each beta by hand (install, tray panel, floating timer, accent colour, update from the previous
version).

## Notes and limits

- Builds are signed with the local `CloseQuit Local` identity and are not notarised. First installs still
  need right-click → Open; in-app updates are downloaded by the app itself, so they are not quarantined.
- On macOS only `darwin-aarch64` is published. Intel Macs get a "Download from GitHub" update dialog
  instead of an in-app install.
- Windows in-app updates start with the first Windows release that was built with the updater secrets;
  earlier Windows installs update by downloading the new installer once.
- Updates from a version earlier than the first release that contains the updater (1.5.0) must be
  installed by hand once.

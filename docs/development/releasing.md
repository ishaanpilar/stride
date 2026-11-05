# Releasing Stride for macOS

Stride updates itself from GitHub releases with the Tauri v2 updater. Every installed copy checks
`https://github.com/ishaanpilar/stride/releases/latest/download/latest.json` about 30 seconds after
launch and every 6 hours (Settings → About → "Automatically check for updates", on by default). When
`latest.json` lists a newer version, Stride shows "Stride X.Y.Z is available" with the release notes and
three choices: **Install and restart**, **Later** (asks again after 24 hours) and **Skip this version**.
Install downloads the `.app.tar.gz`, verifies its signature against the public key built into the app,
replaces `Stride.app`, saves pending changes and relaunches. After the relaunch Stride shows "What's
new in X.Y.Z" once.

The in-app updater runs only for direct (GitHub) installs on Apple silicon. App Store, Homebrew and
other package-manager installs keep their existing "update available" reminder. Windows and Linux keep
the reminder too until `latest.json` lists their targets and `IN_APP_UPDATE_PLATFORMS` in
`apps/desktop/src/lib/app-updater.ts` includes them.

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

## Notes and limits

- Builds are signed with the local `CloseQuit Local` identity and are not notarised. First installs still
  need right-click → Open; in-app updates are downloaded by the app itself, so they are not quarantined.
- Only `darwin-aarch64` is published. Intel Macs see a calm "no in-app update for this Mac" message with a
  link to GitHub.
- Updates from a version earlier than the first release that contains the updater (1.5.0) must be
  installed by hand once.

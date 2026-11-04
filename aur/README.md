# Stride AUR packages

Stride recognizes these AUR package identities:

| Package                                                                   | Channel | Source                        | Expected owner(s)                                       |
| ------------------------------------------------------------------------- | ------- | ----------------------------- | ------------------------------------------------------- |
| [`stride-bin`](https://aur.archlinux.org/packages/stride-bin)           | Stable  | GitHub release `.deb`         | Maintainer `ishaanpilar`                                 |
| [`stride-beta-bin`](https://aur.archlinux.org/packages/stride-beta-bin) | RC/beta | GitHub prerelease `.deb`      | Maintainer `ishaanpilar`                                 |

The source-built `stride` package on the AUR is community maintained; the Stride project does not publish, audit, or support it.

Treat a different upstream URL or an unexpected ownership change as a security event. The machine-readable policy is in [`trusted-packages.json`](trusted-packages.json).

## Install

Review every AUR file before building. For example:

```bash
git clone https://aur.archlinux.org/stride-bin.git
cd stride-bin
git log --oneline -10
less PKGBUILD .SRCINFO
makepkg --verifysource
makepkg -sri
```

The source URLs must resolve to `https://github.com/ishaanpilar/stride`, executable and source artifacts must have full SHA-256 checksums, and `.SRCINFO` must match `PKGBUILD`. Stride AUR packages must not contain install scripts, remote-shell commands, persistence hooks, or `SKIP` checksums for executable/source content.

### Beta package rename

`stride-beta-bin` is the current beta package name. The maintainer [requested deletion of the legacy `stride-bin-beta` package](https://lists.archlinux.org/archives/list/aur-requests@lists.archlinux.org/thread/H76IUDZWQTMVL7J4NLMZASCNMG6VYWU5/) on August 31, 2026, after publishing its replacement. AUR accepted that request on September 6, 2026, so the legacy identity no longer receives updates.

To move explicitly, review the new package and then replace the legacy identity:

```bash
sudo pacman -R stride-bin-beta
paru -S stride-beta-bin
```

Removing the package does not remove Stride's user data. Existing `stride-bin-beta` users must migrate manually because AUR helpers do not reliably migrate package identities from `replaces` metadata alone.

## Release trust anchor

Stride publishes `SHA256SUMS` with release artifacts and signs new manifests as `SHA256SUMS.asc`. The primary signing-key fingerprint is:

```text
__STRIDE_GPG_FINGERPRINT__
```

Verify the fingerprint independently before trusting the key. A typical verification is:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check SHA256SUMS
```

## Publishing policy

All recognized packages publish directly from release jobs:

1. Generate the package's `PKGBUILD` and `.SRCINFO` from the release tag.
2. Reject unexpected files, owners, sources, commands, or skipped checksums (`scripts/ci/validate-aur-package.mjs`).
3. Build in a clean Arch container.
4. Re-verify the package's maintainer, co-maintainers, and upstream URL against the trusted policy immediately before pushing (`scripts/ci/audit-aur-state.mjs`); ownership drift aborts the push.
5. Push a single, non-force commit over a dedicated SSH credential.

A recognized AUR maintenance response (pushes disabled) marks the channel delayed rather than failing the job; an unexpected rejection fails it.

## Maintainer security

- Keep `ishaanpilar` as maintainer or co-maintainer of all recognized packages.
- Use a dedicated, passphrase-protected Ed25519 AUR key that is not shared with GitHub, servers, or general build machines.
- Store the publishing key only as the `AUR_SSH_PRIVATE_KEY` secret in the protected `aur-publish` Environment.
- Never orphan a package for temporary maintenance convenience and never force-push AUR history.

The AUR is unofficial. Automation catches policy drift, but it does not replace reviewing the actual package diff and build behavior.

# Multi-channel distribution implementation

Status: phase-one macOS `0.4.0-preview.1` is released and accepted on public
Homebrew/npm/npx. Phase two Linux/Docker is in implementation and **not released**.

The approved rollout introduces `0.4.0-preview.1` for native macOS arm64
Homebrew/npm/npx, then `0.4.0-preview.2` for Linux x64/arm64 npm and interactive
Docker. The existing `0.3.0-preview.1` release and its source-bound evidence remain
historical and immutable. The private source package's legacy stack version is
not publication authority for the separately versioned native distribution.

## Installation contract

- Public CLI: `only-my-pi`; executable: `omp`.
- Prebuilt packages: `only-my-pi-runtime-darwin-arm64`,
  `only-my-pi-runtime-linux-x64`, `only-my-pi-runtime-linux-arm64`.
- npm uses the user's supported Node; Homebrew supplies Node 24; Docker uses the
  reviewed Node 24.19.0 image. First launch must not download dependencies.
- Package managers own program files. Existing Pi credentials, preferences,
  sessions and user-owned packages remain in place.
- Packaged runtime lookup is relative to the running application, with a bound
  distribution manifest and the unchanged audited extension filters. A corrupt
  native installation must not silently fall back to a legacy/global Pi.
- `omp admin pi` provides the packaged raw Pi for authentication without claiming
  the user's global `pi` command. Cross-manager mutations return channel guidance.
- Homebrew target: `Ricardo121380/homebrew-tap`; OCI target:
  `ghcr.io/ricardo121380/only-my-pi`.

## Progress and remaining acceptance

- [x] Native runtime manifest, content identities, platform and Node admission.
- [x] Direct session and child package resolution without global Pi bindings.
- [x] Native version/doctor/raw-Pi dispatch and package-manager ownership boundary.
- [x] Targeted runtime/CLI/legacy regression tests and existing pack allowlist.
- [x] macOS candidate builder; clean-home and fresh-cache npm/npx lifecycle checks
      on Node 22.19.0 and 24.19.0; startup without external network downloads.
- [x] Legacy entry migration with ownership checks and recoverable backup.
- [x] Local Homebrew install, formula tests, revision upgrade and uninstall.
- [x] Final-source macOS candidate revalidation and public Homebrew tap acceptance.
- [ ] Linux runtime and native x64/arm64 acceptance.
- [ ] Docker filesystem, network and PID isolation acceptance.
- [x] macOS protected release evidence, signed artifacts and channel publication.
- [x] macOS public-registry exact/default installation verification and bilingual README promotion.

## Docker feasibility

The diagnostic image uses Node 24.19.0 bookworm-slim pinned to
`sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`.
The probe requires a fresh PID/proc and network namespace, denied access outside
the permitted writable path, and successful in-scope writes.

On the initial Colima arm64 test, the default nonprivileged Docker configuration
rejects namespace creation. A diagnostic seccomp profile retaining default-deny
but permitting namespace syscalls reaches a subsequent AppArmor mount denial.
An active, scoped AppArmor probe then reaches a fresh `/proc` mount denial.
None of these runs is a PASS. The temporary probe profile was removed.
Docker remains blocked until an explicitly scoped,
reviewed configuration passes; disabling security policies or enabling weaker
nested sandboxing is not an accepted workaround.

## Publication prerequisites

The macOS packages are registered, trusted publishing is configured, and both
`latest` and `preview` point to `0.4.0-preview.1`. The public Homebrew formula is
installable. Linux platform package registration and trust configuration remain
phase-two prerequisites; account-owner login/2FA may be required. No Docker
product image has been published. See [the release runbook](native-release-runbook.md).

## Phase-two environment gate

`Linux sandbox feasibility` runs `scripts/probe-linux-sandbox.mjs` on native
Ubuntu x64 and arm64 runners. It checks non-root execution, glibc, Git,
bubblewrap, socat and ripgrep, fresh PID/proc and network namespaces, a real
TCP endpoint reachable outside but denied inside, hidden private file content,
denied out-of-scope writes and permitted project writes. It does not disable
AppArmor, seccomp, system-path masks or kernel restrictions. Failures retain
`BLOCKED` evidence and do not authorize coding or publication.

This is only an environment feasibility gate, not full OMP acceptance. Linux
still needs a platform-native locked dependency build (the current builder
intentionally accepts only the reviewed macOS seed), exact-version CLI assembly,
Node 22/24 lifecycle tests and the protected product matrix. Docker additionally
needs UID/GID persistence, signal handling, Compose and real product isolation
acceptance. A successful native Linux probe does not validate Docker.

The default Colima Docker configuration was retested after phase one and still
rejects non-root namespace creation. The historical scoped-profile experiment
also failed at fresh `/proc`. Upstream records this nested procfs restriction
in [runc issue 1658](https://github.com/opencontainers/runc/issues/1658).
Docker's [`systempaths=unconfined`](https://docs.docker.com/reference/cli/docker/container/run/#security-configuration)
disables protected system paths and is not an accepted workaround.

## Candidate verification and discovered packaging constraints

The macOS builder verifies the immutable 0.3 dependency seed, replaces its OMP
application with the exact clean source, and emits new identities and an SPDX
SBOM. It does not reuse protected release evidence. `fd` and `ripgrep` are fetched
at build time from checksum-pinned upstream releases, included with their license
files, and covered by the Pi component digest. The confirmed macOS policy is:
npm/npx and archive users preinstall Git; Homebrew supplies Git as a dependency.
Installation checks and native startup reject missing Git without opening the
macOS developer-tools installer. Doctor reports Git separately from model setup.

The npm loader verifies the selected platform payload before importing it.
Its optional first-party postinstall check is read-only; correctness does not
depend on npm permitting that script. No third-party install scripts run on the
end user's machine. npm omits archive symlinks, so approved executable links are
materialized as relative trampolines before the manifest is hashed.

Homebrew's automatic Mach-O processing changes signed runtime content. The
formula retains the exact runtime archive through that processing and extracts
and verifies it during `post_install`, still within the formula's own `libexec`.
There is no first-launch extraction or initialization of user configuration.
Node 24 is provided by the formula dependency.

Build and validation commands (absolute output directories must be fresh):

```sh
node scripts/build-distribution.mjs --source-commit COMMIT --seed-bundle /absolute/seed.tar.gz --output /absolute/candidate
node scripts/verify-distribution-install.mjs /absolute/candidate /absolute/acceptance
node scripts/build-homebrew-formula.mjs /absolute/candidate /absolute/only-my-pi.rb
npm run test:distribution
```

The `Native distribution candidate` workflow runs the two supported Node
versions against the same macOS artifacts. Its attestations identify candidate
bytes; they do not constitute protected product acceptance or public release.
The local registry used by the verification script is not the public npm
registry. Public installation and default-tag checks remain separate gates.

Migration accepts a persistent Homebrew or global npm entry on PATH, verifies
the legacy shim and state record, and renames only that shim to a recoverable
backup in its original directory. It preserves raw `pi`, old stacks and user
data. A prepared or incomplete migration receipt requires inspection before
another attempt; unknown command files are not replaced.

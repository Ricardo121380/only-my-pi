# Multi-channel distribution implementation

Status: implementation in progress; **not released**.

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
- [ ] Final-source candidate revalidation and public Homebrew tap acceptance.
- [ ] Linux runtime and native x64/arm64 acceptance.
- [ ] Docker filesystem, network and PID isolation acceptance.
- [ ] Fresh protected release evidence, signed artifacts and channel publication.
- [ ] Public-registry installation verification and bilingual README promotion.

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

The local npm CLI currently reports `ENEEDAUTH`. Registration, first publication
and trusted publisher setup require the account owner's applicable login/2FA.
No npm package, tap or Docker product image has been published by this work yet.

## Candidate verification and discovered packaging constraints

The macOS builder verifies the immutable 0.3 dependency seed, replaces its OMP
application with the exact clean source, and emits new identities and an SPDX
SBOM. It does not reuse protected release evidence. `fd` and `ripgrep` are fetched
at build time from checksum-pinned upstream releases, included with their license
files, and covered by the Pi component digest. The macOS Git dependency policy
still needs resolution before this candidate can be considered dependency-complete.

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

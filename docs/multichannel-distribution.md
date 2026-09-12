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
- [ ] Native package builder and clean-home, fresh-cache install/launch acceptance.
- [ ] Legacy entry migration with ownership checks and recoverable backup.
- [ ] Homebrew installation, upgrade and uninstall acceptance.
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
Neither run is a PASS. Docker remains blocked until an explicitly scoped,
reviewed configuration passes; disabling security policies or enabling weaker
nested sandboxing is not an accepted workaround.

## Publication prerequisites

The local npm CLI currently reports `ENEEDAUTH`. Registration, first publication
and trusted publisher setup require the account owner's applicable login/2FA.
No npm package, tap or Docker product image has been published by this work yet.

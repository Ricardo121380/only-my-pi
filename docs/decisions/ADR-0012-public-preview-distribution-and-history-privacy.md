# ADR-0012: Public Preview distribution and history privacy

Status: Accepted for M11 implementation

Date: 2026-08-29

## Context

M10 proved the read-only daily Harness on one real macOS installation, but its
artifact, source authority and recovery path were local. Publishing that state
directly would expose a historical personal commit email, make old
source-bound evidence appear current after history rewriting, and leave public
installers dependent on an unmanaged system Node/Pi layout.

M11 therefore separates privacy-preserving source publication from product
distribution. The original repository is retained as the private
`only-my-pi-private-archive`; the public candidate preserves the 219-commit
topology, messages, timestamps, trees and file modes while replacing only
`1193206973@qq.com` author/committer identities with the GitHub noreply address.
The private archive owns the old-to-new commit map. It is never a public
artifact.

## Decision

### Product and platform

- The first public version is `0.2.0-preview.1`, channel `preview`.
- Distribution is GitHub Release only. `package.json` remains `private: true`.
- The supported platform is macOS 14 or newer on native Apple Silicon arm64.
- The controlled stack embeds the official Node `24.19.0` darwin-arm64
  runtime, Pi `0.84.3`, the exact M10 nine-package tuple and one only-my-pi
  artifact.
- The default preset remains `daily`; production Agents remain read-only.
- Full and Thin payloads use one canonical stack manifest, artifact ledger,
  staging service and transaction engine. Their acquisition paths may differ;
  their final `stackId` and tree identities may not.

### Authority

- All pre-rewrite evidence and receipts remain byte-for-byte historical
  records with class `LEGACY_PRIVATE_HISTORY` and
  `CURRENT_RELEASE_AUTHORITY=false`.
- Old embedded signatures/digests may still be inspected. Their original Git
  direct-child claims cannot be used after commit rewriting.
- `public-baseline-v1` is the first current authority in the sanitized
  repository. It uses a source commit, a direct evidence-only child and a
  completion receipt.
- M11 release evidence is source/tag/asset bound and cannot inherit a legacy
  PASS count.

### Installation and ownership

- All public assets install under `~/.local/share/only-my-pi` and
  `~/.local/bin`; the installer never writes `/opt/homebrew` and never uses
  `sudo`.
- `omp` and `pi` are controlled symlinks into the same immutable active stack.
- Third-party Pi packages remain `external/owner=user`, including packages
  provisioned by an explicit M11 transaction. `assetDisposition` records who
  created physical bytes; it does not transfer ownership.
- Exact pre-existing packages are borrowed. Missing packages may be completed
  only from a fully governed root. Different versions, unknown top-level
  packages, tree drift, unsafe paths or unknown shims fail before writes.
- `omp uninstall` removes the Harness activation only. `omp stack remove` is a
  distinct confirmed authority that may remove only provably provisioned,
  unmodified assets and may restore an exact pre-install LKG.

### Network and updates

- A downloaded Full bundle is offline during plan and apply.
- Thin may retrieve immutable, digest-bound bytes only from GitHub Release,
  `nodejs.org` and `registry.npmjs.org`. Redirects are manually revalidated;
  credentials, custom headers, `.npmrc` tokens and lifecycle scripts are
  forbidden.
- Apply begins only after every byte, SRI, SHA-256, manifest and tree identity
  is staged and verified. Apply itself is offline.
- `omp release check` is explicit, read-only and channel-scoped. There is no
  daemon, background check or automatic update.

### Release integrity

- Full and Thin are reproducible normalized archives.
- `release-index-v1` binds the public tag, source, platform, bootstrap and
  named assets; it is not the stack identity.
- `stack-manifest-v1` is acquisition-independent. Its canonical digest is the
  `stackId`; neither `full` nor `thin` appears in that digest.
- `transitive-artifact-ledger-v1` requires credential-free registry URLs,
  SHA-512 SRI, SHA-256 of downloaded bytes, installed tree identities,
  lifecycle-script digests and a license conclusion for every artifact.
- `stack-state-v1` is private mutable state. It separately records the payload
  mode, the installed generation and whether physical bytes were pre-existing
  or provisioned for the user; this does not change external ownership.
- A release carries SHA-256 checksums, an SPDX 2.3 SBOM, third-party notices,
  GitHub build provenance and SBOM attestations.
- The tag and all action dependencies are exact identities. Publishing requires
  protected evidence and approval through the `public-preview` Environment.
- The final release is immutable. RC and final core assets must be
  byte-identical.

### Shell and process behavior

- PATH configuration is diagnostic-only by default. `--configure-shell` is an
  explicit, backed-up, idempotent marker-block mutation.
- Related Pi processes are listed before mutation. Confirmed termination uses
  `SIGTERM` with a 15-second bound; `SIGKILL` is forbidden.
- Every durable boundary is journaled. Ordinary failure restores the previous
  complete stack; a later mutating command recovers an interrupted
  transaction before starting another.

## Consequences

The Preview has a larger release surface than M10 but no second package
manager or Agent runtime. One manifest and one transaction implementation own
both payload modes. Public support is intentionally narrower than the embedded
Node runtime's theoretical platform range. Intel macOS, Linux, Windows, npm
publication, writer, MCP and unattended updates remain outside M11.

Publishing is fail-closed: history/privacy inventory, current public baseline,
deterministic gates, macOS arm64 acceptance, protected live evidence and GitHub
repository controls must all pass before the repository becomes public or a
release tag is created.

The canonical target graph digest in a stack manifest and the installed
generation identity in stack state are intentionally separate. The latter may
bind verified physical package-tree evidence; neither value may be substituted
for the other in a receipt.

# Native Preview release runbook

Status: phase-one macOS `0.4.0-preview.1` is published on npm (`latest` and
`preview`), Homebrew and GitHub Releases. Public npm exact-version and default
npm/npx installation acceptance passed on Node 22.19.0 and 24.19.0. Signed
publication passed in [run 34746473618](https://github.com/Ricardo121380/only-my-pi/actions/runs/34746473618),
and real public Homebrew installation passed in [tap run 34746809330](https://github.com/Ricardo121380/homebrew-tap/actions/runs/34746809330).
Linux `0.4.0-preview.2` remains an unpublished candidate; Docker is deferred
and its isolation is still blocked. npm/npx and
archive users preinstall Git, while Homebrew provides Git.

## Account preparation

The account owner must finish npm login, package-name ownership/registration and
the platform's 2FA steps. Do not publish a 0.4 version as a registration shortcut:
that would consume the immutable version before the approved provenance flow.
Keep any registration-only operation separate from a product release.

For both `only-my-pi` and `only-my-pi-runtime-darwin-arm64`, configure npm's GitHub
trusted publisher with user `Ricardo121380`, repository `only-my-pi`, workflow
filename `distribution-publish.yml`, and environment `public-preview`. Permit
direct `npm publish` for this workflow. It already has a separate protected
GitHub approval gate. npm's current OIDC support applies to publish operations;
default-tag promotion uses the account owner's normal authenticated npm session.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

No long-lived npm write token is required by either GitHub workflow. Do not
change or bypass the existing `public-preview` environment reviewers.

## Phase-two completion gate

Use `linux-candidate.yml` on the exact merged source S. It builds the three
native runtimes, assembles one CLI, generates and signs the macOS Formula, and
checks final npm/Full/Thin installation on both Node versions. The macOS npm
and Homebrew checks include an upgrade from public `0.4.0-preview.1`; Linux is
a new channel with reinstall and legacy-entry migration checks. Homebrew
mutations run only on a disposable hosted macOS runner.

The protected `linux-live-acceptance.yml` uses the account-authorized environment
Secret only for x64 Kimi tests. Its receipt must now be
`NATIVE_LIVE_ACCEPTANCE_PASS`, including cancellation of an observed child
process and normal-exit cleanup. Earlier `NATIVE_LIVE_SUBSET_PASS` results are
development evidence, not sufficient release authority. Repeat the complete
same-source Kimi harness on native ARM Linux and macOS as well; keep credentials
and raw sessions out of uploaded evidence.
Pass `--candidate-receipt /absolute/candidate/build-receipt.json` to every full
Kimi run. Install, migration, archive and live receipts bind this exact hash so
provisional platform-CLI checks cannot stand in for the final combined CLI.

Download the candidate's install, migration, archive, Linux sandbox and
Homebrew receipts, plus all three complete Kimi receipts, into a dedicated
proof directory. Run on the candidate source:

```sh
node scripts/collect-multiplatform-evidence.mjs /absolute/candidate /absolute/proofs /absolute/new-evidence.json
```

The collector refuses missing/failed checks, mixed source or runtime identities,
stale Kimi harnesses, wrong models and changed candidate bytes. Copy only the
resulting JSON into `verification/protected` in an evidence-only child E of S,
then merge E with the existing checks. Keep the raw sanitized receipts in the
release artifact directory; each assertion records its supporting receipt hash.

Dispatch the existing trusted publisher `distribution-publish.yml` with
`version=0.4.0-preview.2`, S, E, evidence path and the signed candidate run.
It verifies the source/evidence chain and signatures, then requests the existing
`public-preview` approval. It publishes the four exact npm archives, verifies
real public installation on all six platform/Node combinations, then publishes
the matching GitHub assets. Partial publication journals retain platform
identities; resume the same bytes, never rebuild or overwrite the version.

Default-tag promotion is still separate and uses the owner's authenticated npm
session. For `.2`, the second and third arguments to
`promote-distribution-tags.mjs` are directories for Node 22 and Node 24 public
receipts, each containing `darwin-arm64.json`, `linux-arm64.json` and
`linux-x64.json`. The script validates all six exact public results and all four
package integrities/provenance records before changing `preview`/`latest`.
The phase-one file-argument interface remains supported. Recheck the real
default npm/npx entry and the public tap after promotion. Only then update the
bilingual quick starts. Docker is not included in this release gate.

## Candidate and protected acceptance

1. Merge the implementation source S with the existing required checks. Build
   from a clean, isolated checkout; edits during staging invalidate the build.
2. Run `Native distribution candidate` on main at S. It builds once, verifies
   fresh npm/npx installs on Node 22.19.0 and 24.19.0, verifies the Full/Thin
   fallback pair, attests the exact candidate bytes and retains them as
   `native-candidate-S`.
3. Download those exact artifacts. Complete Homebrew lifecycle and the full
   protected product matrix against that candidate. The required assertions are
   defined by `NATIVE_RELEASE_ASSERTIONS` in
   `packages/distribution/release-policy.mjs`. No assertion may be inferred from
   old 0.3 receipts, unit tests, or a successful container start.
4. Store a native protected evidence JSON under `verification/protected/` in an
   evidence-only child E of S. It must identify S, the distribution ID, the
   SHA-256 of the unmodified build receipt, and digest evidence for every required
   assertion. It contains no raw prompts, outputs, credentials or host paths.
   Merge E without rewriting the S/E history.

The publication validator rejects missing assertions, `NOT_RUN`, stale source
identities, changed bytes and historical evidence formats. The first native
publication gate accepts only macOS arm64 `0.4.0-preview.1`.

## Publish and verify

Run `Protected native Preview publication` on main with S, E, the evidence path
and the successful candidate workflow run ID. It verifies the evidence-only
history and all candidate attestations before requesting the existing protected
environment approval. After approval it rechecks the downloaded attestations,
publishes the runtime package and CLI using OIDC/provenance to `preview`, and
installs the exact public version on both Node versions.

After those public checks, the workflow creates or resumes the GitHub Preview
release with the same npm packages, Full/Thin archives, build receipt, formula
and protected evidence. It never overwrites an existing asset or rebuilds a
candidate during recovery. The historical 0.3 assets are not involved.

Download the `native-publication-S` workflow artifact. From an authenticated npm
session, first inspect and then apply the default-tag plan:

```sh
node scripts/promote-distribution-tags.mjs /candidate /public-node22/acceptance.json /public-node24/acceptance.json
node scripts/promote-distribution-tags.mjs /candidate /public-node22/acceptance.json /public-node24/acceptance.json --apply
```

Then run `scripts/verify-distribution-install.mjs` with `--public-default` on
both supported Node versions. Exact-version checks and default-entry checks are
separate requirements.

Dispatch `Update verified OMP formula` in `Ricardo121380/homebrew-tap` with the
published version and S. The tap verifies the upstream source attestations and
updates its own formula. Install the real public tap's exact/default formula,
check channel/version/source identity and run its product acceptance. Only then
promote the bilingual root README quick starts and declare phase one complete.

## Failure recovery

Keep the candidate artifact ID, source S, E and all completed publication
records. `npm-publication.json`, `github-publication.json` and
`npm-default-tags.json` record progress independently. A failed job does not
imply that earlier channels were rolled back.

Resume with the same candidate bytes. An existing npm version is reusable only
when its integrity and provenance match; an existing GitHub asset is reusable
only when its bytes match. A mismatch stops the operation. Do not use force
push, `--clobber`, unpublish, or a same-version rebuild as a recovery shortcut.

## Full/Thin fallback behavior

The new fallback pair shares the npm runtime's distribution identity. Full
includes Node 24.19.0 and installs offline. Thin downloads only the pinned Node
archive during installation. Both install into an explicitly selected new
directory and leave existing global command links and Pi data alone:

```sh
./install.sh --prefix /absolute/new/omp-directory
/absolute/new/omp-directory/bin/omp
```

Upgrade by installing into another directory; rollback selects the previous
directory's command. Existing installation directories are never overwritten.
This uses a new archive manifest and does not reinterpret the legacy stack
manifest or its historical identity semantics.

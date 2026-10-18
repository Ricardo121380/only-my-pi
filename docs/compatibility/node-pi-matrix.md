# Node and Pi compatibility matrix

## PI130-01 development update — 2026-10-18

The exact development dependency, lock and six internal Pi packages remain `1.3.0`. Official tarball and 1,276 installed regular files match. Required Node `22.19.0` / `24.19.0` lanes pass types, contracts and the original full suite on frozen clean source `f5c7635` (1679 PASS, zero failures/cancellations, four installed SKIPs per lane). Linux arm64 affected public CLI checks pass 48 each. See [#76 final evidence](2026-10-18-pi-1.3.0-runtime-adaptation.md#7-三类完整回归失败的处置与本轮验收).
#76 is CLOSED/completed, independently read back; #77 has satisfied its sole prerequisite and remains unimplemented. All ten applicable M11 deterministic gates pass; Q10/Q11 retain their non-execution states. New candidate packaging and same-candidate acceptance belong to #77. Identities below retain their historical meaning and do not describe a new daily installation.

## Historical identities — checked 2026-10-17

| Identity | Version / state | Evidence and limits |
| --- | --- | --- |
| Published terminal Preview | OMP `v0.4.0-preview.2`; packaged Pi `0.84.3` is documented in the release guide | [Published release](https://github.com/Ricardo121380/only-my-pi/releases/tag/v0.4.0-preview.2), [README](../../README.md); release metadata was checked, binaries were not rerun |
| Development dependency | Pi `1.1.0` | Exact manifest, lock and installed package metadata; not proof of the daily runtime |
| Accepted controlled candidate | Pi `1.1.0` / `pi110-v1` | [Historical integrated acceptance](../plans/2026-10-13-pi110-integrated-acceptance.md); limited to that candidate and C/P/B scope |
| Next stable-core target | Pi `1.3.0` | [Upgrade preflight](2026-10-17-pi-1.3.0-upgrade-preflight.md); new-version runtime acceptance NOT_RUN |
| Supported development/CI matrix | Node `22.19.0` / `24.19.0` | Each new runtime change must pass its applicable checks; old rows do not certify new candidates |
| User's current daily installation | UNKNOWN in this discussion | Must inspect the actual active stack before an installation change |

See the [development blueprint](../plans/2026-10-17-product-direction-and-iteration-plan.md)
for the upgrade policy and current milestones. Values below retain their
historical M0–M10 scope.

## Historical M0–M10 compatibility evidence

| Runtime | Role | Evidence |
| --- | --- | --- |
| Node 22.19.0 | minimum supported/CI lane | Exact GitHub Actions lane; repository, topology, migration, and resource lifecycle gates pass |
| Node 24.19.0 | current pinned CI compatibility lane | Exact GitHub Actions lane; repository, topology, migration, and resource lifecycle gates pass |
| Node 25.8.0 darwin-arm64 | local development snapshot | M0–M7 local gates and fresh tarball smoke |
| Pi 0.84.1 | historical M8 baseline and verified rollback target | exact M10 real-root rollback evidence |
| Pi 0.84.2 | historical registry snapshot | superseded by the explicit M9 candidate audit; never promoted here |
| Pi 0.84.3 | M10 Stable development/host contract | exact artifact audit, isolated no-model RPC, 13-extension load, full regression, M9 U9 and M10 P9/P10 protected acceptance pass |

The Linux evidence is deterministic and credential-free. The Stable lifecycle
implementation first passed both exact lanes in GitHub Actions run
[`32697112477`](https://github.com/Ricardo121380/only-my-pi/actions/runs/32697112477).
Linux does not run the local no-model Pi process probe, so `noModelRpc` remains
`NOT_RUN_ENVIRONMENT`; the exact darwin row owns that separate proof.

The matrix is a compatibility statement, not a Provider guarantee. M10 P9 is
the narrow, explicit authority that performed the recorded local migration;
no matrix row independently authorizes a future mutation. Updating Pi or Node
again requires a new governed migration, no-model smoke and receipt chain.

The M9 candidate row is governed by
[`m9-upstream-candidates.md`](m9-upstream-candidates.md) and the
machine-readable
[`upstream-candidates.json`](../../contracts/compatibility/upstream-candidates.json).
M10 supplied the separate reviewed promotion and real-root rollback/reapply
evidence; Pi `0.84.3` was the Stable default for that recorded M10 generation,
while `0.84.1` remains its historical rollback baseline. Neither version is the
current development target or a substitute for a fresh pre-upgrade active-stack check.

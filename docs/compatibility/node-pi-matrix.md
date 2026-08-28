# Node and Pi compatibility matrix

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
evidence; Pi `0.84.3` is therefore the current Stable default while `0.84.1`
remains the recorded historical rollback baseline.

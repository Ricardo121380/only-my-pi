# Node and Pi compatibility matrix

| Runtime | Role | Evidence |
| --- | --- | --- |
| Node 22.19.0 | minimum supported/CI lane | Exact GitHub Actions lane; repository, topology, migration, and resource lifecycle gates pass |
| Node 24.19.0 | current pinned CI compatibility lane | Exact GitHub Actions lane; repository, topology, migration, and resource lifecycle gates pass |
| Node 25.8.0 darwin-arm64 | local development snapshot | M0–M7 local gates and fresh tarball smoke |
| Pi 0.84.1 | pinned development/host contract | package peer/dev dependency, no-model RPC smoke |
| Pi 0.84.2 | historical registry snapshot | superseded by the explicit M9 candidate audit; never promoted here |
| Pi 0.84.3 | M9 candidate, not a default | exact artifact audit, isolated no-model RPC, 13-extension load, U1-U8 and full regression pass; protected U9 remains pending |

The Linux evidence is deterministic and credential-free. The Stable lifecycle
implementation first passed both exact lanes in GitHub Actions run
[`32697112477`](https://github.com/Ricardo121380/only-my-pi/actions/runs/32697112477).
Linux does not run the local no-model Pi process probe, so `noModelRpc` remains
`NOT_RUN_ENVIRONMENT`; the exact darwin row owns that separate proof.

The matrix is a compatibility statement, not a Provider guarantee. No row
authorizes a global install or a real `~/.pi` mutation. Updating Pi or Node
requires rerunning package governance, the no-model startup smoke, and the
release receipt sequence.

The M9 candidate row is governed by
[`m9-upstream-candidates.md`](m9-upstream-candidates.md) and the
machine-readable
[`upstream-candidates.json`](../../contracts/compatibility/upstream-candidates.json).
It does not supersede the Pi `0.84.1` Stable row until the protected live matrix
passes and a separate reviewed promotion decision changes the default.

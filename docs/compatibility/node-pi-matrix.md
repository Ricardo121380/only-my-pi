# Node and Pi compatibility matrix

| Runtime | Role | Evidence |
| --- | --- | --- |
| Node 22.19.0 | minimum supported/CI lane | Exact GitHub Actions lane; repository, topology, migration, and resource lifecycle gates pass |
| Node 24.19.0 | current pinned CI compatibility lane | Exact GitHub Actions lane; repository, topology, migration, and resource lifecycle gates pass |
| Node 25.8.0 darwin-arm64 | local development snapshot | M0–M7 local gates and fresh tarball smoke |
| Pi 0.84.1 | pinned development/host contract | package peer/dev dependency, no-model RPC smoke |
| Pi 0.84.2 | registry advertised but not validated here | intentionally not installed by this Goal |

The Linux evidence is deterministic and credential-free. The Stable lifecycle
implementation first passed both exact lanes in GitHub Actions run
[`32697112477`](https://github.com/Ricardo121380/only-my-pi/actions/runs/32697112477).
Linux does not run the local no-model Pi process probe, so `noModelRpc` remains
`NOT_RUN_ENVIRONMENT`; the exact darwin row owns that separate proof.

The matrix is a compatibility statement, not a Provider guarantee. No row
authorizes a global install or a real `~/.pi` mutation. Updating Pi or Node
requires rerunning package governance, the no-model startup smoke, and the
release receipt sequence.

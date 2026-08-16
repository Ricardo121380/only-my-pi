# Node and Pi compatibility matrix

| Runtime | Role | Evidence |
| --- | --- | --- |
| Node 22.19.0 | minimum supported/CI lane | GitHub Actions matrix; Pi engine requirement |
| Node 24.x | current CI compatibility lane | GitHub Actions matrix |
| Node 25.8.0 darwin-arm64 | local development snapshot | M0–M7 local gates and fresh tarball smoke |
| Pi 0.84.1 | pinned development/host contract | package peer/dev dependency, no-model RPC smoke |
| Pi 0.84.2 | registry advertised but not validated here | intentionally not installed by this Goal |

The matrix is a compatibility statement, not a Provider guarantee. No row
authorizes a global install or a real `~/.pi` mutation. Updating Pi or Node
requires rerunning package governance, the no-model startup smoke, and the
release receipt sequence.

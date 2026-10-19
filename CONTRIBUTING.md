# Contributing to only-my-pi

only-my-pi is in Public Preview. Issues and narrowly scoped pull requests are
welcome, but maintainers may defer or decline changes while the release,
security and compatibility contracts settle. Opening an Issue before a large
change is strongly recommended. Acceptance is not guaranteed.

## Before submitting

- Keep changes within the [current development blueprint](docs/plans/2026-10-17-product-direction-and-iteration-plan.md) and originating Issue, preserving explicit authorization and ownership boundaries.
- Use exact versions and preserve external/user ownership for third-party
  packages.
- Add focused tests and run the relevant manifest-backed gates.
- Do not commit secrets, credentials, cookies, sessions, raw prompts/model
  output, private source, package caches, release bundles or copied third-party
  implementation code.
- Do not weaken lifecycle-script, download-host, transaction, rollback or
  protected-evidence checks to make a test pass.
- Discuss dependency additions and license implications in the Issue or PR.

Start with:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run test:prepare
npm test
npm run lint
npm run typecheck
npm run verify:m11:run
```

`test:prepare` prepares the pinned PTY binding and installs the committed
platform-specific external-package lock without lifecycle scripts. Real
extension tests use these isolated dependencies, never `~/.pi/agent`.

The complete native test suite runs on macOS 14+ arm64 with Node 22.19.0 and
24.19.0 because controlled stdio MCP currently requires Seatbelt. Linux
distribution, installation and sandbox checks run separately in
`.github/workflows/linux-candidate.yml`; they do not establish Linux MCP support.

PRs must pass the required repository checks. Protected Provider/live-model and
real-root gates are maintainer-run; contributors are never expected to provide
credentials or production evidence. The project currently requires neither a
CLA nor DCO sign-off.

Keep each completed work batch traceable to its source commit and relevant
checks. Before an authorized GitHub sync, review the complete outgoing history
for private data, push an explicit branch, and read back the remote SHA. Record
any work that remains local; a successful push is not a CI or release verdict.
The [repository maintenance guide](docs/maintenance/README.md) describes the
folder layout, preservation of existing work, and archived branch recovery.

Security reports must use GitHub Private Vulnerability Reporting, not a public
Issue. See [SECURITY.md](SECURITY.md).

By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md).

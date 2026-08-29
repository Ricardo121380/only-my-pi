# Contributing to only-my-pi

only-my-pi is in Public Preview. Issues and narrowly scoped pull requests are
welcome, but maintainers may defer or decline changes while the release,
security and compatibility contracts settle. Opening an Issue before a large
change is strongly recommended. Acceptance is not guaranteed.

## Before submitting

- Keep changes inside the current read-only Pi Harness boundary.
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
npm test
npm run lint
npm run typecheck
npm run verify:m11:run
```

PRs must pass the required repository checks. Protected Provider/live-model and
real-root gates are maintainer-run; contributors are never expected to provide
credentials or production evidence. The project currently requires neither a
CLA nor DCO sign-off.

Security reports must use GitHub Private Vulnerability Reporting, not a public
Issue. See [SECURITY.md](SECURITY.md).

By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md).

# ADR-0009: Public Web and project gate authority

Status: Accepted, 2026-08-27.

## Decision

The `web` overlay permits public HTTP(S) research only after confirmation for
each run. Browser cookies, custom authorization headers, private-range
exceptions and trusted proxy bypasses are forbidden. The reviewed
`pi-web-access` SSRF/redirect checks are dependency evidence; only-my-pi also
performs configuration preflight and black-box denial tests.

Project commands come only from a trusted repository's
`.pi/only-my-pi-gates.json`. Entries are bounded argv executions with
`shell:false`, a contained cwd, scrubbed environment and exact executable
resolution. A session grant binds the Pi session, repository realpath and HEAD,
manifest digest, gate set, argv/env/cwd digests and executable realpath. Drift
invalidates the grant.

## Consequences

A gate grant is a process allowlist, not a filesystem sandbox; build artifacts
may be created. Tester Agents consume receipts and never execute arbitrary
shell. A Web or gate authority failure blocks only that surface, not unrelated
read-only runs.

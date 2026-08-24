# Subagents S5 release boundary

S5 adds a release-governance layer for the Pi-native subagents successor. It
does not add another child runtime, scheduler, Provider, or Kimi integration.
The ownership boundary remains:

```text
@only-my-pi/subagents (logical Agent/Batch/Workflow/SwarmGoal/UltraRun)
        |
        +-- one RunCoordinator + journal + budget/approval policy
        |
        `-- pi-subagents@0.45.2 (sole physical child runtime)
              |-- structured delegation: foreground Agent/Batch + cancel
              `-- extension RPC: async workflow/background/resume/control
```

## Versioned contracts

- `contracts/subagents/compatibility-matrix.json` pins the supported Node/Pi/
  `pi-subagents` tuple and records each environment scope as `PASS`,
  `CONFIGURED_UNVERIFIED`, `NOT_RUN_BY_POLICY`, `NOT_RUN_ENVIRONMENT`, or
  `UNAVAILABLE`. A `PASS` Node row must contain an exact semver; floating
  values such as `24.x` cannot become compatibility evidence.
  `matrixDigest` identifies the stable runtime/contract baseline: its digest
  projection normalizes the five protected live scopes to
  `NOT_RUN_BY_POLICY` and excludes `verification/protected/*` paths. This
  avoids a circular digest when an evidence-only child commit promotes those
  exact scopes; the overlay remains valid only when its source-bound Ed25519
  evidence passes independently. Runtime tuple, owners, static scopes and
  non-protected evidence remain digest-bound.
- `contracts/subagents/promotion-policy.json` defines cumulative Preview,
  Alpha, Beta, and Stable requirements. Its digest is checked before any
  evaluation. The policy requires protected evidence for live child,
  background/resume, and writer claims; a checked-in JSON object cannot forge
  those claims.
- `contracts/subagents/protected-evidence-trust.json` is the source-pinned
  Ed25519 public-key policy for protected evidence. It retains the historical
  Alpha public signer and adds an independent time-bounded Beta public signer
  scoped to the cumulative five Alpha/Beta evidence classes. Private keys
  remain external, and live promotion is impossible without separate exact
  one-time authorizations.
- `subagents-live-evidence-authorization-v1` and the
  [S5-A capture driver](subagents-s5-live-capture.md) define the producer side
  for the three Alpha read-only evidence classes. The default plan is inert;
  real execution requires a clean exact source, a runtime-ready trust policy,
  a one-time bounded authorization, an empty disposable Pi root and synthetic
  fixture workspace, a canonical drift-checked `omp-reviewer`, an external
  digest-only signer, every explicit path, and `--yes`.
- `subagents-background-resume-authorization-v1` and the
  [S5-B producer](subagents-s5-background-resume.md) separately bind the
  two-parent-process persisted-session and public-resume scenario. Its
  Provider descriptor is credential-free and digest-bound by authorization.
- `subagents-guarded-writer-authorization-v1` and the
  [S5-C producer](subagents-s5-guarded-writer.md) bind exactly one canonical
  writer, one synthetic repository/base commit, one managed worktree, one exact
  file claim, parent-side Git verification and fixed gates. The output is a
  handoff only; automatic integration is forbidden. Its Provider descriptor is
  likewise credential-free and digest-bound.
- `subagents-guarded-writer-reconciliation-v1` and the
  [S5-D fault/recovery contract](subagents-s5-fault-recovery.md) turn preserved
  or partial disposable runtime state into a digest-bound review plan. The
  planner has no delete/apply operation and never treats a complete runtime as
  implicit cleanup permission.
- `verification/release-gates-v2.json` digest-pins every v1 gate and adds the
  fixed S5 deterministic/protected gate set. Command, argv, environment,
  timeout, channel, and protected execution semantics are code-validated;
  arbitrary manifest replacement is rejected.

## Execution semantics

```bash
npm run verify:subagents                         # inspect only; no subprocesses
npm run verify:subagents:run                     # execute Preview deterministic gates
npm run plan:subagents-live-evidence             # inspect Alpha capture readiness
npm run plan:subagents-background-resume         # inspect Beta resume readiness
npm run plan:subagents-guarded-writer             # inspect Beta writer readiness
npm run plan:subagents-guarded-writer-cleanup     # input-required, review-only reconciliation
node scripts/subagents-release-gates.mjs --run \
  --promotion alpha \
  --source-commit <source-commit> \
  --protected-evidence live-agent-terminal=verification/protected/live-agent-terminal.json \
  --protected-evidence live-agent-cancel=verification/protected/live-agent-cancel.json \
  --protected-evidence live-batch-terminal=verification/protected/live-batch-terminal.json \
  --output verification/receipts/<report>.json --json
```

The runner requires a clean source commit, executes only gates marked
`deterministic`, and checks that the commit did not change while the gates
were running. Protected live gates have no command or argv; they are emitted as
`NOT_RUN_BY_POLICY` unless the separately authorized evidence-import path is
used. Thus Preview can complete its deterministic contract set, while
Alpha/Beta/Stable remain blocked until their explicit live scopes, signatures,
and protected evidence are present.

The separate live-capture command never writes into `verification/protected/`
or performs the evidence-only Git import. It stages reviewable files in an
operator-selected empty directory. `declaredEndpointHosts` is metadata bound
into the authorization; it is not an OS network allowlist or sandbox.

## Source-pinned evidence import

Live promotion is a two-commit protocol:

1. The source commit contains the exact runtime, schemas, promotion policy,
   release gates, compatibility baseline, and an explicitly configured
   Ed25519 public-key trust policy.
2. An authorized disposable-root run produces bounded evidence documents. Each
   document signs its canonical payload digest and binds the source commit,
   trust-policy digest, promotion-policy digest, compatibility-matrix digest,
   exact Node/Pi/backend tuple, required proof-receipt digests, authorization,
   and privacy boundary.
3. A direct single-parent child commit may change only the compatibility matrix
   and introduce the exact named `verification/protected/*.json` files. It may
   not change code, schemas, gates, policy, trust keys, docs, or delete files.
4. The release runner executes deterministic gates against that clean evidence
   commit, re-verifies every signature/file/reference, and records both the
   promoted source commit and evidence commit. It never executes a protected
   gate itself.

The Alpha import requires the terminal, cancellation, and at-least-two-item
BatchSwarm evidence classes. Beta additionally requires background/resume and
guarded-writer evidence. Stable is cumulative and cannot bypass either set.
The same exact evidence class cannot be supplied by a descriptor, symlink,
pre-existing source file, unrelated descendant commit, or untrusted signer.

The report stores status, gate IDs, bounded output byte counts and hashes, and
authorization/privacy boundaries. It never stores raw stdout/stderr, host
paths, credentials, or session content. A receipt is generated only after a
clean source commit; it is not a substitute for live Provider or worktree
evidence.

## What S5 currently proves

The repository now has deterministic coverage for ownership/topology, public
exports, v2 schema/semantics, migration, journal/recovery, terminal proof,
security red-team cases, offline evaluation, provenance, listener/timer leak
soaks, and compatibility contract validation. The local no-model Pi probe is
still the only live evidence and proves startup/RPC ownership—not child
execution, model quality, cancellation, background resume, or writer safety.

No live gate is promoted by inference. The importer, authorization/capture
schemas, digest-only signer boundary, Pi Alpha scenario driver, signature
verification, direct-child Git boundary, background/resume producer, and
guarded-writer producer now exist. The writer producer does not trust the child
patch or path report: it recomputes the staged diff and fixed gates in the
preserved worktree and emits a handoff without integration. The checked-in
trust policy now has distinct bounded Alpha and Beta public signers. A public
key is not execution authorization and does not itself promote a channel; the
current checked-in Alpha receipt remains the latest completed promotion until
the cumulative five source-bound documents pass the Beta gate.
S5-D additionally proves deterministic fail-closed handling for missing
terminal records, malformed or missing handoff state, parent Git failure,
signer/staging interruption and post-capture source drift. Its reconciliation
planner retains every existing target for review and exposes no mutation API.

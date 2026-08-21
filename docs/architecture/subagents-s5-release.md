# Subagents S5 release boundary

S5 adds a release-governance layer for the Pi-native subagents successor. It
does not add another child runtime, scheduler, Provider, or Kimi integration.
The ownership boundary remains:

```text
@only-my-pi/subagents (logical Agent/Batch/Workflow/SwarmGoal/UltraRun)
        |
        +-- one RunCoordinator + journal + budget/approval policy
        |
        `-- pi-subagents@0.45.2 extension RPC (sole physical child runtime)
```

## Versioned contracts

- `contracts/subagents/compatibility-matrix.json` pins the supported Node/Pi/
  `pi-subagents` tuple and records each environment scope as `PASS`,
  `CONFIGURED_UNVERIFIED`, `NOT_RUN_BY_POLICY`, `NOT_RUN_ENVIRONMENT`, or
  `UNAVAILABLE`. A `PASS` Node row must contain an exact semver; floating
  values such as `24.x` cannot become compatibility evidence.
- `contracts/subagents/promotion-policy.json` defines cumulative Preview,
  Alpha, Beta, and Stable requirements. Its digest is checked before any
  evaluation. The policy requires protected evidence for live child,
  background/resume, and writer claims; a checked-in JSON object cannot forge
  those claims.
- `contracts/subagents/protected-evidence-trust.json` is the source-pinned
  Ed25519 public-key policy for protected evidence. The repository default is
  deliberately `configured-unavailable` with no signer. A live promotion is
  impossible until an operator explicitly commits an authorized public key;
  the corresponding private key must never enter the repository.
- `subagents-live-evidence-authorization-v1` and the
  [S5-A capture driver](subagents-s5-live-capture.md) define the producer side
  for the three Alpha read-only evidence classes. The default plan is inert;
  real execution requires a clean exact source, a runtime-ready trust policy,
  a one-time bounded authorization, an empty disposable Pi root and synthetic
  fixture workspace, a canonical drift-checked `omp-reviewer`, an external
  digest-only signer, every explicit path, and `--yes`.
- `verification/release-gates-v2.json` digest-pins every v1 gate and adds the
  fixed S5 deterministic/protected gate set. Command, argv, environment,
  timeout, channel, and protected execution semantics are code-validated;
  arbitrary manifest replacement is rejected.

## Execution semantics

```bash
npm run verify:subagents                         # inspect only; no subprocesses
npm run verify:subagents:run                     # execute Preview deterministic gates
npm run plan:subagents-live-evidence             # inspect Alpha capture readiness
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
verification, direct-child Git boundary, and background/resume gate now exist.
The checked-in trust policy still has no signer, however, and no protected live
evidence has been produced. The current release claim therefore remains
Preview.

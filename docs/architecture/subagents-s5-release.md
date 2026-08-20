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
- `verification/release-gates-v2.json` digest-pins every v1 gate and adds the
  fixed S5 deterministic/protected gate set. Command, argv, environment,
  timeout, channel, and protected execution semantics are code-validated;
  arbitrary manifest replacement is rejected.

## Execution semantics

```bash
npm run verify:subagents                         # inspect only; no subprocesses
npm run verify:subagents:run                     # execute Preview deterministic gates
node scripts/subagents-release-gates.mjs --run \
  --promotion alpha --output verification/receipts/<report>.json --json
```

The runner requires a clean source commit, executes only gates marked
`deterministic`, and checks that the commit did not change while the gates
were running. Protected live gates have no command or argv; they are emitted as
`NOT_RUN_BY_POLICY` unless a separately authorized evidence importer is added.
Thus Preview can complete its deterministic contract set, while Alpha/Beta/
Stable remain blocked until their explicit live scopes and protected evidence
are present.

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

No live gate is promoted by inference. A future authorized run must add a
protected evidence file under `verification/protected/`, bind its source and
runtime identities, and then re-run the promotion evaluator.

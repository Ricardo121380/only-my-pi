# Quickstart

`only-my-pi` is a local Pi package and configuration companion. The repository
does not replace Pi's model runtime, credentials, permission owner, or TUI. The
quickstart therefore begins with a disposable Pi directory and a zero-write
plan.

## Prerequisites

- Node.js 22.19.0 or newer (Node 22.19.0 and 24.x are the CI matrix);
- a compatible Pi host, validated here against
  `@earendil-works/pi-coding-agent@0.84.3`;
- a clean checkout and no credentials in the repository.

Install dependencies without executing package lifecycle scripts:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run doctor
npm run schema:check
npm run verify
```

`npm run verify` is an inspector only. It validates the one
`release-gates-v1` manifest and does not execute gates. The final receipt form
is reserved for a clean source commit and `npm run verify -- --run`.

## Disposable local bootstrap

Use an explicit directory so the experiment cannot silently modify the normal
Pi home:

```bash
export PI_CODING_AGENT_DIR="$(mktemp -d)"
node bin/omp.mjs bootstrap --profile minimal --mode inspect --config-root "$PI_CODING_AGENT_DIR"
```

Review the plan. A plan has `mutation:false` and zero-write evidence. To apply
it deliberately:

```bash
node bin/omp.mjs bootstrap \
  --profile minimal \
  --mode inspect \
  --config-root "$PI_CODING_AGENT_DIR" \
  --apply --yes

node bin/omp.mjs status --config-root "$PI_CODING_AGENT_DIR"
node bin/omp.mjs doctor --config-root "$PI_CODING_AGENT_DIR"
node bin/omp.mjs safe --config-root "$PI_CODING_AGENT_DIR"
```

The apply path stages an immutable generation, publishes only owned settings
last, runs the static doctor, and starts Pi in an isolated no-model RPC smoke.
It does not submit a prompt or read a Provider key. Extension code still has
the invoking OS user's authority; this smoke is startup evidence, not a
whole-session sandbox.

## Daily local installation

After the protected M10 promotion, the current user-level CLI is available as
`~/.local/bin/omp`. It manages installation, status, diagnosis and rollback;
it never executes Agent tasks. Use `/omp` inside Pi for Agent, BatchSwarm,
Workflow, SwarmGoal and Ultra runs.

```bash
omp version --json
omp status --json
omp doctor --json
```

The expected Stable identities are Pi `0.84.3`, `pi-subagents@0.57.0`, an
`INSTALLED` status, generation alignment `MATCH`, and seven daily bindings
that remain `external/owner=user`.

## Inspect the product surfaces

```bash
node bin/omp.mjs mode list
node bin/omp.mjs workflow list
node bin/omp.mjs swarm list
node bin/omp.mjs theme list
node bin/omp.mjs theme preview only-my-pi-dark
node bin/omp.mjs status --json
```

Pi users get the same control plane through the single `/omp` extension. The
theme `use` and `reset` paths remain plan-first and require explicit approval;
headless callers receive `THEME_APPLY_UNAVAILABLE` because no private TUI
driver is invented.

## Build from the packed artifact

The release smoke, which is also the `test:e2e` gate, starts from `npm pack`
and installs into a temporary prefix with scripts disabled and npm offline:

```bash
npm run test:e2e
```

Before installing the local artifact it builds a disposable lockfile that points
at the freshly packed tarball, then runs `npm ci --offline` against the
repository's exact dependency entries; the artifact install therefore does not
depend on a registry packument being present in the CI cache. It validates the
tarball integrity, executable `.bin/omp` and `.bin/pi`,
checkout independence, dry-run/apply/no-op/doctor/safe/rollback, and the
no-model startup contract. It never uses the real Pi home or a live Provider.

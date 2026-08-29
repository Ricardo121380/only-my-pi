# Quickstart

`only-my-pi` is a user-local, read-only Pi Agent Harness. The public Preview
installs a controlled Pi runtime but does not replace Pi's credential flow,
model runtime, permission owner, or TUI. Agent execution remains available only
through `/omp` inside Pi; the terminal `omp` manages installation, diagnosis,
release checks, rollback and removal.

## Public Preview installation

The supported public platform is macOS 14 or newer running natively on Apple
Silicon arm64. Intel Macs, Rosetta, Linux and Windows fail before staging. No
preinstalled Node is required: the stack contains official Node `24.19.0` and
Pi `0.84.3`. The installer is user-local and must not be run with `sudo`.

Default Thin install:

```bash
tmp="$(mktemp -d)" && curl --fail --proto '=https' --tlsv1.2 -o "$tmp/install.sh" 'https://github.com/Ricardo121380/only-my-pi/releases/download/v0.2.0-preview.1/install.sh' && printf '%s  %s\n' 'b598cea9b09da5693af369da7bd8fe2e5f6bbfa4f1049a4ebd53080d543a760f' "$tmp/install.sh" | shasum -a 256 -c - && /bin/sh "$tmp/install.sh" --release 0.2.0-preview.1 --payload thin --yes
```

The command downloads to disk and verifies the exact bootstrap SHA before
execution. Thin then retrieves only digest-bound bytes from the fixed GitHub,
nodejs.org and registry.npmjs.org sources. Redirects are handled manually and
each destination is revalidated. Credentials, `.npmrc`, GitHub tokens and
browser state are not read.

For the Full path, download `install.sh`, the Full archive,
`release-index.json`, `stack-manifest.json` and `SHA256SUMS` from the exact tag;
verify the published checksums and attestations, then use the verified CLI to
review and apply the local bundle:

```bash
omp stack install --bundle /absolute/path/only-my-pi-0.2.0-preview.1-darwin-arm64-full.tar.gz --plan --json
omp stack install --bundle /absolute/path/only-my-pi-0.2.0-preview.1-darwin-arm64-full.tar.gz --apply --yes --json
```

Once those files are local, Full plan/apply performs no network acquisition.
Full and Thin are required to converge on the same `stackId`, Node/Pi trees,
external package tree, only-my-pi artifact and generation graph.

Optionally verify GitHub provenance in addition to SHA-256:

```bash
gh release verify v0.2.0-preview.1 --repo Ricardo121380/only-my-pi
gh attestation verify only-my-pi-0.2.0-preview.1-darwin-arm64-thin.tar.gz --repo Ricardo121380/only-my-pi
```

`gh` is optional for installation; checksum verification is mandatory.

## PATH and first run

The controlled commands are `~/.local/bin/omp` and `~/.local/bin/pi`. The
installer does not edit shell files by default. `PATH_ACTION_REQUIRED` means
the stack committed successfully but `~/.local/bin` is not visible in the
current shell. Follow the printed action or rerun the reviewed apply with
`--configure-shell`; that option accepts only a real regular profile, creates a
backup, and writes one idempotent marker block.

Verify identities before configuring a model:

```bash
command -v omp
command -v pi
omp version --json
omp stack status --json
omp status --json
omp doctor --json
```

Start `pi`, complete Pi's normal Provider/model setup without placing secrets
in only-my-pi configuration, then invoke:

```text
/omp run
```

The wizard previews roles, models, Web/Gate authority and budgets. Public Web
requires a separate per-run confirmation and browser cookies remain disabled.
The default `daily` preset is `core + web + orchestration-readonly +
ui-terminal`; memory, sync and MCP remain off.

## Existing Pi environments

- An exact verified nine-package tree is borrowed as
  `PREEXISTING_EXTERNAL`; it is never adopted or removed by only-my-pi.
- A governed partial tree can be completed only when every existing required
  package is exact and no unrelated top-level package is present. Its original
  root is retained as LKG.
- A different required version, lock/SRI/tree drift, duplicate identity,
  unknown top-level package, unsafe symlink, or existing unknown `pi`/`omp`
  shim returns a zero-write conflict with a reconciliation plan.
- Homebrew Pi and Node are never modified. Removing the user-local shims makes
  the system commands visible again according to normal `PATH` order.

Always run the plan first when the machine already has Pi state:

```bash
omp stack install --release 0.2.0-preview.1 --payload thin --plan --json
```

## Source-development prerequisites

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

## Existing M10 local installation

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

Public stack lifecycle and Harness-only lifecycle are separate. See
[Migration, rollback, and uninstall](migration-uninstall.md) before changing
either one.

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

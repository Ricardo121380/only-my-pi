# Quickstart

`only-my-pi` is a guarded user-local terminal coding Agent built on Pi. The
daily entry is `omp`; Pi remains the internal TUI, model/session runtime and
tool host.

## Current availability

M12 `0.3.0-preview.1` passed local C1-C12 acceptance on source `2d6efbd` and is
installed on the acceptance host. Public distribution remains on hold pending
hosted CI and the release workflow. There is no public `0.2.0-preview.1`
Release, and the old installer URL must not be used.
The checked-in `distribution/install.sh` is a future exact-version M12
bootstrap input, not evidence that a public Release exists.

Source developers should complete C1-C10 before any real-stack mutation:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run schema:check
npm run pack:check
npm run verify:m12
```

`npm run verify:m12` inspects the C1-C12 contract. After a clean source commit,
`npm run verify:m12:run` executes C1-C10 locally. Without an explicit evidence
import it still reports C11/C12 as `NOT_RUN_BY_POLICY`; deterministic tests
cannot manufacture those results. The accepted source/evidence pair and all
12 PASS results are recorded in the
[local closure receipt](../verification/receipts/2026-09-09-m12-local-closure.json).

## Daily terminal Agent

After an M12 candidate has been installed by the protected local acceptance
flow:

```bash
cd /path/to/project
omp
```

Startup verifies the active controlled stack, enters Pi with an exact audited
extension list, honors Pi Project Trust, and opens a searchable authenticated
model picker. Current-session and recent models appear first. Cancelling the
picker exits instead of silently choosing another model.

Common forms:

```bash
omp "fix the failing login test"        # start with an initial task
omp -c                                   # continue the latest session
omp -r                                   # choose a session to resume
omp --model provider/model-id            # explicit model; no startup picker
omp -p "review the permission boundary" # headless and always read-only
```

If Pi has no authenticated model, use the controlled/raw `pi` command to
complete Pi's normal Provider setup. only-my-pi stores only the recent
`provider/model-id`; it never stores or reports the credential.

## Planning and coding access

Every interactive process begins in `Inspect`. Read, search, LSP, bounded
read-only subagents and separately approved Web research are available; edit,
write, bash, project gates and a writer child are not.

For a small local change the Agent inspects first, then asks once for project
coding access. For a complex or explicitly planned task it must present the
scope, risks, full plan, subagent strategy and verification before the same
approval. Approval lasts only for that `omp` process and never grants project-
external writes, secret access, MCP, arbitrary network, destructive Git,
deployment, publication or silent commits.

Inside the TUI:

```text
/plan <task>    require the full planning path
/access         show the current session state
/access revoke  immediately return to Inspect
/agents         show visible automatic child work
/exit           gracefully return to the shell
```

Ctrl+D exits when the editor is empty. Pi retains its native Ctrl+C behavior;
OMP does not place a wrapper process between the terminal and Pi.

## Working trees and subagents

OMP records HEAD, branch and a digest-only summary of dirty paths before
coding. It never resets, checks out, cleans or attributes existing changes to
the Agent. The main Agent re-reads a file immediately before modifying it.

Simple work remains with the main Agent. Complex work may use at most two
read-only scouts, one managed-clone writer and one fresh reviewer. `pi-subagents`
is the sole physical child runtime. A writer clone never receives uncommitted
user content. If its scope overlaps dirty paths, the writer is not started and
the main Agent works in the original tree. A reviewed patch is applied only
when its base, scope, paths, digest, dry-run and current worktree still match;
verification then runs again in the real worktree. OMP does not stage or commit
unless the user explicitly asks for a commit.

## Management and diagnosis

The canonical management namespace is `omp admin`:

```bash
omp admin version --json
omp admin status --json
omp admin doctor --json
omp admin stack status --json
```

`omp status`, `omp doctor`, `omp version`, `omp stack ...`, `omp release ...`
and `omp upstream ...` remain compatibility aliases for one Preview cycle. To
use a management word as the task itself, add the separator: `omp -- "status"`.

The doctor reports launcher, controlled Pi, exact extension set, permission
sandbox, managed writer and recent-model readiness separately. It does not
probe Provider credentials.

## Installation and ownership boundary

The managed platform remains macOS 14+ on native Apple Silicon with embedded
Node `24.19.0`, controlled Pi `0.84.3` and the exact nine-package tuple. The
system Homebrew Node/Pi installation is not modified.

All nine third-party Pi packages remain `external/owner=user`, whether they
were already present or explicitly provisioned for the user. only-my-pi owns
its artifact, generated resources, generation, private run data and controlled
stack pointers; it does not adopt the package tree. Harness uninstall and
full-stack removal remain different explicit operations.

Before a future stack install or update, always review the zero-write plan.
Mutating apply requires `--apply --yes`; stopping an active Pi process requires
the separate `--terminate-pi` authority and only bounded `SIGTERM` is allowed.

## Advanced compatibility surfaces

Inside a direct Agent, `/omp run` is retired and explains that the user can
type a task directly. Historical Agent/Workflow/Swarm/Goal/Ultra controls live
under `/omp advanced ...` for regression and expert diagnosis. They use the
same session composer, budgets, artifacts and `pi-subagents` runtime; they do
not create a second permission owner or scheduler.

The standalone `pi` command remains the advanced/raw Pi entry. Its extension
discovery may differ from the guarded direct OMP session, so use it only when
that distinction is intentional.

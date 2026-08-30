# ADR-0013: Make `omp` the direct terminal coding Agent

Status: Accepted for M12 implementation

Date: 2026-08-30

## Context

M8-M10 built and verified a governed Pi Harness kernel. M11 then proved a
user-local, reproducible distribution path. The resulting daily interaction is
nevertheless the wrong product: users must start `pi`, invoke `/omp run`, and
choose an orchestration primitive before they can describe a task. Production
Agents are also fixed to a read-only ceiling, so the installed product cannot
provide the ordinary edit-test-review loop expected from a terminal coding
Agent.

Pi already owns the TUI, editor, model registry, sessions, signals and core
tools. Replacing those surfaces would add another terminal runtime without
improving the user contract. The missing layer is a small direct launcher and
one session-scoped coding-admission policy.

## Decision

### Product entry

- `omp` is the daily product entry. With no management command it replaces its
  process with the controlled Pi CLI from the active only-my-pi stack.
- `omp admin ...` is the canonical management namespace. Existing unambiguous
  management commands remain compatibility aliases for one Preview cycle.
- Pi remains the sole TUI, session and model runtime. The standalone `pi`
  command remains available as an advanced/raw Pi entry.
- `/omp run` is retired as a daily wizard. Existing Workflow, Swarm, Goal and
  Ultra controls remain under `/omp advanced` for diagnostics and compatibility.

### Session and model behavior

- Every interactive `omp` process selects an authenticated Pi model before
  normal editing. The previous OMP selection is highlighted but never used
  silently when the picker is cancelled.
- `omp -c` and `omp -r` reuse Pi session behavior. Conversation and approved
  plans may be restored; coding authority never is.
- `omp -p` is read-only. It cannot obtain coding authority or activate a writer.
- `/exit` delegates to Pi's graceful shutdown. Pi continues to own Ctrl+C,
  Ctrl+D, terminal restoration and the final process exit code.

### One visible permission state

Direct sessions expose only `Inspect`, `Planning` and `Coding`:

1. `Inspect` starts with read-only tools.
2. `Planning` remains read-only and produces a decision-ready plan.
3. `Coding` begins only after one interactive, session-scoped approval through
   `request_coding_access`.

Complex tasks require a complete plan. A simple local change may request the
same coding approval with a bounded task, scope and verification summary.
Approval reveals only the audited coding tool set for the current process.
`/access revoke` returns to `Inspect`. A new or resumed process must approve
again.

`pi-permission-modes` remains the physical policy and macOS sandbox owner. OMP
owns only the coarser session admission and an independent tool-call backstop.
The external package remains user owned. The third-party plan-mode package also
remains user owned, but its extension is not activated by the M12 direct
generation; OMP owns the one visible `/plan` state machine.

### Workspace and orchestration

- The main Agent may edit the current repository after coding approval. It
  records the pre-existing Git state and never resets, cleans, reverts or
  silently overwrites user changes.
- `pi-subagents` remains the sole physical child runtime. OMP may choose
  read-only scouts, one writer and a fresh reviewer automatically; users do not
  select a Swarm or Workflow for ordinary tasks.
- A writer uses an OMP-managed ordinary Git clone, not a worktree. A dirty path
  overlapping the approved scope disables the child writer and leaves the main
  Agent responsible for that work in place.
- Writer changes are applied only after scope, base, drift, patch, verification
  and fresh-review checks pass. Integration never stages or commits by default.

### Release boundary

- `0.2.0-preview.1` remains `HOLD_PUBLICATION` and is classified as internal
  distribution foundation, not current product release authority.
- The first public candidate with this product contract is
  `0.3.0-preview.1`, with capability ceiling `GUARDED_PROJECT_CODING`.
- M11 Full/Thin acquisition, SBOM, notices, stack transaction and rollback
  mechanisms are retained. GitHub publication remains blocked until local M12
  gates and the protected coding matrix pass and hosted quota is available.

## Consequences

The smallest daily path becomes `cd <repo> && omp`. Users no longer need to
understand the internal Agent, Workflow, Swarm, Goal or Ultra strategies. OMP
does not own a second TUI, model registry, session store, permission sandbox or
child process pool.

This milestone introduces real project mutation. Project Trust and tool hiding
are not OS isolation; the physical sandbox, protected paths, command policy and
explicit external authorities remain required. Coding approval is deliberately
ephemeral and does not authorize project-external writes, secret access, MCP,
arbitrary network access, deployment, publication, destructive Git operations
or silent YOLO behavior.

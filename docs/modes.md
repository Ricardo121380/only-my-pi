# Modes

Modes are versioned, declarative prompt and capability projections. A Mode can
narrow a selected Profile; it cannot add a package, tool, workspace, or egress
capability. The registry resolves built-ins, explicitly trusted project/user
resources, and reviewed-package resources with deterministic source hashes.

## Built-in matrix

| Mode | Intended use | Default posture | Completion evidence |
| --- | --- | --- | --- |
| `inspect` | understand a repository or artifact | read-only, no mutation | bounded report |
| `explore` | map code and dependencies | read-only, bounded search | repo-map/context report |
| `plan` | produce an implementation plan | read-only; writes unavailable | plan with risks and gates |
| `coding` | implement an approved change | writer ceiling, managed worktree required for parallelism | tests and diff receipt |
| `debug` | isolate a reproducible fault | read-only first; coding transition requires parent approval | hypothesis and verifier gate |
| `review` | inspect a change | no writer tools; fixed Gate Runner only | severity-labelled findings |
| `research` | gather and synthesize evidence | web capability only when Profile selects it | source-backed synthesis |
| `verify` | run allowlisted checks | no arbitrary shell; Gate Runner only | deterministic gate receipt |

List, explain, compare, and validate without changing state:

```bash
node bin/omp.mjs mode list
node bin/omp.mjs mode show coding --resolved
node bin/omp.mjs mode diff inspect coding
node bin/omp.mjs mode doctor
```

`mode use` is plan-first. When Pi has no audited public execution-state driver,
an envelope-changing activation reports `RESTART_REQUIRED` or `UNAVAILABLE`;
the extension does not pretend that `setActiveTools` or a prompt change is a
hard sandbox. A restored mode receipt is accepted only when the current mode
and source hashes still match.

## Adding a Mode

Create a new versioned JSON document and prompt under a governed source root,
then run `npm run doctor:modes`, `npm run schema:check`, and the negative
policy fixtures. Do not edit the core registry or use a project file from an
untrusted repository as an implicit override. A mode must declare its Profile
ceiling, tool mutation boundary, workspace/egress posture, workflow, and
completion contract.

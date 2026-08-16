# ADR-0002: Build a Pi Harness distribution, not a second agent runtime

## Status

Accepted — 2026-08-16

## Context

Pi deliberately keeps its core small and exposes extensions, skills, prompts,
themes, packages, Profiles, and SDK/runtime events as composition surfaces.
This repository already contains useful offline experiments for ACP,
DeepSeek-compatible transport behavior, and Git-backed workspace recovery. None
of those experiments makes the repository a usable Harness distribution on its
own, and promoting them to the main roadmap would duplicate responsibilities
already owned by Pi or by governed Pi packages.

The desired product is a personal, reproducible Pi Harness that can be
installed, inspected, narrowed for a task, recovered, and extended without
forking Pi or silently changing the user's security envelope.

## Decision

`only-my-pi` is a distribution and governance layer on top of Pi. Its primary
product surfaces are:

1. an idempotent, dry-run-first bootstrap and rollback CLI;
2. load-time Profiles that establish package, resource, and capability
   ceilings;
3. runtime Task Modes that may only narrow an active Profile;
4. declarative Agent roles and Workflows with fixed result contracts;
5. bounded AgentSwarm recipes that compile to the governed `pi-subagents`
   public RPC surface while leaving physical child scheduling to that package;
6. one `omp` / `/omp` control surface, truthful status, and lightweight themes;
7. schemas, package governance, recovery evidence, and release gates that make
   those surfaces auditable.

Pi remains the only agent/model/tool/session runtime. `pi-permission-modes`
remains the policy and conditional Bash-sandbox owner; `pi-subagents` remains
the child-runtime and physical scheduling owner. only-my-pi must not register a
second `subagent` tool, create a competing permission engine, import private
package internals, or claim that prompts, Project Trust, or tool visibility are
an operating-system sandbox.

ACP v1, DeepSeek Provider conformance, and workspace checkpoint stay in Labs.
They are offline, explicitly invoked seams, are excluded from default Profiles,
and do not block the Harness product roadmap. A Labs module can graduate only
through a new decision that names its runtime owner, capability boundary,
security tests, package/resource placement, rollback path, and default state.

## Consequences

- The main implementation sequence is governance, bootstrap, Modes,
  Workflows/roles, AgentSwarm, and UI/release readiness.
- Existing Labs code remains tested and documented, but no live Provider,
  Pi-RPC, automatic turn hook, or hidden background integration is implied.
- Extensions integrate through public Pi APIs and versioned contracts. When a
  hard enforcement surface has no audited public driver, status is
  `RESTART_REQUIRED`, `UNSUPPORTED`, or `UNKNOWN`; prompt-only behavior cannot
  be reported as enforced.
- New Task Modes, roles, and recipes are data resources discovered through
  registries. Adding one does not require forking Pi or editing a hard-coded
  runtime switch.

## Rejected alternatives

- Forking Pi and maintaining a second model/tool/session loop.
- Making ACP-to-Pi wiring or a DeepSeek HTTP adapter the next product milestone.
- Implementing a second subagent scheduler beside `pi-subagents`.
- Treating a permission prompt, plan label, Node VM, worker thread, or project
  trust decision as complete process isolation.
- Automatically enabling experimental modules because their offline tests
  pass.

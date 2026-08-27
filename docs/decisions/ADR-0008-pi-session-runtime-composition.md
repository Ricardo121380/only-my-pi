# ADR-0008: One Pi session runtime composer

Status: Accepted, 2026-08-27.

## Decision

`omp-control` creates exactly one session-scoped composer. It injects the
configuration/model resolvers, capability ceiling, budget ledger, event
journal, plan and artifact stores, Agent/Batch executors, unified
RunCoordinator, SwarmGoal controller and Ultra router. The first-party logical
owner remains `@only-my-pi/subagents`; the sole physical child owner remains the
reviewed `pi-subagents` package.

The standalone `omp` CLI never dispatches a child. Pi shutdown disposes live
subscriptions and marks unsettled local work interrupted; resume is explicit in
a later Pi session. There is no daemon and no silent restore.

## Consequences

Control services may receive injected runtime services but may not construct a
half-configured live coordinator. General writers remain unavailable. Every
child result is published as a bounded ArtifactRef before a dependent node can
run.

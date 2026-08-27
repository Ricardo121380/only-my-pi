# ADR-0010: Base, Overlay, role-model and budget configuration

Status: Accepted, 2026-08-27.

## Decision

`core` is the base. The default `daily` preset is `core + web +
orchestration-readonly + ui-terminal`. Hard overlays change extension, tool,
network or persistence authority and require a new verified generation/session;
soft overlays may change only non-authority UI state while idle.

Global preferences live at
`~/.pi/agent/only-my-pi/preferences.json`. A project may supply
`.pi/only-my-pi.json` only after Pi Project Trust. Precedence is per-run,
trusted project, global, then parent-model inheritance. Project configuration
may disable capabilities and lower budgets but may not enable a globally
disabled hard overlay or widen a limit.

Role model entries store provider/model identifiers, thinking level and at most
four ordered fallbacks. They never store secrets. Models must exist in Pi's
registry and have configured authentication. A hard cost limit requires known
Provider pricing or an explicit global price override; unknown cost is never
reported as zero.

# only-my-pi status

Snapshot: **2026-08-15** · Pi **0.84.1** · Node **25.8.0** · macOS
`darwin-arm64`

This page is a checked-in handoff record. Exact package metadata and risk tags
live in [`inventory/packages.lock.json`](../inventory/packages.lock.json); this
summary intentionally contains no credentials, sessions, or host paths.

## Current external Pi baseline

These exact versions are already present in the local Pi package selection and
are recorded as global baseline capabilities:

- `@narumitw/pi-plan-mode@0.49.3`
- `pi-agent-extensions@0.5.2` (sessions/context/review/notify only)
- `pi-web-access@0.20.0` (research profile only)
- `pi-subagents@0.45.2` (budgeted; writer children need worktrees)
- `pi-permission-modes@2.2.0` (policy layer, not OS sandbox)
- `@narumitw/pi-lsp@0.49.4`
- `@sreetej510/pi-usage@0.4.5`
- `pi-memory@0.4.1` (the one active memory owner)
- `pi-git-sync@0.1.3` (reviewed resource sync only)

The repository does not synchronize `~/.pi/agent/auth.json`, model catalogs,
sessions, caches, or local npm installs.

## First-party modules now in the repository

The package manifest exposes two non-invasive runtime extensions when this
checkout is explicitly loaded:

- `session-ledger`: local append-only JSONL operational receipts with per-run
  HMAC correlation and no raw prompt/reasoning/tool payloads;
- `context-doctor`: aggregate context/tool-schema metrics and `/omp-context`,
  with no context mutation or persistence.

The rest of the repository tooling is explicit and side-effect bounded:

- `package-doctor`: inventory/profile compatibility gate;
- `profile-resolver`: deterministic profile projection and diff, read-only;
- `safe-mode`: dry-run-first read-only Pi launcher;
- `verification-receipt`: allowlisted no-shell checks with metadata-only receipt;
- `mcp-doctor`: static MCP configuration audit, never starts a server;
- local JSON Schemas for inventory/profile documents.

## Trial and block decisions

Audited with exact npm tarballs and Pi startup smoke, but not promoted to the
global or project package selection:

- `pi-terminal-theme@0.2.0`: pure MIT theme package; plain `terminal` is the
  first visual candidate, tinted palette remains a visual-check opt-in;
- `pi-simplify@0.2.3`: current Pi peer scope, narrow `/simplify` diff review;
  needs a real Provider/model smoke in a disposable worktree before promotion.

Blocked for the current runtime until adapted:

- `pi-workspace-history@0.2.2`: old `@mariozechner/pi-coding-agent` peer;
- `pi-tool-display@0.5.0`: peer metadata only declares the older Pi range and
  owns a renderer surface.

No second memory, MCP bridge, subagent stack, footer/editor takeover, or
automatic browser-cookie capability has been enabled.

## Verification evidence

Run locally:

```bash
npm test
npm run doctor
npm run doctor:profiles
npm run profile:check
npm run schema:check
npm run mcp:doctor -- --file verification/fixtures/mcp.safe.json --strict
npm run verify
```

Committed receipts:

- [`2026-08-15-bootstrap.json`](../verification/receipts/2026-08-15-bootstrap.json)
- [`2026-08-15-mcp-bootstrap.json`](../verification/receipts/2026-08-15-mcp-bootstrap.json)

Both receipts record successful checks without raw command output.

## Next implementation boundary

The next safe increments are deliberately not enabled yet:

1. DeepSeek provider-conformance fixtures against a local mock/recorded
   protocol, without putting an API key in CI;
2. ACP v1 capability adapter design (`initialize/newSession/load/prompt/cancel`
   plus explicit permission callbacks), with no ACP-v2 dependency;
3. A Pi-0.84-compatible workspace checkpoint implementation or an upstream
   peer-repair experiment for `pi-workspace-history`.

Creator/self-modifying plugins, arbitrary JavaScript workflows, automatic
marketplaces, remote UI/SSH/Cron, and un-sandboxed web fetch remain out of
scope for the default profiles.

# only-my-pi status

Baseline snapshot: **2026-08-15** · Roadmap updated: **2026-08-16** · Pi
**0.84.1** · Node **25.8.0** · macOS `darwin-arm64`

This page is a checked-in handoff record. Exact package metadata and risk tags
live in [`inventory/packages.lock.json`](../inventory/packages.lock.json); this
summary intentionally contains no credentials, sessions, or host paths.

## Current external Pi baseline

These exact versions are already present in the local Pi package selection and
are recorded as global baseline capabilities:

- `@narumitw/pi-plan-mode@0.49.3`
- `pi-agent-extensions@0.5.2` (sessions/context/review/notify only)
- `pi-web-access@0.20.0` (research profile only)
- `pi-subagents@0.45.2` (budgeted; shared-cwd writers have a hard maximum of
  one, and parallel writers require isolated managed worktrees)
- `pi-permission-modes@2.2.0` (policy owner; conditional OS sandboxing applies
  only to eligible Bash subprocesses; report `active`/`degraded`, and do not
  infer session, file, web, MCP, provider, or extension isolation)
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

The repository also contains three explicit, non-default integration seams:

- `deepseek-conformance`: dependency-free, injected-transport fixtures for
  DeepSeek-compatible Chat Completions requests, thinking/reasoning content,
  streamed parallel tool calls, usage/cache fields, retry/abort behavior and
  bounded error/output handling. It does not call a provider or read a key.
- `acp-v1`: runtime-neutral ACP v1 JSON-RPC/NDJSON agent-side adapter with
  `initialize`, session create/load/prompt/cancel, update notifications and
  permission request/response handling. It does not start Pi, an ACP process,
  an MCP server or a network transport.
- `workspace-checkpoint`: Git-backed snapshots under the Git directory,
  manifest hashes, symlink/path checks and a dry-run-first restore/undo CLI.
  Applying a restore requires explicit `--run`, and changed workspaces also
  require `--force`; file deletion additionally requires `--allow-delete`.

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
npm run test:deepseek
npm run test:acp
npm run test:checkpoint
npm run doctor
npm run doctor:profiles
npm run profile:check
npm run schema:check
npm run mcp:doctor -- --file verification/fixtures/mcp.safe.json --strict
npm run verify             # suite validation/dry-run only
npm run verify -- --run    # clean source commit only; creates a receipt
```

Committed receipts:

- [`2026-08-15-bootstrap.json`](../verification/receipts/2026-08-15-bootstrap.json)
- [`2026-08-15-mcp-bootstrap.json`](../verification/receipts/2026-08-15-mcp-bootstrap.json)
- [`2026-08-15-status.json`](../verification/receipts/2026-08-15-status.json)
- [`2026-08-15-three-increments.json`](../verification/receipts/2026-08-15-three-increments.json)

All four receipts record successful checks without raw command output. The
latest receipt covers 11 checks, including the 43-test repository run, the
16-test DeepSeek fixture suite, the 9-test ACP suite, and the workspace
checkpoint smoke test.

The latest receipt's `sourceCommit` is the source commit tested before the
receipt file itself was created; the receipt is intentionally a separate
metadata-only commit.

## Next implementation boundary

The repository now has a complete product roadmap and a Codex execution Goal.
The Goal is an external development-orchestrator contract and is not exposed
through the Pi package's `prompts/` resources:

- [`plans/2026-08-16-only-my-pi-development-plan.md`](plans/2026-08-16-only-my-pi-development-plan.md)
- [`../codex/goals/develop-only-my-pi.md`](../codex/goals/develop-only-my-pi.md)

The roadmap target is a usable Pi-based Harness distribution; it is not the
current implementation state. The current governed baseline remains the
package decisions, first-party modules, offline seams, and four verification
receipts recorded above. Planned increments are:

1. harden schemas, package pins, capability ownership, and Profile/runtime
   consistency so descriptive policy cannot produce a false green check;
2. add a dry-run-first, idempotent, backup-and-rollback `omp bootstrap`;
3. add a versioned Mode Registry and unified `omp` / `/omp` control surface;
4. ship practical inspect/explore/plan/coding/debug/review/research/verify
   Modes and declarative Workflows;
5. build AgentSwarm on the existing `pi-subagents` public seam, with bounded
   scheduling, cancellation, deterministic aggregation, a hard maximum of one
   writer in a shared cwd, and isolated managed worktrees for parallel writers;
6. finish lightweight themes/status, security negatives, CI, docs, and release
   readiness.

DeepSeek endpoint work, ACP-to-Pi wiring, and automatic turn checkpoints are
not the next product boundary. Their existing offline modules stay under
Labs/Experimental and remain disabled by default. Creator/self-modifying
plugins, arbitrary JavaScript workflows, automatic marketplaces, remote
UI/SSH/Cron, and un-sandboxed web fetch also remain outside the default
profiles.

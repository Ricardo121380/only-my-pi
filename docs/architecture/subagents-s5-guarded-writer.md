# Subagents S5-C protected guarded writer

S5-C adds an inert-by-default producer for the protected
`guarded-writer-integration` evidence class. It is not a general writer mode,
does not integrate Pi with Kimi Code, and does not turn a Git worktree into an
OS sandbox. It exercises one narrow Pi-native writer path through the sole
physical child backend, `pi-subagents@0.45.2`.

## What the producer is allowed to do

The producer fixes the live shape before any Provider request:

- exactly one `implementer` child and one active child;
- one synthetic Git repository under an empty disposable Pi root;
- one full base commit and one exact claim, `fixture/allowed.txt`;
- one managed worktree under an operator-selected disposable worktree root;
- web, MCP, Project Trust, recursive subagents, automatic integration, commit,
  merge, push, and writes to the source checkout are forbidden;
- the checked-in `implementer` manifest is recompiled and compared byte for
  byte with `agents/generated/omp-implementer.md` before Pi starts;
- the final result is a reviewable writer handoff, never an applied patch.

The authorization is separate from the S5-A read-only and S5-B
background-resume authorizations. It is bound to the exact source commit,
release-policy, compatibility-matrix and trust-policy digests, compatibility
row, Provider/model declaration, credential-free Provider-descriptor digest,
credential allowlist, signer, expiry window,
budget, workspace policy, Agent IDs, base-commit policy, path claim and fixed
gates. Its maximum validity window is 24 hours.

## Execution and verification flow

```mermaid
flowchart LR
    A["One-time writer authorization"] --> P["Disposable Pi parent"]
    P --> B["pi-subagents RPC v1"]
    B --> W["One omp-implementer managed worktree"]
    W --> H["Public upstream handoff manifest"]
    H --> V["Parent fixed Git verifier"]
    V --> R["Handoff only plus digest receipts"]
    R --> S["External digest-only signer"]
    S --> O["Review staging directory"]
```

The pinned backend currently reports worktree support as `DEGRADED`, because
its public RPC contract can request a worktree but cannot prove a per-path
allowlist. The ordinary compiler therefore continues to reject that state.
Only this protected fixture path may set `allowProtectedWorktreeProbe`; the
compiled spawn request records `protected-degraded-probe-v1` so it cannot be
mistaken for a fully enforced backend capability.

Like the background-resume producer, the public RPC call uses an async
workflow only as a control envelope. The compiled workflow launches exactly
one detached managed-worktree child. The adapter requires one distinct,
workflow-key-correlated child ID from the root completion, then accepts only
that child's own `async-complete` plus durable `process-terminal` proof. The
workflow root is never substituted for a writer terminal.

After an authoritative completed child terminal, the parent does not trust the
child summary, changed-path list, patch bytes, or gate claims. It reads the
bounded non-symlink upstream handoff manifest, verifies the exact repository,
base commit, branch and preserved worktree, then runs fixed `git` commands with
`shell:false` and system/global Git config disabled. It independently checks:

1. the worktree `HEAD` is the authorized base commit;
2. no untracked or unstaged change exists;
3. the staged changed-path set equals the TaskAssignment file claims exactly;
4. changed entries are regular Git file modes, not symlinks or submodules;
5. the binary/full-index staged patch is bounded and passes `git diff --check`;
6. the fixed fixture marker is present;
7. the existing WriterHandoff contract accepts the base, claim, terminal,
   parent-verification and gate receipts.

The source fixture repository must retain its original `HEAD` and clean status
after the Pi process exits. The outer CLI rechecks the actual only-my-pi source
commit and worktree after signing and before it stages evidence.

## Evidence and privacy boundary

The evidence document contains only bounded usage, boolean claims and hashes of
the approval, base commit, TaskAssignment, terminal, process terminal,
worktree handoff, parent diff and patch. It does not retain prompts, raw child
output, patch bytes, changed paths, repository/worktree paths, credentials,
session IDs, backend IDs or private signer material. The signer receives only
the canonical evidence payload digest.

The upstream preserved worktree and private Pi/session artifacts remain under
the disposable config root for operator review. The producer does not delete
them automatically and never copies them into `verification/protected/`.
Removal of the operator-selected disposable root is a separate operator action.

## Commands

Inspection is always inert:

```bash
npm run plan:subagents-guarded-writer
```

A live capture additionally requires an explicitly configured source-pinned
signer policy and a valid authorization file:

```bash
node scripts/subagents-guarded-writer-evidence.mjs --run --yes \
  --authorization-file /absolute/operator-authorization.json \
  --config-root /absolute/empty/disposable-root \
  --package-root /absolute/audited/pi-subagents \
  --provider-file /absolute/credential-free-provider.json \
  --pi-command /absolute/pi \
  --signer-command /absolute/digest-only-signer \
  --output-dir /absolute/empty/review-staging \
  --repository-root /absolute/only-my-pi --json
```

The trust policy now contains a separate, time-bounded Beta public signer, but
the plan remains `CONFIGURED_UNAVAILABLE` without an exact one-time writer
authorization. The Provider descriptor contains no key; its digest and the
credential environment-variable name are authorization-bound before the
isolated `models.json` is compiled. Deterministic tests use fake transport or
temporary local Git repositories. Until a protected run is reviewed and
imported, no guarded-writer evidence or Beta promotion is claimed.

## Residual risk

`pi-subagents` worktree support is a process/workspace convenience, not an OS
security boundary. The child still has the caller's OS and network authority,
and its Bash process can attempt writes outside the worktree. The parent verifier
proves only the bounded staged handoff inside the disposable fixture; it cannot
prove that no other OS path was touched. Real use therefore still requires a
disposable machine/container or equivalent outer isolation when that risk is
unacceptable. The fixed fixture gate does not authorize general production
repository integration.

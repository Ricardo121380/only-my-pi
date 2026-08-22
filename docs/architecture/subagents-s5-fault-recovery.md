# Subagents S5-D fault and recovery closure

S5-D turns the first protected guarded-writer failure cases into stable,
reviewable contracts. It does not run a Provider, dispatch a real child,
delete a preserved worktree, import protected evidence, or widen the general
writer capability.

## Fault matrix

The deterministic matrix now exercises these boundaries:

| Fault | Required result |
| --- | --- |
| Pi parent starts but emits no unique terminal record | `WRITER_RUNNER_RECORD_MISSING`; no evidence |
| handoff JSON is truncated | `WRITER_HANDOFF_MANIFEST_INVALID` |
| preserved worktree is missing | `WRITER_WORKTREE_UNAVAILABLE` |
| fixed parent Git verification fails or times out | `WRITER_GIT_VERIFICATION_FAILED` |
| external digest-only signer stops | capture rejects; no staged evidence |
| review staging stops | command rejects; no `RUN_COMPLETE` claim |
| source HEAD changes after signing | `GUARDED_WRITER_SOURCE_CHANGED`; staging is not called |
| runtime request is missing, truncated, or source-bound to another commit | `PARTIAL`; retain for manual review |
| runtime topology contains a symlink or path binding drift | `UNSAFE`; retain for manual review |
| run budget/output/deadline is exceeded | existing RunCoordinator gates charge worst case and fail closed |

These tests use injected subprocesses, temporary local Git repositories and
temporary filesystem roots. They are deterministic fault evidence, not a live
Provider or writer claim.

## Review-only reconciliation

The producer deliberately preserves private runtime state for operator review.
After a failed or successful disposable run, an operator can generate a local
reconciliation plan:

```bash
npm run plan:subagents-guarded-writer-cleanup -- \
  --authorization-file /absolute/operator-authorization.json \
  --config-root /absolute/disposable/root \
  --repository-root /absolute/only-my-pi
```

The planner derives exactly one runtime target from the authorization ID. It
checks the authorization and source digests, expected runtime components,
request-file bounds, source/path bindings, non-symlink topology, and the real
Pi-home/source-root exclusions. Its output contains only a config-root
fingerprint and a relative runtime path; it does not expose host paths or read
session transcripts and child output.

Every produced plan is digest-bound and has:

```text
contractStatus           = review-only
cleanup.automatic        = false
cleanup.deleteAuthorized = false
cleanup.applyAvailable   = false
cleanup.applyCommand     = null
```

The dispositions are only `NO_TARGET` and `RETAIN_FOR_REVIEW`. A complete
runtime is still retained because the planner cannot prove that the Pi process
has stopped or that private handoff/evidence material has been reviewed and
exported. Partial, drifted, missing, unreadable and symlinked states never
become cleanup permission.

## Why there is no cleanup executor

Deletion is a separate destructive authority. A safe future executor would
need an operator acknowledgement bound to the exact plan digest, a process-
liveness check, evidence/handoff disposition receipts, a fresh topology check,
and exact-target deletion with no symlink traversal. S5-D intentionally stops
before that boundary. It supplies recovery visibility without turning a
diagnostic command into an implicit `rm` facility.

## Remaining release boundary

S5-D improves Preview fault/recovery evidence only. Alpha still requires the
separately authorized read-only protected classes; Beta additionally requires
background/resume and guarded-writer protected evidence; Stable still requires
the declared cross-platform compatibility/soak/migration closure. The checked-
in trust policy has no signer, so no live promotion state changes here.

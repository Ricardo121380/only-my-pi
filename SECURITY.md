# Security policy

`only-my-pi` contains Pi Agent resources and research. It is not intended to
contain secrets or to make third-party code trusted by default.

## Never commit

- API keys, OAuth tokens, refresh tokens, cookies, or credential stores
- Pi/DSH/OpenCode/Kimi sessions, transcripts, memory databases, caches, or logs
- Private source code copied from another workspace
- Unreviewed lockfiles or generated package trees copied from a local install

## Third-party package gate

Before a package, extension, skill, hook, MCP server, or theme is enabled in a
profile, record its source, exact version/commit, license, engine and peer
constraints, lifecycle scripts, dependency tree, network/filesystem/process
access, and rollback command. Run it first with `pi -e` in a disposable
workspace and keep one-command disable/safe-mode recovery available.

Pi Project Trust, approval prompts, and plan mode are not operating-system
sandboxes. Enforcement is surface-specific. The currently reviewed
`pi-permission-modes` can conditionally sandbox eligible Bash subprocesses when
its sandbox runtime is active; it does not thereby sandbox the Pi session,
direct file tools, web or MCP traffic, Provider calls, or package/extension
execution. It can degrade to prompts when the sandbox runtime is unavailable,
explicitly disabled, or used from a Git worktree. Verify and report the actual
`active`/`degraded` state for the relevant surface, never a whole-session
sandbox claim. Untrusted repositories, unattended goals, browser-cookie
automation, remote MCP, and plugins that can access secrets must run behind
confirmed isolation that covers those surfaces, with minimal mounts,
credentials, and network access; use a container or micro-VM when one
surface-specific sandbox is insufficient.

## Bootstrap boundary

`omp bootstrap`, update, rollback, and uninstall use an explicit Pi agent
directory, an exclusive lock, owned-only snapshots, a durable journal, and
settings-last compare-and-swap publication. A concurrent settings change is
preserved and forces a fresh plan. The npm runner uses contained, non-symlink
runtime paths; fixed local HOME/cache/tmp/prefix/workspace paths; isolated
user/global/project npm configuration; a scrubbed environment; and an exact
allowlist of scripts-disabled pack/install argv. Install omits peer
dependencies and rejects any realized nested copy of either the current or
legacy Pi host package; extensions must bind to the caller's Pi host. Every
promoted package records exact lifecycle command digests while execution stays
disabled. An audited script marked `required` fails closed because bootstrap
has no outer lifecycle sandbox executor. Direct tarball bytes and the realized
installed tree are verified, but first-time
transitive resolution still relies on npm registry metadata before the complete
tree is hashed; do not describe this as a pre-audited transitive SRI closure.

Rollback snapshots may contain selected package/extension/skill/prompt/theme
array values, including local paths. They are private runtime state: do not
commit or synchronize `<configRoot>/only-my-pi/`. Restore reconciles exact
managed entries and preserves user entries added after the snapshot.

The post-apply Pi smoke runs in a disposable agent directory with a scrubbed
environment and sends only the RPC `get_state` and `get_commands` requests. The
second request proves that the governed first-party extension import closure
loaded and registered its expected command; neither request submits a prompt.
Pi's normal config path points at an isolated empty auth/session/model root.
Loaded extension code still runs as the current OS user and is not prevented
from reading host files or using the network. The result is startup evidence,
not proof of credential isolation, Provider inactivity or authentication,
extension network isolation, or an OS sandbox. `--offline` disables Pi
maintenance traffic only. For an untrusted package or unattended task, enforce
filesystem, process, credential, and network isolation outside Pi as
appropriate.

The subagents compatibility probe is a separate, explicitly invoked boundary.
It requires an absolute disposable root and an already-present audited package
root, validates the pinned package/source hashes, loads the real first-party
extensions, and uses only public `ready`, correlated `ping`, tool, and command
registry APIs. It writes no RPC input, prompt, or child request. Its evidence
removes cwd, source paths, and session identifiers before output. This proves
RPC compatibility and single model-tool ownership, not child execution or
extension isolation; loaded extension code still has the caller's OS and
network authority.

## S5 release-gate boundary

The successor release manifest is split into deterministic and protected
evidence gates. Deterministic gates use a fixed command/argv/environment set,
`shell:false`, bounded output, offline npm settings, and a clean-source
commit check before and after execution. The v2 runner cannot accept an
alternate manifest or execute a protected gate. Protected live evidence is
`NOT_RUN_BY_POLICY` until a separately authorized disposable run produces a
signed, digest-bound file under `verification/protected/`.

Protected evidence uses a source-pinned Ed25519 public-key policy. The default
policy contains no key and is intentionally unavailable. A private signing key
must stay outside Git, package contents, receipts, Pi state, and CI logs. A live
evidence commit must be the direct single-parent child of its source commit and
may only update the compatibility matrix plus introduce the exact requested
evidence files. Code, schemas, promotion gates, and the trust policy cannot be
changed in that evidence commit. The importer re-hashes and verifies the full
document, signature, proof classes, runtime tuple, compatibility reference,
authorization boundary, and privacy boundary; a self-consistent JSON digest
alone is never promotion authority.

Passing the Preview deterministic gates therefore proves repository contracts,
fault/security tests, offline evaluation, and packaging checks only. It does
not prove live child execution, model quality, background resume, managed
worktree enforcement, or Provider behavior. Promotion policy and compatibility
matrix digests are checked independently so a forged receipt or floating Node
version cannot widen a release claim. The importer is now implemented, but no
signer is configured and no live evidence has been authorized, so the current
claim remains Preview.

The S5-A producer adds another explicit boundary rather than weakening this
rule. Its default plan is zero-execution. A live run requires a clean pinned
source, runtime-ready public-key policy, active one-time authorization, empty
disposable config root, audited package root, explicit Pi and signer
executables, explicit staging directory, and `--yes`. Only authorization-listed
credential variables enter the isolated Pi environment; the signer receives
only a payload digest. Output is staged outside `verification/protected/` and
is neither imported nor committed automatically. Authorization
`declaredEndpointHosts` are declarations only: this process does not implement
an OS network sandbox, DNS policy, or egress firewall.

The capture child never uses the source checkout as its `cwd`. It receives a
synthetic disposable fixture workspace, and the governed `omp-reviewer` is
recompiled from the canonical manifest/prompt, compared byte-for-byte with the
checked-in generated resource, then copied into the isolated Pi Agent root.
Its tool set excludes `bash`, `edit`, `write`, and web access, and upstream
artifacts are configured for temporary storage. These controls constrain the
scenario, but the removable workspace directory and extension process still
run with the caller's OS identity; they are not a container or filesystem
sandbox.

Live ceilings are cumulative across the complete three-scenario capture. The
driver passes only the remaining budget to each fresh Pi process and fixes the
physical child shapes at one, one, and two. Repository, config, and staging
roots must be pairwise disjoint. A second clean-source/HEAD check after signing
and before staging prevents concurrent worktree changes from being recorded as
evidence for the earlier source commit.

Missing token or cost metering is a capture failure. These signed cumulative
ceilings reject evidence after an observed overrun, but the pinned async
backend does not prove a mid-child USD/token circuit breaker. Configure a hard
Provider/account budget or outer network control when spend must be prevented
rather than detected. The runner does enforce child shape before dispatch and
terminates the isolated Pi process group on its wall-clock deadline.

## BatchSwarm boundary

BatchSwarm is logical orchestration, not a second child runtime or sandbox. It
may expand one reviewed AgentSpec over as many as 300 items, but every physical
item still executes through the sole pinned `pi-subagents` RPC backend with that
backend's process, filesystem, Provider, and network authority. A concurrency
ceiling limits admission; it does not isolate the admitted children.

Definitions, prompt templates, resolved AgentSpec/policy/output hashes, item
digests, and the input snapshot are bound before dispatch. Per-item Agent,
model, tool, policy, workspace, and output overrides are rejected. Adaptive
429 capacity is unavailable unless the backend explicitly proves both a
rate-limit signal and dynamic-concurrency control; only-my-pi must not infer
those features or create a competing physical scheduler.

The parent BudgetLedger reserves the full item-attempt envelope before fan-out.
The envelope is capped at 1000 physical assignments, and the Workflow batch
node is forced to one root attempt so that item retry has a single owner.
Item admission is journal-first. Crash recovery may reuse the same reservation
only when every durable `BatchItemStarted` has a correlated authoritative
terminal; otherwise it charges worst case and interrupts instead of replaying a
possibly live child. A retryable but non-authoritative terminal never triggers
a second launch. Local cancellation similarly does not prove process
termination—the backend's correlated process-terminal evidence remains
authoritative, and an executor that ignores cancellation is detached from
admission without being misreported as stopped.

The checked-in S3 evidence is offline/injected only. It neither calls a live
Provider nor proves extension isolation, real model quality, real 429 signals,
or large-scale host capacity. Until a separately authorized protected run is
performed, live read-only BatchSwarm evidence is `NOT_RUN_BY_POLICY`.

## SwarmGoal, UltraRun, and writer boundary

SwarmGoal and UltraRun are logical policy layers over the same RunCoordinator
and sole pinned `pi-subagents` backend. They do not load Kimi Code, copy its
private scheduler, create another child pool, or authorize arbitrary JavaScript
workflows. Dynamic goal admission requires a human-origin authorization bound
to the exact goal, objective, input, and nonce. Every proposed revision is
journalled before execution, bounded by the parent BudgetLedger, compiled to an
immutable WorkflowPlan, and independently verified with fresh context.

Planner/child output is untrusted data. It cannot introduce an unregistered
AgentTemplate, widen mutation or egress, reuse unproved work, exceed a reserved
budget, or turn a failed/blocked verifier into root success. Artifact bytes are
content-addressed, size-bounded, scoped to the producing run, written without
following symlinks, and verified on read.

Writer support in S4 is a handoff contract, not automatic integration. A writer
requires managed-worktree ownership, a full base commit, non-empty and
non-overlapping path claims, parent-side diff enforcement, correlated terminal
proof, and passing fixed gates. The pinned v1 backend cannot prove per-path
enforcement; that live seam therefore remains `UNAVAILABLE`. A worktree is not
an OS sandbox or path allowlist.

The checked-in S4 evidence uses injected planners/executors and temporary roots.
No live SwarmGoal, UltraRun child, Provider request, or writer mutation has been
run. Those gates remain `NOT_RUN_BY_POLICY` until S5 and separate authorization.

## Reporting a problem

Do not publish secrets or exploit details in a public issue. For a local
configuration or package concern, first disable the affected profile, preserve
the exact version and logs with secrets redacted, and open a private report to
the repository owner.

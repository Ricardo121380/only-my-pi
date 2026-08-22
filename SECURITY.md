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
version cannot widen a release claim. A bounded public Alpha signer is now
configured. Three authorized cancel attempts failed closed before evidence was
signed or staged: workflow/interrupt incompatibility, the adapter's incorrect
management target field, and missing timely process-terminal proof for the
nested workflow runner. S5-A now uses the exported single-layer structured
delegation terminal response and still requires exit code, identity and usage
correlation. No protected evidence has been imported, so the current claim
remains Preview.

The first structured-delegation attempt also failed closed before signing: a
redacted token projection masked the numeric usage fallback. Token/cost
extraction now ignores non-numeric redaction sentinels and requires finite
numeric metering before evidence can be authoritative.

A later delegation run reached all three scenario classes but exceeded the
20,000-token aggregate ceiling at roughly 40,588 tokens while remaining under
$0.01. It was rejected before signing. The ceiling was not enlarged; S5-A now
uses a zero-tool lifecycle probe, keeping model-quality evaluation separate.

The release runner strips the inherited environment. Its one cache exception
is `test-e2e`: an explicitly supplied npm cache is normalized to a real
directory and accepted only inside the actual user's `.npm` cache or the
system temporary root. Other gates never receive it, and an ambiguous,
relative, missing, non-directory, or escaping cache fails before child spawn.

The S5-A producer adds another explicit boundary rather than weakening this
rule. Its default plan is zero-execution. A live run requires a clean pinned
source, runtime-ready public-key policy, active one-time authorization, empty
disposable config root, audited package root, a digest-bound credential-free
single-model Provider descriptor, explicit Pi and signer
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

S5-B uses a separate authorization and command for `background-resume`. The
same S5-A authorization cannot be widened to cover it. Two distinct Pi parent
processes must use one explicit session ID and contained session directory;
`--no-session`, project-scoped artifacts, an unrelated second child, or a
repeated prompt cannot satisfy the evidence contract. The first process must
finish with an authoritative terminal and exit before the second process reads
the same persisted parent session and calls the public `resume` RPC. Resume
must create a different backend run and binding linked to the original.

The cross-process handoff is private operational state under the disposable Pi
root. It is mode `0600`, size-bounded, context/digest-bound, and named by the
phase-one receipt before the phase-two request is created. It may contain
session and backend correlation identifiers and therefore must never be
committed, staged, synchronized, or copied into a diagnostic report. The final
evidence stores only proof digests and cumulative metering. This protects the
repository evidence boundary; it is not protection against an attacker with
the same OS-user authority, and it does not turn Pi sessions or extensions into
an OS sandbox.

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

S5-C adds a narrower protected evidence producer without changing that general
capability claim. Its own authorization fixes one `omp-implementer`, one
synthetic repository and base commit, one worktree, one exact path claim and two
fixed gates. Ordinary compilation still rejects the backend's `DEGRADED`
worktree capability; only this evidence path may record
`protected-degraded-probe-v1`. The parent treats the child terminal, handoff
manifest, changed paths and patch as untrusted. It reopens bounded non-symlink
artifacts, verifies the upstream worktree identity, rejects untracked and
unstaged changes, recomputes the staged path set and binary patch, rejects
symlink/submodule modes, and runs `git diff --check` plus the fixed content gate.
The result is review-only; there is no automatic commit, merge, apply, push or
source-checkout mutation.

This proves only a staged handoff in a disposable fixture. The Pi parent,
extension, child and Bash process still run with the caller's OS/network
authority and could attempt side effects outside that worktree. The outer CLI
rechecks the only-my-pi source tree, but it is not a whole-machine audit. Use a
container/VM or equivalent outer boundary for an untrusted Provider, plugin or
child. Preserved worktrees and private session artifacts stay in the
operator-owned disposable root for review and are never imported as evidence.

S5-D adds visibility for those retained artifacts without adding deletion
authority. The guarded-writer reconciliation command derives one target from
an exact authorization, rejects the real Pi home and source/config overlap,
checks request bounds and non-symlink topology, and emits only a digest-bound
review plan. Its only existing-target disposition is `RETAIN_FOR_REVIEW`; it
has no `--run`, `--apply`, `--yes`, delete callback, or generated shell
command. A missing, partial, drifted, unreadable or symlinked runtime therefore
cannot be converted into automatic cleanup. Process liveness, handoff review,
and evidence disposition remain explicit operator responsibilities.

The checked-in S4 evidence uses injected planners/executors and temporary roots.
No live SwarmGoal, UltraRun child, Provider request, or guarded writer mutation
has been run. S5-C supplies the producer code, not protected evidence or a Beta
claim; those gates remain `NOT_RUN_BY_POLICY` until separate authorization and
an actual signed capture/import.

## Reporting a problem

Do not publish secrets or exploit details in a public issue. For a local
configuration or package concern, first disable the affected profile, preserve
the exact version and logs with secrets redacted, and open a private report to
the repository owner.

# Subagent orchestration threat model

> Snapshot date: 2026-08-18
> Status: S0 release-gating threat model
> Applies to: `@only-my-pi/subagents`, its Pi RPC adapter, run state, artifacts,
> Workflow, BatchSwarm, SwarmGoal, and UltraRun

## 1. Security position

`@only-my-pi/subagents` is an orchestration, policy, and audit layer around Pi.
It is not an OS sandbox. Exact `pi-subagents@0.45.2` remains the only physical
child/session/process/worktree runtime, but a unique owner is not automatically
a secure owner: every delegated capability still executes with whatever
authority the host OS, Pi, selected extensions, Provider, tools, and external
services actually grant.

The architecture and state invariants are defined by
[ADR-0005](../decisions/ADR-0005-unified-subagents-runtime.md) and
[ADR-0006](../decisions/ADR-0006-workflow-ir-event-state.md). External-source
claims and rejected patterns are recorded in the
[source dossiers](../research/2026-08-18-subagents-source-dossiers.md). This
document adds abuse cases, controls, residual risk, and promotion gates.

Normative security rule:

> Every model proposal, repository instruction, child result, tool output,
> artifact, cached value, and backend event is untrusted data until it passes
> the exact schema, correlation, authority, budget, workspace, and lifecycle
> checks for the current active Plan revision. Data never grants authority.

## 2. Scope and security objectives

### In scope

- installation and loading of the unified first-party facade;
- model tools, Pi commands, CLI/TUI controls, and their shared service;
- WorkflowDefinition compilation and WorkflowPlan revision activation;
- Agent and BatchSwarm dispatch through the public `pi-subagents` RPC;
- SwarmGoal dynamic proposals and UltraRun multi-workflow routing;
- permission/capability projection, approvals, and budget reservations;
- backend identity/event correlation, cancellation, and recovery;
- append-only event journal, lease/fencing, snapshots, artifacts, cache, and
  migration readers;
- shared-cwd and managed-worktree writer behavior;
- Provider, Web, MCP, shell, file-tool, and repository-data boundaries as they
  affect delegated work;
- evidence, receipts, diagnostics, and release claims.

### Out of scope but explicitly not trusted

- security of the model Provider, Pi host, npm registry, Git host, operating
  system, shell, browser, MCP server, Web content, or third-party extension;
- protection against an already-compromised user account or root process;
- cross-host distributed scheduling, remote workers, and hostile multi-tenant
  execution;
- long-lived Team/mailbox semantics;
- arbitrary JavaScript Workflow;
- guarantees about unpublished Kimi or Claude production schedulers.

### Security objectives

1. No delegated attempt receives more authority than the deny-wins effective
   intersection and exact approval permit.
2. No child is spawned before active-revision, capability, workspace, approval,
   and worst-case budget admission are durably satisfied.
3. A backend event can affect only the correlated run/revision/node/attempt.
4. At most one canonical state writer and one active Plan revision can admit
   work.
5. Parallel mutation cannot silently target the same base checkout or overlap
   unreviewed file claims.
6. Crash, cancellation, and resume do not silently duplicate an ambiguous
   external side effect.
7. Unbounded model output, fan-out, retry, context, artifacts, or logs cannot
   exhaust the machine or Provider account without crossing a hard gate.
8. Receipts distinguish static contract, simulator, fake backend, live child,
   and live Provider evidence.
9. Secrets and raw reasoning/transcripts are not persisted by default.
10. Unsupported capability fails closed and is visible, rather than being
    silently approximated.

## 3. Assets

| Asset | Security property |
| --- | --- |
| User repository and uncommitted work | Integrity, availability, provenance |
| Credentials, Provider keys, MCP tokens, browser/session data | Confidentiality and least exposure |
| Provider account, rate limit, and wallet | Bounded authorized consumption |
| Pi primary session and context | Integrity, confidentiality, bounded growth |
| WorkflowDefinition/Plan and approval receipts | Authenticity, immutability, scope binding |
| Budget envelope/reservation ledger | Integrity, atomicity, recoverability |
| Event journal, writer lease, snapshot | Single-writer integrity, continuous prefix, replayability |
| Artifact store and cache | Content integrity, containment, provenance, bounded size |
| Backend correlation map | Identity integrity and terminal-proof authenticity |
| Worktrees, path claims, integration handoff | Mutation isolation and conflict visibility |
| Operator controls and status | Accurate state, no confused control target |
| Release receipts and capability evidence | Claim accuracy and reproducibility |

## 4. Trust boundaries and data flow

```text
[human/operator]
       |
       v
[Pi/model/CLI/TUI] -- untrusted proposal --> [facade admission]
                                              |  policy/approval/budget
                                              v
                                      [RunCoordinator]
                                        |          |
                            durable intent          +--> [journal/artifacts]
                                        v                    ^
                               [RPC v1 adapter]               |
                                        v                    |
                              [pi-subagents runtime]          |
                                        v                    |
                          [child Pi + tools/worktree] --------+
                              |       |       |
                         Provider    Web     MCP/shell/files
```

Trust boundaries:

1. **Human to proposal boundary.** Human input may authorize only through an
   explicit structured approval, not by prompt phrasing alone.
2. **Model/repository to admission boundary.** Model output and repository text
   can propose typed data but cannot activate capabilities or spawn work.
3. **Facade to backend boundary.** Only the exact public RPC adapter crosses
   into physical child lifecycle. Backend payloads remain untrusted until
   correlated.
4. **Child to tools/egress boundary.** File, shell, Web, MCP, and Provider calls
   are independent enforcement surfaces; tool visibility is not isolation.
5. **State writer to storage boundary.** Lease/fencing, compare-and-swap,
   hash-chain, fsync, atomic rename, containment, and file-type checks protect
   canonical state.
6. **Writer worktree to base checkout boundary.** A worktree reduces conflict
   but does not isolate OS credentials, network, other paths, or processes.
7. **Evidence to release-claim boundary.** A static fixture or fake runtime
   cannot be promoted as live Provider evidence.

## 5. Authority and admission invariants

Effective capability is the intersection:

```text
OS/container
  ∩ Project Trust
  ∩ Profile
  ∩ Mode
  ∩ UltraRun/SwarmGoal policy
  ∩ active Plan revision/node
  ∩ ResolvedAgentSpec
  ∩ TaskAssignment
  ∩ exact approval
```

Deny wins. Missing or unknown is not allow.

Before dispatch, the coordinator must prove, in order:

1. one current writer lease/fencing token and one active revision;
2. node readiness and no superseding/pausing/cancellation barrier;
3. schema-valid immutable AgentSpec/Assignment and bounded context artifacts;
4. effective tool/egress/workspace/mutation/path capabilities;
5. exact approval or bounded read-only replan-envelope coverage;
6. current base commit, workspace identity, path/file claims, and backend
   capability evidence;
7. hard budget meter availability and remaining capacity;
8. a durable worst-case reservation and dispatch intent;
9. only then, one RPC spawn request.

Any failure produces a typed non-dispatch result and durable observation where
appropriate.

## 6. Threat and mitigation register

Priority uses P0 for authority/data-loss/wallet-critical release blockers, P1
for significant integrity/availability risks, and P2 for bounded operational or
claim-quality risks.

| ID | Priority | Threat / attack | Failure mode | Required controls | Verification / promotion gate | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | P0 | Child confused deputy | Prompt/repository tells a read-only child to write, run shell, reveal credentials, or recruit more agents | Deny-wins projection; child cannot edit policy; no nested direct spawn; untrusted outputs are data | Negative AgentSpec/Assignment escalation fixtures; live denied-tool probe | A permitted read tool may still expose sensitive repository content to the Provider |
| T02 | P0 | Model-generated plan escalates authority | SwarmGoal adds writer, Web/MCP, broader paths, model role, budget, or fan-out | Immutable revision; semantic diff; exact reapproval for mutation/scope growth; bounded read-only envelope only | Replan escalation and approval-staleness tests | Human may approve an unsafe but accurately displayed plan |
| T03 | P0 | Approval replay or drift | Receipt for plan N/workspace A is reused for N+1/workspace B or changed base commit | Receipt binds plan, policy, workspace, base commit, mutation/path, tool/egress, budget, and artifact digests | One-field mutation corpus must invalidate approval | External environment may change after approval; revalidate immediately before admission |
| T04 | P0 | Dual runtime/tool owner | Upstream `subagent` and namespaced facade both dispatch, or a community workflow extension adds a second scheduler | Unique owner ADR; public-tool topology probe; inventory collision checks; no `pi-dynamic-workflows` production load | Runtime visibility/collision test must prove one public model-facing owner | Upstream UI/tool behavior may change on upgrade; pin and re-audit |
| T05 | P0 | Private/alternate backend path | Code imports `pi-subagents/src/**`, shells out to Pi, or creates its own pool/worktree | Adapter allowlist; import/static scan; package boundary tests; one injected service | CI rejects private import, process spawn, alternate worktree/subprocess owner | Dynamic code in unrelated extensions remains outside this layer's control |
| T06 | P0 | Backend ID confusion/spoofing | Late or crafted event settles another run/node/attempt | Typed correlation tuple; event ID/input digest; active revision/attempt check; terminal proof | Duplicate, conflict, unknown child, prior attempt/revision, spoof and out-of-order corpus | Compromised backend can lie; stronger isolation/attestation is out of scope |
| T07 | P0 | Split-brain state writers | Two app/CLI processes append and admit work | Single lease, serialized operation lock, monotonic fencing token, CAS journal head | Competing-writer and stale-token tests | File leases are single-host only; network filesystems may not provide required semantics |
| T08 | P0 | Lease theft after timeout | New writer assumes expiry proves old process dead; old writer resumes | Reclaim requires explicit death proof; higher fencing token; fail `LEASE_RECLAIM_PROOF_REQUIRED` | Expired-live-writer and resumed-stale-writer tests | PID reuse/weak host identity can invalidate naive death proofs; proof adapter must be audited |
| T09 | P0 | Active revision overlap | N+1 dispatches while N can still admit/run work | Activation barrier; close N admission; supersede queued; drain/stop and terminal proof; CAS active revision; fsynced activation event | Concurrent revision stress/crash tests show no overlapping admission | A lost backend event can block progress, intentionally favoring safety |
| T10 | P0 | Budget/wallet exhaustion | Huge fan-out, retries, loops, long agents, or multiple workflows consume account | Hierarchical hard envelope; CAS worst-case reservation before spawn; total assignment/revision/retry/time/output caps; no recursion | Exhaustion tests at every resource and crash boundary | Provider may charge beyond locally observed usage; keep conservative reservation and external account limits |
| T11 | P0 | False hard cost/token enforcement | Runtime lacks reliable meter but UI claims cap | Capability negotiation; `METERING_UNAVAILABLE`; no substitute byte estimate | Hard token/cost run rejected with unavailable meter | Provider metering can be delayed; external billing limit remains recommended |
| T12 | P1 | 429/retry amplification | Many children retry simultaneously, multiplying cost and rate-limit pressure | Bounded attempts/backoff/jitter; same logical identity; adaptive tuning only with proven backend signals; pause admission on systemic limit | Deterministic rate-limit storm simulator | Third-party backend may retry internally; observe total usage and cap attempts |
| T13 | P1 | Starvation/unfairness | One BatchSwarm or root run monopolizes all logical slots | Per-run/per-batch caps, fair ready queue, reservation quotas, operator pause/cancel | Multi-run fairness simulation and no-starvation threshold | Physical backend scheduling remains upstream-owned |
| T14 | P0 | Shared-cwd writer collision | Parallel agents overwrite user/uncommitted work or each other | Shared cwd max one writer; parallel writer requires managed worktree; immutable base commit and path claims; overlap deny | Two-writer, dirty-tree, overlapping-path, base-drift tests | Disjoint files may still interact semantically; integration and fresh verification required |
| T15 | P0 | Worktree failure fallback | Failed isolation silently runs writer in base checkout | `WORKTREE_UNAVAILABLE`; dispatch nothing; no base-cwd fallback | Injected creation failure and capability-unavailable test | Worktree does not isolate paths outside repo, credentials, processes, or network |
| T16 | P0 | Path/symlink/submodule escape | Artifact, state, worktree, prompt, or output path resolves outside governed root | Segment-by-segment symlink rejection; realpath containment; regular-file checks; no arbitrary absolute path; submodule policy | Symlink/hardlink/path traversal/race fixtures on all writers/readers | TOCTOU remains possible without descriptor-relative OS primitives; high-risk workloads need container/VM |
| T17 | P0 | Unsafe integration/handoff | Child claims success and changes are applied without review or to wrong base | One integrator; explicit patch/commit/artifact digest; path-claim validation; current base check; fresh verifier/gates | Tampered patch, wrong-base, hidden-file, conflict tests | Semantic defects may survive review; independent verifier reduces but does not eliminate risk |
| T18 | P0 | Crash causes duplicate mutation/spawn | Crash between intent, spawn acknowledgement, tool side effect, and terminal event leads to blind replay | Durable intent/idempotency key; backend reconcile; ambiguous attempt `ORPHANED`; no automatic mutation replay | Crash matrix at every boundary | Backend without reconciliation can leave manual cleanup/orphans |
| T19 | P1 | False cancellation | UI shows cancelled while child/process still runs and mutates/consumes | Cancel intent distinct from terminal; close admission; backend stop/interrupt; terminal proof; timeout -> interrupted/orphaned | Lost-ack, late-terminal, resistant-child tests | OS-level process escape requires external process/container controls |
| T20 | P1 | Journal corruption or rollback | Torn write, record deletion/reorder, stale snapshot, or edited event changes state | Contiguous seq; hash chain; fsync; atomic snapshot anchored to journal; fail closed on middle corruption | Torn-tail repair, reordered/deleted/edited record, stale snapshot corpus | Hashes detect but do not prevent malicious deletion; protected backups are external |
| T21 | P1 | Cache poisoning/stale reuse | Untrusted artifact or result reused under different code/policy/input | Content-addressed key binds all semantic inputs, policy, base commit, schema; digest/schema revalidation; cross-run cache disabled initially | One-field key mutation and corrupted artifact tests | Semantically nondeterministic model output can still be low quality; verifier remains required |
| T22 | P1 | Context/output/artifact bomb | Child emits huge text, deep JSON, many files, recursive references, or decompression bomb | Byte/count/depth/time limits before parse/project; bounded event payload; typed artifact store; no automatic archive extraction | Boundary and streaming-abort tests | Provider may generate/charge before local truncation; token budget remains necessary |
| T23 | P0 | Secret disclosure through context or logs | Env, config, prompts, reasoning, tool output, or credentials persist or reach unapproved egress | Metadata-only events; redaction; artifact classification; allowlisted inputs; no env capture; separate egress owners; secrets never in repo/CI | Canary-secret tests across journal, snapshot, artifacts, status, receipts, error paths | Model/tool can disclose secrets it is legitimately allowed to read; least privilege and sandboxing remain essential |
| T24 | P0 | Network/MCP/Provider exfiltration | Read data leaves through Web, MCP, shell network, Provider prompt, or another extension | Independent egress capabilities; explicit Profile/Mode/approval; domain/server/tool allowlists; no default Web/MCP; record low-sensitive provenance | Denied-egress live probes per surface | Provider receives prompts by design; no local policy can undo submitted data |
| T25 | P1 | Prompt injection through Web/repository/child | Untrusted content instructs orchestrator to ignore policy or approve changes | Treat retrieved content as data; structured output schema; no authority-bearing strings; independent verifier; source provenance | Injection corpus in repository, web result, MCP result, and child output | Model may still make poor decisions inside granted capability |
| T26 | P0 | Arbitrary JS/`vm` escape | Workflow code accesses host APIs, loops, allocates memory, or is mistaken for sandboxed | No arbitrary JS S0-S5; declarative JSON IR; unknown constructs fail; later Labs compiles to same IR and remains non-default | Source/static scan and negative executable-field fixtures | Any future Labs interpreter needs a separate threat model; `vm`/worker is not sufficient |
| T27 | P1 | Dynamic recursion/runaway recruitment | Child or SwarmGoal recursively starts workflows/agents beyond bounds | Only coordinator can admit; children lack delegation authority; max depth/assignments/revisions/iterations; nested workflows flatten | Recursive prompt/plan and self-recruitment negatives | A permitted shell could launch unrelated processes; OS sandbox needed for hostile code |
| T28 | P1 | Aggregator as hidden model/authority | “Deterministic” reducer calls a model/tool or silently drops failures | Pure deterministic aggregators only; model reducer/judge/verifier is explicit Agent node; result slots preserve failure | Static/runtime call-boundary tests and partial-failure fixtures | Human-facing synthesis can still omit details; retain typed inputs/provenance |
| T29 | P1 | Migration semantic confusion | v1 nonterminal run is resumed under v2 rules or old receipt gains stronger claim | Dual-read/new-write; completed legacy read-only; new run/new approval; no nonterminal import; evidence class immutable | Legacy fixture matrix and receipt non-rewrite tests | Operators may manually copy output; provenance must label it imported/unverified |
| T30 | P1 | Supply-chain substitution | Mutable tag, changed tarball, install script, or dependency compromise runs as user | Exact version/commit/SRI/tarball digest; scripts-disabled staging; lifecycle audit; pack allowlist; lockfile | Package doctor, byte verification, malicious lifecycle negatives | Exact malicious bytes remain malicious; source review and sandboxed staging still required |
| T31 | P2 | License/provenance loss | External source copied without attribution/NOTICE, or proprietary behavior presented as code | Clean implementation default; copy ledger with commit/path/license; NOTICE gate; source tier labels | Release scan and provenance review | Similar behavior can invite ambiguity; document independent contracts/tests |
| T32 | P1 | False Kimi/Claude compatibility claim | Product docs are presented as source proof or local limits/features | Explicit hosted-vs-source dossiers; reference-only language; evidence-tier receipt; no compatibility naming | Docs/receipt claim audit | Official docs can change; snapshot/re-audit required |
| T33 | P1 | Control-target confusion | Pause/cancel/approve command targets wrong run/revision or stale UI state | Commands carry exact run ID/revision/digest and expected state version; service CAS; confirmation for mutation | Stale-view and wrong-target tests | Human can select wrong current target; display scope and effect clearly |
| T34 | P2 | Status/receipt data leak | Host paths, prompts, tool output, source content, or account data appears in diagnostics | Low-sensitive allowlisted fields, hashing, relative identifiers, bounded error redaction | Snapshot/status/receipt golden and canary-secret scan | Digests can reveal equality; do not hash low-entropy secrets as identifiers |
| T35 | P1 | Denial through malformed event/state | Deep objects, duplicate IDs, huge records, unknown transitions, or partial corruption block/reduce incorrectly | Record byte/depth bounds; plain JSON; exact keys; semantic transition validator; continuous-prefix recovery | Fuzz/property tests and bounded parsing | Deliberate local disk corruption can keep run blocked; manual forensic recovery may be needed |

## 7. Swarm-specific abuse cases

### BatchSwarm

BatchSwarm is one immutable worker specification mapped over items. The batch
must reject:

- an item source whose resolved count exceeds the approved maximum;
- duplicate item keys or duplicate rendered prompts where identity would become
  ambiguous;
- template expansion beyond prompt/context byte limits;
- per-item changes to tools, workspace, mutation, egress, or model role;
- a result array that omits a slot, reorders by completion, or hides
  failed/aborted/not-started outcomes;
- retry without a new attempt identity and reservation;
- cancellation that marks not-started and still-running items identically.

The queue may ramp or back off, but cannot claim adaptive Provider control
unless public backend evidence supports it. Logical queue policy never changes
physical backend ownership.

### SwarmGoal

SwarmGoal is higher risk because model output proposes both work and worker
specialization. Controls are:

- a hard ceiling on generated AgentSpecs, assignments, revisions, iterations,
  context bytes, and total budget;
- AgentSpecs can only reduce the parent/template/Profile/Mode capability ceiling;
- every proposal compiles to a complete immutable Plan revision before
  admission;
- no in-place mutation of queued/running/settled nodes;
- coverage and convergence are bounded data, not permission to continue
  indefinitely;
- critical findings require explicit verifier nodes and typed provenance;
- context shards expose only approved artifacts, not shared hidden memory;
- new mutation, path, egress, tool, model role, or budget scope forces exact
  reapproval;
- plan revision activation uses the single-active barrier.

“Hundreds of agents” means hundreds of durable logical assignments within these
limits. It is never authority to start hundreds of local sessions at once.

### UltraRun

UltraRun routes a request across multiple approved WorkflowRuns. It must:

- maintain a root total budget whose reservations include every phase/run;
- separate routing/quality policy from Model, reasoning effort, Profile, and
  permission Mode;
- obtain a new approval when a later phase first introduces mutation or scope;
- pass only typed, bounded artifacts between phases;
- show phase/run identity and status independently;
- stop routing when total convergence, failure, budget, cancellation, or
  approval boundaries are reached;
- never dispatch a child directly.

## 8. Workspace and mutation controls

### Read-only does not mean harmless

A read-only child can still exfiltrate, consume Provider budget, leak content in
logs, run expensive analysis, or exploit a parser/tool. Read-only admission
therefore still requires Provider/egress, budget, artifact, and output controls.

### Writer requirements

Every writer binds:

- exact root run/revision/node/attempt;
- base commit and dirty-tree policy;
- backend-proven workspace ID and real cwd;
- allowed path prefixes and non-overlapping file claims;
- allowed mutation tools/commands and egress;
- handoff form (patch, commit, or typed artifact) and digest;
- integration owner and verification gates.

Shared cwd has a global one-writer ceiling. Parallel writers require managed
worktrees. Worktree creation failure, base drift, path overlap, unexpected
untracked/symlink/submodule behavior, or unknown cleanup state blocks dispatch
or integration.

No automatic reset, checkout overwrite, clean, branch deletion, or worktree
removal is authorized by this threat model. Cleanup is an explicit operation
against an exact reviewed target.

## 9. Secrets, privacy, and retention

The journal, snapshot, status, receipt, and normal logs may persist only
allowlisted low-sensitive metadata. They must not retain:

- Provider/MCP/Web credentials, cookies, auth headers, or environment dumps;
- full prompts, chain-of-thought/reasoning, full child transcripts, or raw tool
  output;
- repository file contents or patches unless stored as an explicitly classified
  bounded artifact;
- absolute home paths, account identifiers, or private remote URLs when a
  relative/redacted identity suffices.

Redaction occurs before durable write. Errors are structured and bounded;
serializing an exception object or tool request wholesale is prohibited.
Artifacts have retention classes and may be deleted only through a scoped,
reviewable operation after no durable receipt depends on their bytes. A digest
is not encryption and can reveal equality; low-entropy secrets must be omitted,
not merely hashed.

## 10. Capability degradation policy

Each backend capability is `SUPPORTED`, `DEGRADED`, or `UNAVAILABLE` with exact
evidence and reason.

| Missing capability | Safe behavior |
| --- | --- |
| Correlated terminal lifecycle | No live dispatch |
| Managed worktree | Read-only/shared single-writer paths only; parallel writer unavailable |
| Usage token/cost meter | Hard token/cost-capped run unavailable |
| Retry/rate-limit signal | Static bounded retry only, or no retry; no adaptive claim |
| Dynamic backend concurrency control | Keep logical cap at proven safe bound; do not claim backend tuning |
| Resume/reconcile | Nonterminal crash ambiguity becomes orphaned; no blind redispatch |
| Tool visibility isolation | Do not promote competing namespaced model tools |
| Stop/interrupt terminal proof | Cancel request may remain interrupted/orphaned; never claim cancelled |

Degradation must reduce capability or availability. It may not silently widen
authority, share cwd for a requested isolated writer, replace hard metering with
an estimate, or turn an ambiguous terminal into success.

## 11. Security verification program

### Deterministic no-Provider lane

Required on every change:

- schema and semantic-validator positive/negative corpus;
- permission and approval mutation matrix;
- plan compiler/digest goldens;
- duplicate/late/spoofed/out-of-order event corpus;
- lease/fencing, crash, torn-journal, and stale-snapshot matrix;
- budget reservation/rebuild/exhaustion/metering tests;
- artifact/cache path, symlink, size, digest, and poisoning tests;
- BatchSwarm order/partial/cancel/fairness tests;
- SwarmGoal revision/escalation/convergence tests;
- shared-cwd writer and managed-worktree failure tests;
- migration and evidence-claim tests;
- fuzz/property tests for parsers, reducers, IDs, state transitions, and bounds.

### Disposable live-backend lane

Before runtime-ready promotion:

- exact package-byte and RPC fixture verification;
- tool topology/owner visibility proof;
- read-only child spawn, event correlation, terminal proof, stop/interrupt/resume
  behavior, and orphan reconciliation;
- writer worktree creation/containment/failure behavior in a disposable repo;
- real capability snapshot and degraded/unavailable paths;
- cancellation with process observation;
- no user repository, real credentials, or production workspace used.

### Optional live-Provider lane

Live Provider tests are separate, secret-managed, low-budget, and never required
to run from an untrusted pull request. They verify only explicitly named facts,
such as metering availability, Provider rate-limit classification, cancellation,
and structured output. Credentials are injected outside the repository and are
not written to artifacts, logs, receipts, or CI output.

### Promotion gates

Release promotion is blocked by any open P0, any unmitigated P1 in the selected
Profile, any evidence/claim mismatch, or failure to meet the versioned eval
manifest thresholds. The receipt records exact source commit, package
identity/integrity, manifest version/digest, test commands, evidence class,
capability snapshot, and rollback target.

Static, simulator, and fake-backend PASS results remain valuable but cannot
satisfy a live-child, worktree, cancellation, metering, or Provider gate.

## 12. Incident and recovery policy

On suspected authority escape, wrong-target mutation, wallet spike, secret
leak, split brain, journal corruption, or orphaned child:

1. close root-run and global facade admissions without deleting evidence;
2. request backend stop/interrupt for exactly correlated active children;
3. do not label them cancelled until terminal proof arrives;
4. revoke/rotate affected credentials and apply external Provider/account limits
   where relevant;
5. preserve bounded journal, lease, correlation, process, workspace, capability,
   and receipt metadata; quarantine sensitive artifacts;
6. fence stale writers and require proof before lease takeover;
7. inspect worktrees/base checkout and produce a reviewable recovery plan;
8. never auto-reset, clean, overwrite, merge, delete, or replay ambiguous
   mutations;
9. invalidate approvals, cache entries, and release receipts whose digests or
   evidence are affected;
10. add a deterministic regression fixture before re-enabling the capability.

Recovery that cannot prove safety ends in a visible blocked/orphaned state and
requires operator action.

## 13. Explicit non-guarantees

The following are not security boundaries and must never be described as such:

- Pi Project Trust alone;
- hiding or renaming a tool;
- a prompt saying “read only”;
- Profile or Mode metadata without live enforcement;
- a Git worktree;
- a Node worker thread or JavaScript `vm`;
- a content hash without protected storage;
- a fake runtime, deterministic simulator, or static schema check;
- a successful RPC acknowledgement without terminal proof;
- cancellation requested without observed termination;
- a Provider estimate presented as a hard meter;
- hosted Kimi/Claude product documentation presented as local implementation
  evidence.

For hostile repositories, unattended writers, sensitive credentials, or
untrusted generated code, use an external container, micro-VM, or equivalent OS
isolation covering filesystem, process, credential, and network surfaces. Even
then, retain the orchestration controls in this document.

## 14. Revisit triggers

Update this threat model before enabling:

- any physical backend other than exact `pi-subagents@0.45.2`;
- arbitrary JavaScript Workflow or plugin-supplied executable planners;
- Team/mailbox or child-to-child direct messaging;
- remote/cross-host workers or shared network state;
- cross-run shared cache;
- automatic merge/push/PR/deploy or destructive repository cleanup;
- unattended writer, network, Web, MCP, browser, or production credentials;
- adaptive Provider concurrency/cost controls;
- a new tool-visibility or permission owner;
- a new artifact media/archive type;
- any upstream version or source change affecting a cited capability or threat.

No feature is grandfathered through a threat-model change. The relevant eval
manifest, negative fixtures, live capability evidence, and release receipt must
advance together.

# ADR-0006: Use canonical Workflow IR and a fenced event-sourced run state

## Status

Accepted — 2026-08-18

## Context

`@only-my-pi/subagents` needs one execution representation for predefined
Workflow, BatchSwarm expansion, dynamic SwarmGoal revisions, and UltraRun phase
routing. The representation must be reviewable before execution, recover after
a Pi or host-process restart, preserve approval and budget boundaries, and
reject duplicate/late backend events without settling the wrong logical node.

The existing v1 Workflow runner and Swarm controller do not provide a shared,
durable node-level state machine. Model-written JavaScript is attractive for
expressiveness, but is not a reliable security, approval, replay, or migration
boundary. A Node worker or `vm` does not make arbitrary code safe.

The runtime ownership decision is in
[ADR-0005](ADR-0005-unified-subagents-runtime.md); the source evidence is in the
[S0 dossier](../research/2026-08-18-subagents-source-dossiers.md).

## Decision

### 1. Canonical representation

The canonical execution representation is versioned, declarative JSON:

```text
WorkflowDefinition v2
       |
       | deterministic compile + semantic validation
       v
WorkflowPlan v1 revision (immutable, canonical, hashed)
       |
       | one active revision per root run
       v
WorkflowRun event ledger + typed artifacts + snapshots
```

S0-S5 do not execute arbitrary JavaScript Workflow. A later Labs authoring
language may be considered only if it is non-default, statically bounded, and
compiles completely to the same validated WorkflowPlan before approval. It may
not expose filesystem, shell, network, Provider, MCP, or physical child control
to the authoring program.

Unknown versions, keys, node kinds, expressions, transitions, gates, schema
references, capabilities, budget fields, and policy values fail closed.

### 2. Definition and Plan contracts

`WorkflowDefinition` is an author-time resource. It may contain reviewed
combinators such as:

- `sequence`;
- `parallel`;
- bounded `map`;
- `pipeline`;
- explicit deterministic `reduce` projection;
- bounded `repeatUntil`;
- `checkpoint`.

The compiler normalizes those combinators into Plan primitive nodes:

- `agent`;
- `batch-swarm`;
- `gate`;
- `checkpoint`;
- `approval`;
- `loop-controller`.

Nested definitions are flattened at compile time and receive deterministic,
namespaced node IDs. They do not create another `RunCoordinator`.

A Plan contains at least:

- format version, definition ID/version/digest, and canonical plan digest;
- revision number, optional parent plan digest, reason, and activation policy;
- immutable node and dependency lists;
- entry nodes and terminal node;
- root and node policy snapshots plus policy digests;
- root and node budget envelopes;
- resolved schema, agent-template, task-template, gate, and artifact references;
- cache/idempotency declarations;
- workspace, mutation, path-claim, and egress declarations.

Compilation is deterministic: identical canonical Definition plus identical
resolution inputs produces byte-identical canonical Plan and digest. Map order,
object insertion order, locale, wall clock, random values, host paths, and
backend availability cannot influence the digest. Runtime capability is checked
during admission and recorded separately.

### 3. Canonical JSON and digests

State and contract values contain plain JSON only. The canonical codec:

- sorts object keys recursively;
- preserves array order;
- accepts strings, booleans, null, and finite JSON numbers;
- normalizes negative zero to zero;
- rejects `undefined`, functions, symbols, bigint, non-finite numbers, cyclic
  values, class instances, maps, sets, dates, buffers, and inherited objects.

Digests use SHA-256 over UTF-8 canonical JSON bytes and are represented as
`sha256:` followed by 64 lowercase hexadecimal characters. Tests must include
cross-process golden vectors for plan, event, snapshot, approval, artifact, and
cache-key digests. Changing codec semantics requires a new format version and
migration; it cannot silently alter prior digests.

### 4. Root, revision, node, and attempt identities

Identity is hierarchical and typed:

```text
runId
  -> revision number + planDigest
      -> nodeId
          -> assignmentId
              -> attemptId
                  -> backend child/session/request/async/process identifiers
```

`runId`, `nodeId`, `assignmentId`, `attemptId`, backend child ID, RPC request
ID, and terminal event ID are distinct fields. No implicit string coercion or
fallback lookup is permitted. Batch item identity is derived from the canonical
batch definition plus stable item index/key; result order follows input order,
not completion order.

An attempt is the unit of physical dispatch and budget reservation. Retrying a
node creates a new attempt ID but retains the logical assignment ID. Backend
resume may retain its backend child ID only when the public capability and
correlation tuple prove that identity.

### 5. Plan revision state machine

Every root run has at most one active Plan revision. The lifecycle is:

```text
DRAFT -> AWAITING_APPROVAL -> ACTIVATING -> ACTIVE
                                         -> SUPERSEDED
                                         -> SETTLED
```

An invalid or denied draft is terminal outside this activation path and never
becomes active.

Revision `N+1` follows this barrier:

1. compile, canonicalize, validate, and display a digest-bound diff while N
   remains active;
2. obtain the required exact approval and budget/workspace/policy evidence;
3. durably enter `ACTIVATING` and atomically close N to new admissions;
4. mark N's unstarted queued nodes `SUPERSEDED`;
5. apply N's declared `drain | stop` policy to active attempts and obtain a
   correlated terminal proof for each;
6. if proof cannot be obtained, move the root run to
   `INTERRUPTED`/`ORPHANED`; do not activate N+1;
7. project a completed result into N+1 only when node semantics, input and
   dependency artifact digests, agent spec, policy, workspace, and cache key
   still match;
8. revalidate approval, remaining reservation capacity, base commit, policy,
   workspace, and referenced artifacts;
9. compare-and-swap `activeRevision=N` to `N+1`;
10. append and fsync `RevisionActivated` before any N+1 child admission.

No background preparation for N+1 may reserve/spawn a child. At no instant may
two revisions admit physical work.

Every mutating revision requires exact reapproval. A read-only revision can
reuse approval only when it remains inside a previously approved replan
envelope whose digest binds maximum nodes/assignments/revisions, allowed paths,
read-only tools/egress, schemas, and budget. A change outside the envelope
returns to `AWAITING_APPROVAL`.

### 6. Event record

The append-only journal is the authority. A snapshot is only a verified cache
of a journal prefix.

The v1 durable event envelope contains exactly:

| Field | Meaning |
| --- | --- |
| `formatVersion` | Event schema version |
| `runId` | Root run identity |
| `seq` | Monotonic, contiguous sequence beginning at 1 |
| `eventId` | Producer idempotency identity |
| `type` | Versioned PascalCase event type |
| `timestamp` | Recorded UTC instant; informational, never ordering authority |
| `revision` | Plan revision number |
| `nodeId`, `attemptId`, `swarmRunId`, `childId` | Nullable typed correlation fields |
| `writerId`, `fencingToken` | Canonical writer identity and monotonically increasing fence |
| `inputDigest` | Digest of normalized producer input |
| `prevEventDigest` | Prior record digest, or the versioned genesis digest |
| `payload` | Bounded, schema-validated plain JSON metadata |
| `eventDigest` | Digest of the complete canonical record excluding this field |

Payloads contain bounded metadata and typed artifact references, not unbounded
prompts, reasoning, transcripts, raw tool output, credentials, or repository
content.

Event families include:

- root lifecycle: created, paused, resumed, cancel requested, completed, failed,
  cancelled, interrupted, orphaned;
- revision lifecycle: proposed, approval bound, activation started, admission
  closed, activated, superseded, settled;
- node lifecycle: queued, admitted, superseded, settled, gate evaluated;
- attempt/backend lifecycle: dispatch intent, child acknowledged, started,
  output projected, stop/interrupt requested, terminal observed;
- budget lifecycle: reserved, consumed, refunded;
- artifact/cache lifecycle: committed, reused, rejected;
- security observations: event rejected, capability degraded, approval stale,
  orphan detected.

Each event type has a versioned payload schema and legal predecessor states.
The generic envelope accepting a string type does not authorize an unknown
semantic transition.

### 7. Exactly-once state effects and idempotency

The system promises exactly-once **reducer effects**, not exactly-once external
execution.

Append uses compare-and-swap on expected `(seq, eventDigest)`. For an incoming
event:

- a new `eventId` with a valid transition appends once;
- the same `eventId` and same normalized `inputDigest` returns the original
  record without a second reducer effect;
- the same `eventId` with different input is `EVENT_ID_CONFLICT` and fails
  closed;
- an event after attempt/node/root terminal state is a late observation and
  cannot reopen or resettle it;
- a prior-revision, prior-attempt, unknown-child, or mismatched correlation
  event cannot affect current state;
- sequence gaps, hash mismatch, illegal transitions, or unknown semantic events
  stop recovery rather than being skipped.

Before any external side effect, the coordinator durably writes an intent with
an idempotency key. The backend correlation acknowledgement is then written as
a separate event. If a crash occurs between intent and acknowledgement, the
coordinator must query/reconcile through a proven public backend capability. If
the backend cannot prove whether the spawn occurred, the attempt becomes
`ORPHANED`; it is not blindly respawned. A read-only retry still requires an
explicit retry policy and a new attempt/budget reservation.

Mutating tools are not made idempotent merely by assigning a key. Each writer
must use an isolated workspace, bounded path claims, explicit handoff, and
reviewed retry semantics. Automatic replay of an ambiguous mutation is
prohibited.

### 8. Single writer, lease, and fencing

One writer process owns canonical state for a root run. Serialization uses a
run-scoped operation lock plus a durable lease containing run ID, writer ID,
expiry, status, and monotonically increasing fencing token.

Rules:

1. every append, recovery repair, and snapshot publication verifies the active,
   unexpired lease and exact fencing token;
2. renewal keeps the same token; a newly acquired lease increments it;
3. expiry alone is not proof that a writer is dead;
4. reclaim requires an injected proof that the prior writer cannot append
   again, such as verified process death under the same host/runtime identity;
5. when death cannot be proved, recovery returns
   `LEASE_RECLAIM_PROOF_REQUIRED` and remains blocked;
6. an older token is fenced even if its process resumes;
7. operation-lock recovery is allowed only when the lock belongs to an older
   fencing token proven stale;
8. multiple app/TUI/CLI views send commands to the owner; they do not become
   state writers.

The initial implementation is single-host. Cross-host leases require a storage
system with linearizable compare-and-swap and a separate ADR; wall-clock lease
files alone are insufficient.

### 9. Durable journal and snapshot

Journal storage is newline-delimited canonical JSON, one bounded record per
line, mode-restricted within the governed run directory.

Append durability order is:

1. validate lease and expected journal head;
2. derive the next sequence/hash-chained record;
3. append one complete line;
4. fsync the file;
5. fsync the containing directory;
6. only then expose the transition as committed.

Recovery accepts only a valid continuous prefix. A provably incomplete final
JSON record may be truncated under the current fenced lease, with a recorded
recovery result. Invalid JSON or digest/sequence corruption in the middle,
ambiguous trailing corruption, and a valid record with an invalid hash are not
repairable automatically.

A snapshot contains format version, run ID, creation time, `lastAppliedSeq`,
`lastEventDigest`, `activeRevision`, reduced state, and its own digest.
Publication writes a same-directory temporary file, fsyncs it, atomically
renames it, and fsyncs the directory. Recovery uses a snapshot only if its
digest and journal anchor match; otherwise it replays from genesis or the last
valid earlier snapshot. Events after the anchor are reduced in order.

A publication result that was renamed but whose directory fsync could not be
confirmed is reported as `PUBLISHED_NOT_CONFIRMED_DURABLE`; the caller must
re-read and reconcile rather than assuming success or failure.

### 10. Budget reservation ledger

Every dispatch is preceded by a worst-case reservation appended with the same
journal compare-and-swap. The reservation vector may include workflow runs,
phases, revisions, assignments, iterations, retries, elapsed time, turns, tool
calls, tokens, cost, raw output bytes, artifact bytes, and writer worktrees.

The order is normative:

```text
admission checks
  -> BudgetReserved durably committed
  -> dispatch intent durably committed
  -> backend spawn request
  -> terminal proof
  -> BudgetConsumed or BudgetRefunded
```

Reservations are identified independently and settle exactly once. Consumed
plus refunded resources equal the original worst-case reservation. Crash
recovery rebuilds committed, outstanding, consumed, and available capacity from
events before admitting work.

A hard token or cost limit requires reliable runtime metering. If capability
negotiation cannot prove it, admission returns `METERING_UNAVAILABLE` rather
than pretending prompts, output bytes, or estimates are equivalent meters.

### 11. Artifact and context-shard contract

Large or sensitive data is not embedded in events. An `ArtifactRef` contains:

- artifact format version, media/schema type, byte size, and content digest;
- governed relative storage identity, never an arbitrary absolute path;
- producer run/revision/node/attempt identity;
- policy classification, redaction status, and retention class;
- optional bounded provenance references to input artifact digests.

Artifacts are written to a temporary contained path, size-checked, fsynced,
content-hashed, schema-validated, atomically published, and only then referenced
by an event. Reads verify realpath containment, regular-file type, size, and
digest before parsing. Symlinks and unknown media/schema versions fail closed.

SwarmGoal context sharding passes only approved, bounded ArtifactRefs and
structured summaries to another node. Complete child transcripts, hidden
reasoning, environment values, and credentials are not context artifacts.

### 12. Cache and result reuse

A cache key binds at least:

- node kind and canonical node definition;
- resolved AgentSpec and task-assignment digest;
- exact input/dependency artifact digests;
- output schema and deterministic aggregator version;
- policy/tool/egress/workspace/base-commit digests;
- relevant backend/model role identity when output semantics depend on it.

Cache hits revalidate artifact digest/schema, policy compatibility, base commit,
and revision rules. A cached result never carries approval or authority. A
mutating attempt is not replayed from cache as proof that its side effect exists.
Cross-run cache is read-only and disabled until poisoning, provenance, and
retention tests pass.

### 13. Cancellation and terminal proof

Cancellation is a durable state machine, not a UI flag:

1. append root/node/attempt cancel intent;
2. close new admissions for the affected scope;
3. send the supported backend interrupt or stop operation;
4. correlate backend acknowledgement and terminal observation;
5. settle reservations/artifacts and then the attempt/node/root.

`CANCEL_REQUESTED` is not `CANCELLED`. Timeout without terminal proof results in
`INTERRUPTED` or `ORPHANED`, preserves the outstanding correlation, blocks unsafe
workspace integration, and requires operator reconciliation. A late terminal
event may be recorded as an observation but cannot silently change an already
published root terminal receipt.

### 14. Recovery procedure

On startup or explicit resume, the coordinator:

1. validates governed run-path containment, marker, ownership, format, and file
   types;
2. acquires a writer lease or proves a stale writer dead and obtains a higher
   fencing token;
3. validates the journal's continuous sequence/hash prefix and repairs only a
   provable trailing partial record;
4. validates the newest anchored snapshot or discards it as a cache;
5. replays events deterministically and rebuilds budget reservations;
6. checks that exactly one revision is active and all state-machine invariants
   hold;
7. queries the public backend for every acknowledged nonterminal attempt when
   capability exists;
8. records correlated terminals, or marks ambiguity `ORPHANED` without
   redispatch;
9. revalidates approval, policy, Profile/Mode, base commit, workspace, artifacts,
   and backend capabilities;
10. publishes a new snapshot and only then considers new admission.

Resume never means “rerun everything after the last visible result.” It is a
reconciliation of durable intent, external lifecycle evidence, and current
authority.

### 15. Migration

New v2 runs write only this Plan/event/artifact family. Legacy records are
dual-read for display and provenance but are not appended with v2 events.

- completed legacy results may become explicitly imported input artifacts after
  digest/schema validation;
- nonterminal legacy runs are never auto-resumed or mutated;
- a new run may cite a legacy run ID as provenance, but receives a new run ID,
  Plan, approval, budget, and workspace evaluation;
- migration readers are versioned and removed only after retention policy and
  release evidence permit it;
- historical receipts retain their original evidence classification.

## Required validation and release gates

Promotion requires deterministic tests for:

- positive and negative schema/semantic fixtures, including unknown fields,
  cycles, invalid references, illegal escalation, and budget overflow;
- byte-identical compilation/digests across repeated processes;
- every legal and illegal revision/node/attempt transition;
- duplicate event idempotency, conflicting IDs, sequence gaps, late and spoofed
  backend events, and prior-attempt/prior-revision events;
- two competing writers, lease expiry without death proof, higher-token fencing,
  and stale operation locks;
- crash points before/after append, fsync, rename, snapshot, reservation, spawn,
  acknowledgement, terminal, consume, and refund;
- journal trailing partial recovery and fail-closed middle corruption;
- reservation rebuild and `METERING_UNAVAILABLE`;
- artifact size/path/symlink/digest/schema/redaction failures;
- activation barrier proof that N and N+1 cannot dispatch concurrently;
- cancellation/orphan reconciliation;
- dual-read/new-write migration and nonterminal legacy rejection.

The evaluation manifest and thresholds are versioned. A promotion receipt names
the exact manifest digest, source commit, backend package identity, executed
tests, and evidence class. Simulator/fake-backend results cannot satisfy a live
child or live Provider gate.

## Consequences

- every orchestration form shares one reviewable and recoverable execution
  representation;
- model creativity is constrained to proposing typed data before authority is
  granted;
- state can be reconstructed and audited without retaining sensitive full
  transcripts;
- exactly-once external side effects are not falsely promised;
- durable intent and terminal proof make ambiguous crashes visible as orphans;
- the format and storage code are more deliberate than an in-memory scheduler,
  but become reusable across CLI, Pi extension, TUI, and tests;
- future authoring languages, backends, or cross-host execution require explicit
  versioned seams rather than bypassing the IR and ledger.

## Rejected alternatives

- Treating model-generated JavaScript as the canonical or trusted Workflow.
- Using Node worker threads or `vm` as an OS sandbox.
- Allowing Workflow, BatchSwarm, and SwarmGoal to keep separate DAG/state
  engines.
- Mutating an active Plan in place.
- Activating a revision while its predecessor can still admit or run
  uncorrelated work.
- Ordering events by timestamps or backend completion order.
- Claiming exactly-once physical spawn or filesystem side effects.
- Replaying an ambiguous mutating attempt after a crash.
- Reclaiming a writer lease on expiry without proving the old writer dead.
- Trusting a snapshot without its journal anchor.
- Embedding unbounded prompts, transcripts, or raw tool output in the ledger.
- Treating a cache hit as approval, authority, or proof of a prior side effect.
- Auto-importing or resuming nonterminal legacy runs.

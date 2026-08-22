# Subagents S5-A protected live capture

Status: **production capture path and time-bounded public Alpha signer
configured; no protected live run has been authorized or executed** · 2026-08-22

S5-A supplies the missing producer side of the source-pinned protected-evidence
protocol. It is intentionally limited to the three read-only evidence classes
required for an Alpha claim:

- `live-agent-terminal`;
- `live-agent-cancel`;
- `live-batch-terminal`, with exactly two governed read-only items in the
  initial scenario.

`background-resume` now has a separate S5-B producer and authorization contract;
`guarded-writer-integration` remains later S5 work. This S5-A authorization
schema still rejects both IDs, so an operator cannot turn an Alpha capture
command into a Beta writer or background-resume run. See
[Subagents S5-B protected background resume](subagents-s5-background-resume.md).

## Execution path

```text
clean source commit + runtime-ready public-key trust policy
        +
one-time bounded operator authorization
        |
        v
scripts/subagents-live-evidence.mjs --run --yes
        |
        +-- exact Node/Pi/pi-subagents compatibility-row preflight
        +-- empty disposable config root; never the real ~/.pi
        +-- isolated HOME/TMP/XDG/PI_CODING_AGENT_DIR
        +-- synthetic disposable workspace; source repository is not child cwd
        +-- canonical omp-reviewer recompiled, drift-checked, copied to isolated agent root
        +-- pi-subagents artifacts forced to its temp scope
        +-- audited pi-subagents@0.45.2 + first-party capture extension only
        |
        v
one physical pi-subagents RPC backend
        +-- read-only Agent terminal
        +-- correlated interrupt + authoritative cancellation terminal
        `-- two-item homogeneous BatchSwarm terminal set
        |
        v
bounded low-sensitivity capture records
        |
        v
external digest-only Ed25519 signer
        |
        v
operator-selected empty staging directory
```

The capture extension composes existing product contracts rather than adding a
new scheduler: `AgentRunHandle` and `TaskAssignment` cover the two single-Agent
scenarios, while `createPiBatchSwarmRuntime` covers the homogeneous batch. All
physical launches still pass through the pinned `pi-subagents` extension RPC.
The source repository is used only to validate and resolve versioned
first-party contracts. The Pi parent and all children run in a synthetic
fixture workspace containing only a small read-only `package.json` and
`README.md`. The directory remains operator-removable; this is a read-only
tool/Agent envelope, not an OS sandbox. The upstream extension's artifact
preference is explicitly set to `temp`, so it does not create
`.pi-subagents/` state in either the source tree or fixture workspace.

## Default plan and explicit run

The default command is inspection-only:

```bash
npm run plan:subagents-live-evidence
```

With the checked-in repository state it returns
`CONFIGURED_UNAVAILABLE`: the trust policy contains a public Alpha signer but
there is no active one-time authorization. It does not call a Provider, dispatch a child, invoke a
signer, create a config root, or read the real Pi home.

A real run is available only after a separate operator action supplies every
explicit path and confirmation:

```bash
node scripts/subagents-live-evidence.mjs --run --yes \
  --authorization-file /absolute/operator-authorization.json \
    --config-root /absolute/empty-disposable-root \
    --package-root /absolute/audited-pi-subagents-0.45.2 \
    --provider-file /absolute/credential-free-provider.json \
    --repository-root /absolute/only-my-pi \
  --pi-command /absolute/pi \
  --signer-command /absolute/external-digest-signer \
  --output-dir /absolute/empty-evidence-staging --json
```

The driver never writes directly to `verification/protected/`, imports
evidence, commits, pushes, tags, publishes, or changes the compatibility
matrix. Staging is a review boundary. A partial staging directory is invalid
and must not be imported.

## Authorization and signing contract

`subagents-live-evidence-authorization-v1` binds the exact source commit,
compatibility matrix, promotion policy, trust-policy digest, compatibility row,
three evidence IDs, Provider/model tuple, Provider-descriptor digest, credential environment variable
names, ceilings, read-only workspace policy, signer identity/fingerprint, and
a positive window of at most 24 hours. Live use requires explicit token and USD
ceilings. The two-item batch requires at least two children and concurrency of
two. Child, token, cost, elapsed-time, and captured-output ceilings are one
aggregate authorization for the entire evidence set, not reusable per
scenario. Each Pi process receives only its fixed child shape and the remaining
aggregate budget.

Every terminal must report finite token and USD usage; missing metering makes
the evidence fail. The async `pi-subagents@0.45.2` RPC lane does not expose a
verified mid-child token/USD kill switch, so those two values are signed
eligibility and reconciliation ceilings, not a billing circuit breaker. Use a
Provider account limit or an outer egress/billing control when prospective hard
spend enforcement is required. Child count is additionally constrained before
dispatch, and wall time is bounded by terminating the isolated Pi process group.

The Provider's `declaredEndpointHosts` are an auditable authorization
declaration, not an enforced network allowlist. Pi and extension code still run
with the caller's network authority. An operator who needs network isolation
must enforce it outside Pi with a container, VM, or OS network policy.

Only the authorization-listed credential variables cross into the isolated Pi
environment. A separate schema-validated descriptor contains exactly one
Provider and one authorized model, requires a credential-free HTTPS endpoint,
and compiles `apiKey` to the one approved `$ENVIRONMENT_VARIABLE` reference.
Its digest is part of the one-time authorization. Literal keys, credential
commands, custom headers, extra models, endpoint-host drift, and authority-bearing
compat fields fail before Pi starts. No other Provider variable, session, model
store, user HOME, or real Pi config is inherited. The external signer receives exactly one canonical
`sha256:` line on stdin and returns one canonical 64-byte Ed25519 signature on
stdout. The driver does not pass a private-key path or private-key environment
variable; key access belongs to the separately reviewed signer executable.

## Evidence and privacy boundary

The Pi extension emits one bounded record containing only:

- source/contract/authorization digests and the exact runtime tuple;
- required proof kinds with SHA-256 digests;
- authoritative terminal, batch-item, cancellation and usage counters;
- explicit false values for raw output, host path, credential and session-ID
  storage.

Raw prompts, reasoning, child output, findings, repository contents, backend
run IDs, host paths and credentials are not written to the evidence document.
Every capture is revalidated before signing, and every signed document is
immediately verified against the checked-in public key and release contracts.
The staging manifest retains the low-sensitivity capture records and aggregate
usage. Each record's digest must equal the digest embedded in its signed
evidence attestation, so an operator can review the metering and proof receipts
without retaining raw child output.

## Fail-closed boundaries

Execution stops before Provider dispatch when the source is dirty or drifted,
the trust policy is unavailable, the authorization is expired/tampered, the
runtime tuple differs, the config root is non-empty, the real Pi home would be
used, the package artifact is not the audited `0.45.2` build, or a credential
is absent. It also stops before Provider dispatch if the canonical reviewer is
not runtime-ready and strictly read-only, or if its checked-in generated
resource differs from a fresh deterministic compilation. It rejects symlinked
authorization/signer/output inputs,
ambiguous capture records, missing process-terminal proof, non-authoritative
terminals, exceeded usage ceilings, malformed signatures and output truncation.
Repository, disposable config, and staging roots must be real, non-symlink and
pairwise disjoint. After all scenarios and signatures finish, the driver
rechecks the exact Git HEAD and complete worktree before staging; any concurrent
source change discards the in-memory capture and writes no evidence file.

The implementation and deterministic tests do **not** constitute live evidence.
Until an operator configures a source-pinned public key and deliberately runs
this command with real Provider authority, all three protected gates remain
`NOT_RUN_BY_POLICY` and the project remains Preview.

# ADR-0004: Publish Pi configuration only after an immutable generation is verified

## Status

Accepted — 2026-08-16

## Context

Pi package configuration is immediately active the next time Pi starts. A
bootstrap process that writes `settings.json` before packages and first-party
resources are available can therefore leave Pi pointing at missing or only
partially installed code. Updating a shared settings file also has to preserve
entries owned by the user and by other Pi packages. Package installation,
configuration publication, process interruption, and rollback do not form one
filesystem transaction, so the safe ordering and recovery evidence have to be
explicit.

The bootstrap must not use the user's Pi package installer to make stronger
supply-chain claims than that installer provides. It must also keep Provider
selection separate from authentication and a live model check.

## Decision

### Plan first

`omp bootstrap`, `omp update`, and `omp uninstall` produce a zero-write plan by
default. Mutation requires `--apply` and either an interactive full-word `yes`
confirmation or an explicit `--yes` from the user. `rollback` likewise renders
its plan before confirmation. Plans bind the source settings digest and the
resolved package/resource graph digest; an apply fails with `PLAN_STALE` if
either changes.

### Explicit configuration root and ownership

The config runtime accepts one absolute `configRoot`, corresponding to
`PI_CODING_AGENT_DIR`. It never discovers or opens a default home directory on
its own. Production CLI parsing may choose Pi's conventional default for a
normal user invocation, but every service and every test receives the resolved
root explicitly.

only-my-pi owns these settings pointers:

```text
/packages
/extensions
/skills
/prompts
/themes
/onlyMyPi
```

Ownership of an array is narrower than ownership of the entire user list. The
`onlyMyPi.managedSettings` receipt records the exact entries added by the last
successful generation. Reconciliation removes only those prior entries, keeps
unknown and user-managed entries, and appends the new managed set. Metadata is
an exact-key, versioned object. Provider metadata can only have
`CONFIGURED_UNVERIFIED`; an initial Mode can only have
`PENDING_M3_RESOLUTION` until M3 provides the real resolver.

### Immutable generation before visible settings

The package/resource graph is staged below:

```text
<configRoot>/only-my-pi/generations/.staging-<graph>-<transaction>/
```

Each promoted top-level package has an exact npm version or full Git commit and
a reviewed canonical SHA-512 integrity value. Staging obtains the tarball with
an injected, no-shell npm runner, verifies its bytes before installation, and
forces lifecycle scripts off in both argv and environment. First-party
resources are copied only after containment, real-file, symlink, and content
hash checks. The realized package tree and complete `node_modules` tree are
content-hashed after installation.

Only a completely verified staging tree can be atomically renamed to:

```text
<configRoot>/only-my-pi/generations/<graph-digest>/
```

The settings compiler then re-verifies the on-disk manifest and every retained
artifact. It emits only contained paths to the immutable generation. Settings
publication is the final visibility point, after graph promotion.

The repository currently audits direct package tarballs before npm executes.
Transitive dependencies are first resolved by npm in the credential-isolated
staging prefix and then covered by the realized tree hash. A future transitive
lock/SRI closure can strengthen first-resolution provenance; the current code
does not claim that every transitive tarball was pre-audited.

### Durable journal and recovery

Apply and rollback share one exclusive configuration lock. A transaction uses
the following durable phase order:

```text
PREPARED
→ BACKUP_DURABLE
→ GRAPH_STAGING
→ GRAPH_STAGED
→ GRAPH_VERIFIED
→ GRAPH_PROMOTED
→ SETTINGS_PUBLISHED
→ STATIC_DOCTOR_PASSED
→ SMOKE_PASSED
→ COMMITTED
```

The journal records a manifest digest before generation promotion and records
both the real promotion-created flag and intended settings digest before the
settings rename. The final settings publication is compare-and-swap bound to
the source digest used by the plan. Recovery compares the visible settings
digest with the pre-transaction snapshot and durable intent. It restores only
when that comparison proves which version is visible. A third, concurrent
value observed before `SETTINGS_PUBLISHED` is preserved, the transaction is
settled as `FAILED / CONCURRENT_SETTINGS_CHANGE`, and the caller must create a
fresh plan. A third value after a journaled publication is ambiguous and fails
closed.

Snapshots contain the selected resource-array values and only-my-pi metadata,
plus source and manifest hashes. Arrays can include user entries that existed
at snapshot time, so snapshot manifests are private local rollback data and
must not be committed or synchronized. Restore is hash-gated and reconciles
only the exact historical/current managed entries, preserving user entries
added after the snapshot. The snapshot contract does not intentionally copy
credential stores, sessions, caches, or unrelated top-level Provider
configuration. A last-known-good record binds the generation manifest,
committed settings, rollback snapshot, and non-sensitive metadata. If settings
have committed but the LKG record is interrupted, the next locked operation
repairs it without running npm, Pi, or a Provider.

Lock, initial transaction journal, and snapshot directories are assembled as
private sibling directories, fsynced, and atomically renamed into their final
names. A hard crash can leave a strictly named temporary sibling, but cannot
publish a final lock, transaction, or snapshot directory without its required
owner or manifest.

An interrupted generation rename may leave a verified, unreferenced immutable
generation. That is safe cache state because visible settings still point at
the previous generation. Recovery removes an exact newly-created generation
only when the durable receipt proves it belongs to the failed transaction;
reused and historical generations are retained for rollback.

### No-model startup smoke

After settings publication and the static doctor, bootstrap starts Pi in RPC
mode with `--offline`, `--no-session`, `--no-context-files`, `--no-skills`,
`--no-tools`, and `--no-approve`, sends only `get_state`, and closes stdin. The
process receives a scrubbed environment and a disposable agent directory below
the managed runtime. Its generated settings contain only the current
only-my-pi-managed resources rewritten as absolute paths. Pi's normal config
lookup therefore does not receive the user's configured auth, model, or session
stores.

This proves that Pi can start and answer a local state request without the
runner submitting a prompt. Loaded extension code still executes as the
invoking OS user and can use host filesystem or network authority. The smoke
therefore does not prove that extensions made no access, Provider inactivity or
authentication, model behavior, network isolation, or an OS sandbox. Those
remain separate live and security gates.

## Consequences

- Visible settings cannot reference a staging directory or an unverified
  generation.
- Concurrent settings writes are never silently overwritten by an older plan.
- A crash at every durable boundary has a deterministic, hash-gated recovery
  result.
- Second apply is an idempotent no-op after local generation verification.
- Uninstall removes only recorded managed settings and retains immutable
  generations/snapshots needed for reviewable rollback.
- The transaction history is low-sensitive metadata; raw subprocess output is
  represented only by bounded digests in public results.
- A bootstrap can still download reviewed packages from their recorded source;
  true network isolation is outside this transaction contract.

## Rejected alternatives

- Writing settings before or concurrently with package installation.
- Calling `pi install` and assuming it provides scripts-disabled staging and
  atomic settings publication.
- Replacing the whole settings file or deleting user package/resource entries.
- Running package lifecycle scripts without a separately reviewed outer
  sandbox.
- Treating Project Trust, `--offline`, an approval prompt, or the no-model
  startup smoke as whole-process network or OS isolation.
- Saving API keys, OAuth tokens, or a `VERIFIED` Provider state in bootstrap
  metadata.

# Config runtime

Dependency-free Node ESM primitives for the explicit Pi agent directory passed
as `configRoot` (the value that would normally be `PI_CODING_AGENT_DIR`). The
module never discovers a home directory and never selects a real Pi directory
on its own.

## Layout

```text
<configRoot>/settings.json
<configRoot>/only-my-pi/generations/
<configRoot>/only-my-pi/transactions/
<configRoot>/only-my-pi/snapshots/
<configRoot>/only-my-pi/state/last-known-good.json
<configRoot>/only-my-pi/locks/configuration.lock/
```

`createConfigPaths(configRoot)` returns these absolute paths. Contained path
helpers reject traversal, non-canonical portable paths, and symlinks within the
configured boundary.

## Publication and ownership

- `atomicWriteText` and `atomicWriteJson` write an exclusive temporary file,
  fsync it, rename it, then fsync the containing directory. Tests can inject a
  failure through `failAtPhase` or `onPhase`.
- `loadSettings` treats a missing file as fresh state but rejects blank,
  malformed, non-object, or symlinked settings.
- `mergeOwnedSettings` and `removeOwnedSettings` accept explicit JSON Pointer
  ownership. They preserve every field outside that set and reject overlapping
  or prototype-sensitive ownership paths.

## Lock and transaction protocol

`acquireExclusiveLock(configRoot, { operation })` uses one lock for both
`apply` and `rollback`. The returned handle owns a random token and exposes
`refresh()` and `release()`. A stale lock is reclaimed only when its heartbeat
is expired and the owner is proven dead; corrupt or remote-owner state fails
closed.

The versioned journal phases are:

```text
PREPARED
BACKUP_DURABLE
GRAPH_STAGING
GRAPH_STAGED
GRAPH_VERIFIED
GRAPH_PROMOTED
SETTINGS_PUBLISHED
STATIC_DOCTOR_PASSED
SMOKE_PASSED
COMMITTED
```

`advanceJournal` accepts only the next phase. The first transitions to
`GRAPH_VERIFIED` and `GRAPH_PROMOTED` durably bind the generation manifest and
the intended settings digest. The latter happens before settings publication,
closing the rename-before-journal crash window. `SETTINGS_PUBLISHED` is only a
confirmation. `verifyTransactionRecoveryEvidence` classifies current settings
as unchanged, intended-and-needing-restore, already restored, or unrelated
drift that must fail closed.

Recovery uses `beginTransactionRecovery` followed by
`settleTransactionRecovery(..., "ROLLED_BACK" | "FAILED", ...)`; it never
fabricates successful phases or deletes the journal.

## Snapshot and last-known-good state

`createSnapshot` stores only the configured owned settings projection. It does
not copy unknown user or Provider fields. `restoreSnapshot` requires the exact
current semantic settings digest and optionally an exact ownership set. It
restores only owned fields, preserves unrelated fields, and can durably restore
an originally absent settings file.

`writeState`, `verifyLastKnownGood`, and `restoreLastKnownGood` bind a versioned
last-known-good record to all of:

- a verified owned snapshot;
- the semantic settings digest;
- a generation manifest path and byte digest;
- restricted Provider/model and initial-mode metadata.

Provider metadata can be only `CONFIGURED_UNVERIFIED`; initial mode metadata
can be only `PENDING_M3_RESOLUTION`. Unknown metadata fields fail before write.

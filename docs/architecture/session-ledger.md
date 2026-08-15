# Session ledger extension

`extensions/session-ledger` is a small, local-only Pi extension for append-only
operational receipts. It does not replace, read, or modify Pi's native session
files, and it makes no network requests.

## Receipt contract

Each extension runtime creates one JSONL file at
`~/.pi/agent/only-my-pi/ledgers/run-<runId>.jsonl` (mode `0600`) below a
directory mode `0700`. An existing directory with group/other access or a
symbolic-link destination is rejected rather than silently changing its
permissions. The directory can be overridden with an absolute
`ONLY_MY_PI_LEDGER_DIR` or `PI_SESSION_LEDGER_DIR` environment variable. The
first variable wins. Relative overrides are rejected to avoid cwd-dependent
writes.

Every line contains `schemaVersion: 1`, an ISO timestamp, a runtime `runId`, an
event name, and (when available) a native Pi `sessionId`. Session file paths,
entry IDs, and tool call IDs use per-runtime HMAC correlation values whose
random key is never written. Arguments and results use SHA-256 fingerprints of
redacted structural data plus bounded shape summaries. This allows correlation
inside one runtime without making a short secret easier to guess offline;
identifiers deliberately cannot be correlated across runs. Raw
prompts, model reasoning, streaming updates, tool output, secrets, and custom
instructions are never written.

The extension records session start/info changes, replacement and fork events,
compaction before/after, tree navigation, shutdown, and tool execution start/end.
Partial tool updates are intentionally omitted. A write failure is swallowed so
the receipt extension cannot block or change a Pi run; this also means a missing
or incomplete ledger is possible under disk/permission failure.

## Stability and limitations

`schemaVersion` is explicit and must be bumped for incompatible field changes.
The file is append-only from this module's perspective and writes are queued to
preserve event order within one runtime. Multiple processes/runtimes may each
produce a separate file; no cross-process locking or rotation is provided.
Hashes are correlation aids, not encryption: an observer can still infer event
timing, names, lengths, and shape metadata. The default path intentionally lives
under the user's Pi directory, so filesystem/device protection remains part of
the privacy boundary.

Pi 0.84 exposes tool execution and session lifecycle events, but it does not
provide this extension with a canonical aggregate decision from every approval
extension. A tool start is evidence that execution began; absence of a start is
not recorded as an explicit denial. Approval receipts therefore remain a future
integration seam rather than an inferred field.

## Validation

Run the dependency-free smoke test with:

```sh
node extensions/session-ledger/test.mjs
```

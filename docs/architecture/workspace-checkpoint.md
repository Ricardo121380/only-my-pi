# Workspace Checkpoint

`packages/workspace-checkpoint` is a small, Git-backed recovery primitive for
Pi 0.84 workflows. It is intentionally independent of Pi's native session
format and does not install hooks, run a model, or mutate a workspace while a
snapshot is being created.

## Snapshot format

Snapshots live under the repository's Git directory by default:

```text
.git/only-my-pi/checkpoints/<id>/
├── manifest.json
└── payload/
    └── tracked-and-untracked-files
```

The default location is outside the working tree, so a snapshot cannot be
accidentally committed. A custom `--store` path is supported for tests or an
explicit backup volume.

The manifest records only relative paths, file/symlink type, mode bits, sizes,
and SHA-256 content fingerprints. It does not store an absolute workspace path,
credentials, prompts, or model output. Non-ignored tracked and untracked files
are captured; ignored files are deliberately excluded. Symlinks are recorded
without following them, and links whose target escapes the workspace are
rejected.

## Safety model

Restore is a two-step operation:

1. `restore`/`undo` prints a plan by default;
2. `--run` is required to write anything.

If the current non-ignored workspace digest differs from the snapshot, a real
restore also requires `--force`. If restoring the snapshot would remove a file,
`--allow-delete` is required as a second explicit acknowledgement. Directory
deletion is never performed by this module. Parent paths are checked with
`lstat`; a symlink cannot be used as a write path or parent directory.

The digest guard is deliberately conservative. It can require a force restore
even when the user knows the changes are disposable. That is preferable to
silently overwriting unrelated work. The module does not promise atomic
multi-file restore: each individual regular file is written through a temporary
file and renamed, but a process interruption between files can leave a partial
restore. Keep the original workspace or a separate Git commit until the
operation has been inspected.

This is a workspace recovery aid, not an OS sandbox. Git, the Node process and
the filesystem still run with the invoking user's permissions. It should be
used together with a disposable worktree, container or VM for untrusted agent
tasks.

## CLI

```bash
# Capture a snapshot without changing the working tree.
node packages/workspace-checkpoint/cli.mjs snapshot --id before-turn

# Inspect or list snapshots.
node packages/workspace-checkpoint/cli.mjs list
node packages/workspace-checkpoint/cli.mjs inspect before-turn

# Preview a restore. This is the default and makes no changes.
node packages/workspace-checkpoint/cli.mjs restore before-turn

# Apply only after reviewing the plan and explicitly acknowledging changes.
node packages/workspace-checkpoint/cli.mjs restore before-turn --run --force --allow-delete

# `undo` is an intentionally explicit alias for `restore`.
node packages/workspace-checkpoint/cli.mjs undo before-turn
```

Use a new ID for every checkpoint. An existing ID is never overwritten.

## Current limitations

- Git is required; non-Git directories are rejected.
- Ignored files, empty directories and submodule contents are not captured.
- There is no cross-process lock, retention policy or automatic pruning.
- A symlink to an external path is rejected rather than copied.
- The manifest fingerprints content but does not encrypt it.
- Restore is not a transaction across multiple files.
- Pi integration is intentionally a later seam: a Pi extension can create a
  checkpoint at turn start and expose a reviewable command, but it must not
  silently restore or delete files.

## Validation

```bash
node packages/workspace-checkpoint/test.mjs
```

The tests create disposable Git repositories and cover tracked/untracked
capture, dry-run behavior, dirty-workspace refusal, explicit restore, symlink
escape rejection, manifest traversal rejection, and duplicate ID protection.

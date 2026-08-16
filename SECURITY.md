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

## Reporting a problem

Do not publish secrets or exploit details in a public issue. For a local
configuration or package concern, first disable the affected profile, preserve
the exact version and logs with secrets redacted, and open a private report to
the repository owner.

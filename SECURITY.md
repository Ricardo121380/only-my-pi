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

## Reporting a problem

Do not publish secrets or exploit details in a public issue. For a local
configuration or package concern, first disable the affected profile, preserve
the exact version and logs with secrets redacted, and open a private report to
the repository owner.

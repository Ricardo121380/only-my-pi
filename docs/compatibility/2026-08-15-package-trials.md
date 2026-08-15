# Package trial record — 2026-08-15

This record covers two deliberately narrow candidates. The checks used npm's
exact version and tarball integrity metadata, unpacked the tarball into a
temporary directory, inspected the manifest/source, and ran Pi's startup help
path with `-e`. No project `.pi/settings.json` or global package selection was
changed by the trial.

## `pi-terminal-theme@0.2.0`

Result: **PASS — safe to promote as the first theme owner after a visual check.**

- License: MIT; Node engine `>=20.0.0`.
- Contents: `themes/terminal.json` and `themes/terminal-tinted.json`, plus
  README and license.
- Manifest declares only `pi.themes`; no dependencies, peer dependencies, or
  lifecycle scripts were present.
- Integrity: `sha512-lAqHu1vqiWggOcBrSp6w/c8H3E1cPUjc4VBb/4FzCk4a/E9QGh8UAMngtVqinrABd/58ervWxn36S5TK8AsEOA==`.
- Startup check:

  ```text
  pi -e npm:pi-terminal-theme@0.2.0 --no-session --no-context-files --no-skills --help
  PASS (exit 0)
  ```

The package maps colors to the terminal's ANSI palette. The tinted variant
uses palette slots 16–23 and may be harsh on terminals that do not remap those
slots, so the first promotion should use the plain `terminal` theme. It should
remain the only active pure-theme package in a profile.

## `pi-simplify@0.2.3`

Result: **PASS — suitable for an opt-in review command; not yet a default.**

- License: MIT; Node engine `>=18`.
- Peer scope matches the installed Pi generation:
  `@earendil-works/pi-coding-agent`, `pi-ai`, and `pi-tui` `>=0.74.0`.
- The extension registers `/simplify`, calls Pi's argument-safe `git diff`
  execution, and sends a constrained follow-up prompt. The reviewed source
  contains no direct file-write API or shell string interpolation.
- It can still cause the model to edit files after the follow-up prompt, and
  it reads repository diffs. Use only with normal approval and a clean diff.
- Integrity: `sha512-9dxsXiGmO7DmjguC4Bk/lu7IYlYt0x1m2VneUpIGSQspx4BtshBgt+Vb8xvoxXc/Ugif7/sdwcbf7TgULqiSHg==`.
- Startup check:

  ```text
  pi -e npm:pi-simplify@0.2.3 --no-session --no-context-files --no-skills --help
  PASS (exit 0)
  ```

The package was not globally or project-installed. A real `/simplify` smoke
test requires a configured Provider/model and should happen in a disposable
worktree; promotion is blocked until that command is observed end-to-end.

## Decision

Keep both entries in `inventory/packages.lock.json` as `mode: "trial"`. Do not
stack a second renderer, footer takeover, memory system, or diff automation
package. Promotion requires a separate commit containing the selected profile,
the visual/functional smoke result, and a rollback command.

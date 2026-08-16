# Theme and status layer

M6 adds a deliberately small presentation layer. It does not replace Pi's
TUI, editor, footer, renderer, permission owner, or model runtime.

## Theme contract

Pi-native theme files remain under `themes/` and are loaded by Pi's existing
resource loader. The semantic, reviewable contract lives separately under
`contracts/themes/`; putting the contract beside the Pi theme would make Pi
try to load the contract as a theme. A contract binds:

- a canonical theme id and Pi theme name;
- a bounded set of semantic color tokens;
- a dark/light mode and a `safeDisable` action;
- recorded WCAG-style contrast checks with recomputed ratios;
- the repository-relative Pi theme path.

`ThemeRegistry` rejects absolute paths, traversal, symlinks, missing files,
unknown ids, missing Pi color fields, token drift, and stale contrast receipts.
`ThemeControlService` exposes read-only `list`, `show`, `preview`, and `doctor`
operations. `use` and `reset` first produce a plan; applying them requires an
explicit caller approval and the public Pi UI `setTheme` method. A headless
CLI has no UI driver and therefore returns `THEME_APPLY_UNAVAILABLE` instead
of pretending that a theme was changed. `reset` targets Pi's built-in `dark`
theme and is the safe-disable path.

The service only uses public Pi UI methods (`getAllThemes` and `setTheme`)
when running inside the extension. It does not patch private renderer or
editor state, and it does not install a second theme package.

## Status contract

`StatusService` turns injected observations into a bounded v1 projection with
`provenance: "injected-observations-only"`. It can report profile, mode,
provider/model identifiers, context budget, Git branch/dirtiness, permission
state, Swarm counts, and theme id. It deliberately excludes keys, tokens,
raw prompts, tool output, absolute host paths, and a whole-session sandbox
claim. Bash sandbox state is represented separately as `active`, `degraded`,
`unavailable`, or `unknown`.

The CLI uses the same service in headless mode and attaches the result under
`harnessStatus` while retaining the legacy `status` response field. The Pi
`/omp status` command does the same with live observations supplied by the
current session. Missing observations remain `null`/`unknown`; they are not
inferred from a Profile, Project Trust, or a prompt.

## Commands

```text
omp theme list
omp theme show <theme-id>
omp theme preview <theme-id>
omp theme doctor
omp theme use <theme-id>                 # plan only
omp theme use <theme-id> --apply --yes   # explicit UI mutation
omp theme reset                          # plan only
omp theme reset --apply --yes            # restore Pi's dark theme
omp status --json
```

The equivalent Pi commands are `/omp theme ...` and `/omp status`. Theme
mutation remains unavailable outside an interactive Pi session even when a
CLI caller supplies `--apply --yes`; this is intentional because the CLI has
no authoritative UI driver.

## Verification

`tests/theme-service.test.mjs`, `tests/status-service.test.mjs`, the CLI parser
tests, control-service tests, and runtime tests cover schema/contrast checks,
path containment, preview bounds, plan/confirm/apply behavior, public UI
driver use, reset, redaction, and headless operation. The theme contract is
also included in the repository schema catalog and the packaged-resource
allowlist.

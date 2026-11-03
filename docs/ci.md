# Development CI

The current [native Pi → WebUI roadmap](plans/2026-10-25-pi-native-client-reset.md)
uses scoped development checks on `main` and `codex/dev/pi-native-web`.
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pushes and pull
requests to those branches. A manual dispatch requests every development lane.
Node remains pinned to **24.19.0**, and Pi remains pinned by the existing locks.

## Change routing

| Change | Required work |
| --- | --- |
| Root documentation and Markdown/images under `docs/` | Documentation contracts, local links, source syntax/conflict checks. No dependency installation or native suite. |
| `webui/**` | Documentation, shared static checks, UI tests/builds and core Web/session regressions. The native branch also builds the minimal entry. |
| A Node regression test | Its owning Web/Host or CLI lane, plus documentation and shared static checks. |
| Shared runtime, dependency locks, executable resources, CI tooling or an unknown path | Documentation, shared static checks, Web/Host, CLI and installation checks. |

Runtime Markdown under `skills/`, `prompts/`, `agents/` and `modes/` is executable
input and selects runtime checks. Renames are examined as deletion plus addition.
A new branch or manual run selects every lane. A failed diff computation fails the
scope job. The stable required check, **CI required**, accepts only success from
every selected lane and an explicit skip from every unselected lane. Failure,
cancellation, missing results and unexpected skips block merging.

The complete source diff is used for PRs and the actual before/after diff for
pushes. Checkout uses the PR merge revision so tests also exercise integration
with the current base. Branch protection retains strict up-to-date checking and
administrator enforcement while using `CI required` as the aggregate gate.

## Regression ownership and duplicate removal

[`scripts/ci-plan.mjs`](../scripts/ci-plan.mjs) discovers tracked Node test files,
including package and extension tests outside `tests/`. Documentation contracts
run in the docs lane. Core Host accounts, authorization, lifecycle and history, minimal native-session,
persistent dev-Web and browser identity tests run in the Web lane. Historical
MCP, images, classification, codemode, manual-terminal and full input-module
regressions run with the CLI compatibility lane. Remaining Node tests also enter
that lane. The minimal service and dev-Web launcher select the Web lane; shared
runtime changes select both.
New unclassified tests enter that remainder rather than disappearing.
[`tests/ci-plan.test.mjs`](../tests/ci-plan.test.mjs) checks that the three lanes
cover the inventory exactly once, including files exercised by focused coverage.

[`scripts/ci-run.mjs`](../scripts/ci-run.mjs) retains these distinct checks:

- Shared static: type checking, schemas, package contents and secret scan.
- Web: Vitest UI tests, the available minimal build, the full Web build, and
  actual Pi/Host regressions using local controlled models.
- CLI: all remaining Node tests, package/profile/mode/topology doctors, generated
  agent resources, and the original focused coverage thresholds: session composer
  **90/80/90**, omp-control **85/70/85**, direct agent **90/80/90**
  (lines/branches/functions). Those focused files are excluded from the ordinary
  CLI pass to avoid executing them twice.
- Installation: the two frozen receipt checks, public-baseline history/authority
  inspection, separate minimal and daily fresh-tarball smoke, and macOS arm64
  **M11 Q10 clean-home**. Linux distribution/sandbox checks retain their existing
  separate workflow and platform scope.

The old chain ran the root suite five times: v1 `full-tests`, inherited subagents
v2, M8 D15 global coverage, M9 U8, and M12 C10 global coverage. Normal development
CI now executes the partitioned Node inventory once. Original manifest files,
versioned acceptance runners, historical receipts and protected evidence remain
at their original paths; a development report is not a replacement release receipt.

The original whole-repository coverage threshold **85/69/85** remains available
through the manual [Historical global coverage workflow](../.github/workflows/coverage.yml)
and `node scripts/ci-run.mjs coverage`. It executes the global coverage check once,
using its original 30-minute budget and threshold values. It is an explicit
historical acceptance exercise, outside ordinary PR routing. Full versioned
milestone or release acceptance still follows that milestone's manifest and
authorization requirements.

## Running checks and reading results

```bash
# Documentation: no npm installation needed.
node scripts/ci-run.mjs docs

# Runtime: use the pinned Node, then the affected lanes.
npm ci --ignore-scripts --no-audit --no-fund
npm run test:prepare
node scripts/ci-run.mjs static
node scripts/ci-run.mjs web
node scripts/ci-run.mjs cli
```

Native regression jobs run on macOS because controlled stdio MCP requires
Seatbelt. Preparation installs locked, isolated extension fixtures and prepares
the pinned PTY binding. It uses distinct empty npm user/global config files.
No developer Pi configuration or Provider credentials are supplied. Q10 can fetch
locked Node/npm assets; it does not make model requests or publish a release.

Each Node file has its own start/end record and bounded failure diagnostic. Test
files run with the existing concurrency of two; individual test deadlines and
assertions remain intact. Existing command timeouts are read from the original
manifests (including the distinct 5-minute minimal and daily smoke budgets). A lane retains the former 30-minute execution budget.
After a failure it stops scheduling more work, records unfinished checks as
`NOT_RUN`, and fails. Preparation failures also fail the job. GitHub retains the
job log; `always()` uploads the available scoped JSON reports for 14 days,
including partial reports on interruption. Reports contain source identity,
timings, exit/signal/timeout state, output hashes and bounded diagnostics. Raw
assertion values and model output are not stored in these reports.

## Preserved failures

These records remain failures for their original candidates. CI reorganization
does not establish their root causes or change them to passes.

| Candidate and run | Observed result | Remaining uncertainty |
| --- | --- | --- |
| PR #96, `7d2392b28b299614417aea14b7192f7e4fc49f16`, [run 41573257725](https://github.com/Ricardo121380/only-my-pi/actions/runs/41573257725) | M8 D15 failed after 1,802,027 ms; `timedOut=true`, `signal=SIGTERM`, output limit not exceeded. Q10 skipped. | The bounded summary named the HTTP secret restart/non-replay test and subsequent file failures. No raw child log artifact exists, so per-test cause and time attribution remain unknown. |
| Old main, `e714c89a68c03e3fa42031aa5c1d0590f5cc60ab`, [run 39733201211](https://github.com/Ricardo121380/only-my-pi/actions/runs/39733201211) | M8 D15 failed after 1,802,030 ms; timeout/SIGTERM. Its summary named the HTTP disconnect restart/non-replay scenario. | This is a separate historical failure, not proof that the same test or defect caused both runs. |
| #80 / PR #90, `737b2abb75f9cdbda56ecf6166da8d52f582b657`, [run 39915720380](https://github.com/Ricardo121380/only-my-pi/actions/runs/39915720380) | `full-tests` failed on the Host coding-revoke lifecycle scenario with a 20,000 ms test deadline; Q10 skipped. | The original stopped batch remains open. Its deadline and assertions are preserved. This CI change does not close #80 or merge PR #90. |

The HTTP scenarios remain in `tests/host-mcp-http.test.mjs` in the CLI/legacy
integration lane; the revoke scenario remains in `tests/host-pi110-runtime.test.mjs`
in the core Web/session lane. Shared changes continue to require both.
Controlled local or CI results apply to their exact source and environment;
Provider, browser, daily-install and public-release qualification remain separate.

### CI migration diagnostics, 2026-11-03

- The first scoped PR run, [41584930855](https://github.com/Ricardo121380/only-my-pi/actions/runs/41584930855),
  recorded daily smoke exiting with code 0 but failing the executor's evidence
  expectation. The new adapter had incorrectly reused the minimal `test-e2e`
  identity, whose receipt requires `bootstrap.doctor=PASS`; daily smoke correctly
  reports `CONTROLLED_STACK_REQUIRED`. The adapter now preserves daily's original
  **D12** identity and budget. A regression covers both mappings. Q10's log pipe
  explicitly uses Bash with pipefail so a failed command cannot be hidden by tee.
- The first development-branch run, [41585117199](https://github.com/Ricardo121380/only-my-pi/actions/runs/41585117199),
  recorded direct-agent branch coverage **79.49% < 80%**. Its old focused suite
  lacked minimal-launcher option/extension assertions. The development branch
  adds checks for TUI/print/RPC admission, optional-tool exclusion, explicit
  extension ownership and unsupported utility/Host combinations. The original
  coverage threshold remains unchanged; the focused local check then passed.

- The same development-branch run also failed the persistent dev-Web test while
  waiting for `shell.pid` after approval (`tests/dev-web.test.mjs:81`). The local
  controlled run had passed. A diagnostic follow-up,
  [41585994874](https://github.com/Ricardo121380/only-my-pi/actions/runs/41585994874),
  confirmed the task was running with coding access and another approval pending.
  The test now answers the expected bash prompt with **Allow once**, after checking
  its kind/title and limiting the answer to one per synthetic shell task. It
  retains the original deadlines and process-cleanup assertions. This does not
  certify sandbox availability on the CI host.

These first-run failures and their scoped artifacts remain available alongside
subsequent candidates. A corrected CI adapter or focused local pass does not
retroactively qualify an earlier whole run.

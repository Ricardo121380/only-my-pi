# B2 native Pi/Host integration — 2026-11-04

This is local controlled integration evidence. The native Pi worker executes
real tools and stores real Pi JSONL history; model responses come from the
deterministic loopback fixture. No personal Provider credentials were imported.

## Source and runtime

- Native source base: `7af5b1958ab7e20ded3b6bbcd1ef6e37a800b238`
  (`codex/dev/pi-native-web`).
- Selected prototype: `7a5e8fcacd675ce1168cde2539ea6d525cee107f`
  (`claude/design/b2-prototypes`), applied as `455f02e2472a377fe76abd299cdbf260bc751477`.
- Integration: `5468b3284a6afb51dabcf46e1239c6e8b119064a`, local branch
  `codex/feat/b2-native-host`.
- Source tree: `c4055b9a8982691da98ba7e8385d46c11356c54d`. Checks ran on
  the staged candidate before commit; the committed tree was compared afterward.
  This record is a subsequent documentation change.
- macOS arm64, Node **24.19.0**, Pi **1.3.0**. B2 retains its locked
  React/ReactDOM **19.3.1**, Vite **8.3.5** and TypeScript **7.0.2**.
  The existing frontend retains its separate React installation and test config.

| SHA-256 input | Digest |
| --- | --- |
| `package-lock.json` | `5e073aa01af1b9414818cb2e2026d406b636aade46868e12b6a9ba27e8d893a1` |
| `prototypes/package-lock.json` | `3038c65d77c54b6af316eb72885de493c7c7d671c0d42c682f53a7b8319a817f` |
| `contracts/release/external/package-lock.json` | `ffc69af00fa5be9d242d4593b3bb72f2e5d298eef32566337fe0b3db14552fb8` |
| Node binary | `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1` |
| `tests/fixtures/minimal-model.mjs` | `56e3c0aaca2d2d6d45ede6f1beda9f4b6aa006b31523731c64d24dabbabb7c3a` |

The root and release external locks did not change. The prototype lock only adds
the existing Testing Library versions and their test dependencies; existing
package records keep their versions and contents.

## Core journey

Ego Lite operated one task space against built B2 assets and the real minimal
Host. The final screenshot was captured at 1440 × 1000. The owned browser space
was closed and the development Host stopped with `workers: 0`; fixture data and
diagnostics were retained outside the source checkout.

| Path | Observed result |
| --- | --- |
| Project selection | Add an existing absolute directory; selected project and history come from Host. |
| Session/model | Explicit CLI-reference account and fixture model selection precede sending. |
| Stream | Partial reply and stop control appear while the real Pi task is active. |
| Tool receipt | Pi reads the project README; expanding history output retrieves `minimal-web-evidence`. |
| Approval | `approved.txt` is absent before approval, then contains `approved local write\n`; button values and scope come from runtime. Explicit `Deny` keeps inspect access and never runs write. |
| Failed tool | Read-only `deny write` preserves an error receipt and never creates `forbidden.txt`. A denial returned as `CODING_ACCESS_DENIED` remains the runtime's successful permission-tool result rather than being reclassified as a tool exception. |
| Stop | UI first reports cancelling, then cancelled after Host confirmation. Controlled tests also verify the model stream closes and workers exit. |
| History/resume | Refresh adds no task. Continuing is explicit and preserves the Pi session ID. A fresh Host process on the same port rejects the old cookie with 401; new pairing restores project/history without automatic execution. Explicit continuation uses the same session with inspect access. |

Day/night appearance, command search, Shift+Enter, controlled composition events,
and the 1180/720/390 px breakpoints were exercised. At 1180 px the sidebar was
56 px; at 720 px the workspace defaulted closed; 390 px mobile navigation opened
and closed with focus restored to its visible trigger. These layouts had no
document-level horizontal overflow. Composition-event coverage establishes the
send guard; it is not an operating-system IME qualification.

## Automated results

| Check | Result |
| --- | --- |
| Clean `npm ci --prefix prototypes --ignore-scripts --no-audit --no-fund` | PASS; 406 packages, pinned lock |
| `npm run test:web:b2` | PASS; 7 tests, including both slow-network regressions |
| `npm run test:web` | PASS; 99 tests in 17 files |
| Native/development/notice group below | PASS; 6 tests |
| `npm run typecheck` | PASS; all four existing TypeScript checks |
| `build:web:minimal`, `build:web`, `build:web:b2` | PASS; builds run with separate outputs/sequential shared output |
| Documentation CI lane | PASS; lint and all selected documentation/CI contracts |
| `schema:check`, `pack:check`, `secret:scan` | PASS; no findings |

The native group is:

```sh
node --test --test-concurrency=2 tests/b2-native-web.test.mjs \
  tests/dev-web.test.mjs tests/host-minimal-web.test.mjs \
  webui/dependency-notices.test.mjs
```

Two static-review findings were reproduced before repair: a request accepted by
manual lookup could leave its original POST blocking a new conversation and
clearing its draft; a delayed cancellation response could block stopping another
project's task. Both initially failed their new tests, then passed after request
IDs and task IDs scoped the in-flight state. The RED logs were retained.

Earlier integration diagnostics also retain the duplicate-React failure,
missing package license failure, and test-harness corrections for actual Host
202 responses, denied JSON/text asset serving, and permission-denial semantics.
The license fix uses an exact version/SPDX supplement with a fixed upstream
source, documented in [notice provenance](../../prototypes/notices/README.md).
Negative tests confirm a different package, version or SPDX still fails closed.

## Scope and retained evidence

Local logs/screenshots are in the sibling `checks/` directory of this isolated
checkout. `b2-slow-network-reproduced-red.log` retains the two REDs;
`b2-ui-clean-install-final.log`, `b2-native-final.log`, `b2-original-ui-final.log`,
the final build/static logs and `b2-docs-final.json` retain the results above.
`b2-native-host.png`, `b2-approval.png` and `b2-mobile.png` retain rendered states.
Pairing material stays in a separate private file and is excluded from this
record and Git.

This change does not establish remote CI, real Provider, packaged release,
Electron or sustained-use qualification. It does not close historical #80/PR #90
or replace their RED evidence. Workspace tabs retain the B2 design and render
actual tool receipts; independent plan artifacts, file browsing/diff application,
free terminals, steer/queue and prototype account CRUD are outside this slice.
See [startup and current capabilities](../minimal-webui.md#b2-frontend-with-the-native-pi-host).

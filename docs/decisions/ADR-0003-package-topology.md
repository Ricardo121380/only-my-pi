# ADR-0003: Separate the Pi host, governed packages, and first-party resources

## Status

Accepted — 2026-08-16

## Context

`only-my-pi` is a Pi distribution and governance layer. It needs Pi types during
development, explicit validator dependencies at runtime, reproducible package
sources, and an auditable inventory of its own resources. Those needs do not
justify bundling another copy of the Pi host, importing private files from a Pi
package, or treating a static declaration as proof that a capability is active
in a running session.

The earlier inventory pinned npm versions but did not require integrity for
promoted entries. Profiles listed packages and policy independently, which let
the `research` Profile claim enabled subagents without selecting the
`pi-subagents` package. First-party extensions and contract seeds were also not
represented in the same machine-readable topology.

## Decision

### Host and dependency topology

Pi remains the only agent loop, Provider, session, built-in tool, extension, and
TUI host:

- `@earendil-works/pi-coding-agent` is a wildcard `peerDependency`, so the Pi
  host supplies the runtime instance;
- the same package is an exact `devDependency` for deterministic typecheck and
  CI, without making it an only-my-pi runtime dependency;
- AJV, AJV formats, semver, and SRI validation are explicit, exact direct
  dependencies; TypeScript is an exact development dependency;
- `package-lock.json` is the reproducible development/install graph.

The static doctor rejects a bundled Pi host, missing direct tooling dependency,
or non-exact direct/development dependency. This topology is a packaging
contract; it does not prove that a particular user's Pi runtime is compatible.
That remains live-doctor evidence.

### Governed package sources

Inventory source forms are deliberately narrow:

1. npm sources use `npm:<name>@<exact-canonical-semver>`;
2. Git sources use an explicit `git+https` or `git+ssh` URL ending in a full,
   lowercase 40-character commit SHA;
3. tags, branches, semver ranges, registry aliases, implicit GitHub shorthand,
   embedded credentials, query parameters, and short SHAs fail closed;
4. every promoted npm entry records one canonical `sha512` SRI value in its
   audit record;
5. candidates may omit SRI while unpromoted, but any recorded value must still
   be valid.

The current SRI values record registry metadata audited on 2026-08-16. The M1
doctor validates the source and SRI declarations without fetching or installing
anything. Byte-for-byte tarball verification belongs to scripts-disabled M2
staging; an SRI string in inventory alone is not evidence that installed bytes
were verified.

### First-party resource topology

`inventory/resources.lock.json` is the first-party resource registry. It covers:

- the default-loaded `session-ledger` and `context-doctor` extensions;
- the package's skill, prompt, and theme discovery roots;
- the M1 inspect mode, scout agent, single-agent-safe workflow, and
  research-synthesis recipe contract seeds;
- the existing DeepSeek conformance, ACP v1, and workspace-checkpoint Labs.

The scout's canonical JSON, owned prompt, and generated upstream Markdown are
one logical agent resource. The doctor checks that the canonical prompt and
generated Markdown both exist; it does not count the generated file as a second
agent owner.

M1 mode/agent/workflow/recipe seeds are `planned`, `contract-only`, packaged,
and not default-loaded. Labs are non-default and excluded from the published
package. Empty discovery roots describe package layout, not a claim that a
concrete skill, prompt, or theme has been delivered.

### Capability, Profile, and owner consistency

Capabilities name their providers, affected enforcement surfaces, risk, and
whether runtime evidence is required. Owners, public command names, and each
enforcement surface are separate versioned catalogs. Static checks require:

- one owner for every capability and enforcement surface;
- no unknown package, resource, capability, owner, command, or surface
  reference;
- no duplicate public command or alias on one surface;
- an exact match between a Profile's active providers and capability ceiling;
- policy/package/capability agreement for subagents, Web, memory, and MCP;
- every resource's eligible Profiles to contain its required capabilities.

`workspace-read` is an explicit capability provided by the upstream
`pi-host-runtime`; it is not attributed to a first-party extension. Every
current Profile includes it in its load-time ceiling, while runtime availability
still requires evidence.

The `research` Profile is intentionally single-agent and selects Web access with
an allowlisted network policy. The separate `orchestration` Profile explicitly
selects `pi-subagents`, `subagent-runtime`, and `subagent-rpc-v1`. This removes
the previous subagent declaration mismatch without silently widening daily
coding or research.

### Unique runtime ownership

`pi-subagents` remains a separately loaded, exact-version package and the sole
owner of physical child dispatch, process lifecycle, concurrency, worktrees,
stop/resume, and the public `subagent` tool. only-my-pi reserves no competing
tool and will not bundle a second extension runtime.

A future live adapter may use only a versioned, capability-negotiated extension
RPC wire. It must not statically import across package roots, import unexported
`src/**`, simulate another package's command input, or use exported delegation
types as a hidden runtime path. The M1 RPC documents and generated agent are
contract fixtures, not evidence that M5 dispatch has been delivered.

`pi-permission-modes` remains the unique selected permission owner. When its
`@anthropic-ai/sandbox-runtime` boundary is ready, it can provide conditional OS
isolation for the Bash subprocess it replaces. Its explicit degraded prompt
fallback is not an OS sandbox. Neither state proves file-tool, Web, MCP,
Provider, arbitrary extension, or whole-session isolation. Those surfaces keep
independent owners and `active | degraded | unavailable | unknown` state.

### Evidence and machine boundaries

M1 catalogs are static declarations. `runtimeEvidenceRequired: true`, planned
resource lifecycle, reserved command status, and the doctor's
`runtimeEvidence: not-evaluated` result prevent them from being presented as
live delivery. The static lane performs no network request, package install,
credential read, real Provider call, global install, or real `~/.pi` mutation.

## Consequences

- A Profile cannot be considered consistent merely because its JSON parses.
  Package, first-party resource, capability, owner, command, enforcement, and
  policy references must agree.
- Adding or promoting a package requires exact source identity and, for npm,
  audited SRI before it can enter an active Profile.
- Adding a first-party runtime resource requires an inventory entry, owner,
  package allowlist coverage, capability relationships, and eventual live
  evidence.
- Research stays lightweight by default; users opt into the broader child
  runtime through the orchestration Profile.
- Future bootstrap and runtime work can consume these catalogs, but must not
  reinterpret M1 declarations as an installed-byte or live-enforcement PASS.

## Rejected alternatives

- Bundling Pi as an ordinary runtime dependency.
- Allowing `latest`, semver ranges, Git branches, short SHAs, or source URLs with
  embedded credentials.
- Treating a registry SRI string as proof that installed bytes already match.
- Enabling subagents in `research` without selecting their sole runtime owner.
- Implementing a second subagent scheduler or public `subagent` tool.
- Importing `pi-subagents/src/**` or `pi-permission-modes/src/**`.
- Counting canonical and generated scout files as two independent agent owners.
- Calling a conditional Bash sandbox, prompt fallback, Project Trust decision,
  or tool visibility change whole-session isolation.

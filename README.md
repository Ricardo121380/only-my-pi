# only-my-pi

**English** | [简体中文](README.zh-CN.md)

**Inspect first. Code with approval.**

only-my-pi (OMP) is a terminal coding agent built on [Pi](https://github.com/earendil-works/pi), distributed through Homebrew and npm. Run `omp` in a project to inspect code, investigate problems, and make project-local changes after explicit approval.

Pi provides the terminal UI, models, sessions, and core tools. OMP adds coding approvals, budgeted subagent collaboration, and verifiable installation and rollback.

> **Published Preview: [v0.4.0-preview.1](https://github.com/Ricardo121380/only-my-pi/releases/tag/v0.4.0-preview.1)**<br>
> Managed installation supports **macOS 14+ on native Apple Silicon (arm64)** only. Bring your own model access and provider account.

[Quick start](#quick-start) · [Daily use](#daily-use-and-approvals) · [Troubleshooting](#troubleshooting) · [Security](#security-and-license)

## What you get

| What you need | How OMP handles it |
| --- | --- |
| Understand the scope before editing | New processes start in read-only `Inspect`; complex tasks need a plan, and coding requires approval. |
| Preserve work already in progress | Records the Git baseline and dirty paths; overlapping writer tasks stay with the main agent in the original worktree. |
| Collaborate within limits | Uses read-only specialists, one writer, and a fresh-context reviewer as needed, with concurrency and cumulative usage limits. |
| Check delegated changes before integration | Runs project checks in the clone, requires review and patch checks, then verifies again in the real worktree. |
| Manage installation ownership explicitly | Homebrew/npm own program files; OMP reports the actual channel/version, preserves user data, and migrates owned legacy command links. |

You do not need to choose a Workflow, Swarm, Goal, or Ultra to do everyday work. **These controls are not an OS sandbox.** See [security boundaries](#security-and-license).

## Quick start

<a id="platform-and-runtime"></a>

Supports **macOS 14+ on native Apple Silicon (arm64)**. This release does not support Intel Mac, Rosetta, native Windows, Linux or Docker. Bring your own model access. The packaged Pi version is **0.84.3**.

<a id="installation"></a>

### 1. Install with Homebrew or npm

**Homebrew** supplies Node 24 and Git:

```bash
brew install ricardo121380/tap/only-my-pi
omp --version
```

**npm** reuses your existing **Node >=22.19.0** and requires Git on PATH. Prepare both before installing:

```bash
node --version
git --version
npm install -g only-my-pi@0.4.0-preview.1
omp --version
```

For an ephemeral run with the same prerequisites:

```bash
npx only-my-pi@0.4.0-preview.1
```

These commands install the accepted **0.4.0-preview.1 Public Preview**. npm `preview` also points to this version. Promotion of npm `latest` is pending account-owner 2FA; use the explicit version above until default-entry acceptance is complete.

All channels use the same prebuilt core with audited extensions, fd and ripgrep. npm platform packages do not bundle Node. Startup does not download missing runtime dependencies. Only `omp` is registered globally; existing `pi` commands are preserved.

<a id="first-run-and-model-setup"></a>

### 2. Configure your model and open a project

```bash
omp admin doctor --json
omp admin pi
```

Use Pi's `/login` or its provider configuration for model access. `omp admin pi` runs the packaged raw Pi for login and advanced configuration. Exit it, then:

```bash
cd /path/to/project
omp
```

Confirm Project Trust for the intended project and choose an authenticated model, or use `omp --model provider/model-id`. Each new interactive process starts in Inspect and requires coding approval before writing. Program installation does not include a model subscription or provider credits.

Existing credentials, preferences and sessions remain in the existing Pi directories (by default `~/.pi/agent/`). For offline or manual installation, see [advanced installation](#advanced-installation).

## Daily use and approvals

```bash
omp                                      # Start an interactive session
omp "inspect the failing login test; do not edit yet"  # Start with a task
omp -c                                   # Continue the latest Pi session
omp -r                                   # Choose a session to resume
omp --model provider/model-id             # Select a model explicitly
omp -p "review error handling" --model provider/model-id  # Headless, read-only
omp -- "status"                          # Treat a management word as a task
```

Describe the outcome directly: “Fix this test; explain the scope and verification before editing.” For a full plan, enter `/plan add input validation and regression tests to the login module`.

| Command or key | Purpose |
| --- | --- |
| `/plan <task>` | Plan read-only, then request coding approval. |
| `/access` / `/access revoke` | Show access or revoke it and return to `Inspect`. |
| `/agents` | Show child work and cumulative budget usage. |
| `/model` | Change the model. |
| `Esc` | Interrupt current work and propagate cancellation to children. |
| `/exit` / `Ctrl+D` | Exit; `Ctrl+D` requires an empty input editor. |

**A grant covers the current project and interactive process.** Later work within that grant can reuse it. `-c` and `-r` restore conversation history, not coding authority; a new process needs new approval. Public Web research requires separate approval for that research task, even when coding is already authorized.

`-p` / `--print` exposes only read/search tools: no Bash, managed writer, or interactive Web approval. Specify a model explicitly when no usable recent model is available.

## Managed writers and project verification

Simple changes stay with the main agent. Complex work can use **one writer in a managed Git clone**, with `pi-subagents` creating the actual child process. Delegated readers, writers, and reviewers inherit the main agent's model and thinking level.

The clone starts from the approved Git HEAD and **does not contain uncommitted changes**. When the requested scope overlaps dirty paths, OMP returns `MAIN_AGENT_FALLBACK_DIRTY_OVERLAP` and keeps the work with the main agent in place. Do not discard existing changes just to enable a writer.

Writer integration follows: **project checks in the clone → fresh-context review → base, scope, and patch checks → integration → verification in the real worktree**. A missing manifest, failed checks or review, drift, or conflicts block integration and retain the patch for inspection.

<details>
<summary>Configure writer verification: .pi/only-my-pi-gates.json</summary>

Automatic integration requires the trusted project and clone to have the same gate manifest at the approved HEAD. Create and commit `.pi/only-my-pi-gates.json` before delegating a writer. This is not required for ordinary read-only use.

This example assumes a Node project with an existing `npm test` script. Replace it with checks that work for your project:

```json
{
  "$schema": "https://raw.githubusercontent.com/Ricardo121380/only-my-pi/v0.4.0-preview.1/schemas/project-gates-v1.schema.json",
  "formatVersion": 1,
  "id": "project-checks",
  "gates": [
    {
      "id": "unit-tests",
      "description": "Run the project's unit tests",
      "command": "npm",
      "args": [
        "test"
      ],
      "cwd": ".",
      "timeoutSeconds": 900,
      "env": {
        "CI": "1"
      }
    }
  ]
}
```

Before execution, OMP shows the resolved executable, arguments, working directory, environment, and timeout for confirmation. It does not execute a model's free-form verification text. **The process allowlist and scrubbed environment do not provide filesystem or network isolation.**

See the [gate manifest schema](schemas/project-gates-v1.schema.json) and [runtime verification implementation](packages/direct-agent/writer-verification.mjs).

</details>

## Configuration and child budgets

Global preferences live in `~/.pi/agent/only-my-pi/preferences.json`; trusted projects can supply `.pi/only-my-pi.json`. Project configuration may narrow capabilities and budgets, not expand the active authority. Restart OMP after changing execution-related preferences.

Each process defaults to at most **2 concurrent children, 8 children in total, and 1 managed writer**. Child budgets exclude main-agent usage and **are not exact provider billing caps**.

<details>
<summary>Default limits and a project configuration example</summary>

| Limit | Default |
| --- | --- |
| Delegation depth | `1`; set `0` to disable children |
| Cumulative reported tokens / cost | `50,000` / `$0.25` |
| Shared wall-time window | `1,800` seconds, starting with the first child admission |
| Turns / tool calls per child | `8` / `16`; roles may have lower ceilings |
| Total tool calls | `64` |
| Returned result bytes per child / total | `65,536` / `262,144` |

For example, lower the project's child budget in `.pi/only-my-pi.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/Ricardo121380/only-my-pi/v0.3.0-preview.1/schemas/preferences-v1.schema.json",
  "formatVersion": 1,
  "budgets": {
    "daily": {
      "maxConcurrency": 2,
      "maxChildren": 4,
      "maxDepth": 1,
      "maxTotalTokens": 20000,
      "maxWallSeconds": 900
    }
  }
}
```

Applicable budgets are combined by taking the lowest limit and accumulate within one process; the `daily` key does not mean a calendar-day billing allowance. Completed and failed work both count. Exhaustion, invalid usage, or unproven cancellation stops further delegation and writer integration. Usage reports may arrive late. Byte limits cover returned results, not all private logs.

See the [preference schema](schemas/preferences-v1.schema.json) and [configuration implementation](packages/daily-config/index.mjs).

</details>

<a id="updates-rollback-and-removal"></a>

## Manage your installation

```bash
omp admin version --json
omp admin doctor --json
```

These report the actual version, channel, platform, Node/Pi and PATH entries. A ready runtime and an unconfigured model are different conditions. Doctor detects old entries shadowing a newer installation.

| Channel | Upgrade | Remove program files |
| --- | --- | --- |
| Homebrew | `brew upgrade ricardo121380/tap/only-my-pi` | `brew uninstall only-my-pi` |
| npm | `npm install -g only-my-pi@0.4.0-preview.1` | `npm uninstall -g only-my-pi` |
| npx | Start a new `npx only-my-pi@0.4.0-preview.1` run | npm owns the cache |
| Full/Thin archive | Install a verified release into a new directory | Remove only the explicitly selected OMP program directory after exiting it |

Uninstalling the program preserves user credentials, preferences and sessions. OMP does not modify another package manager's program files or an existing Pi third-party package tree. For rollback, select a previously verified version/directory; do not retarget or overwrite a running installation.

### Migrate an old OMP command link

Invoke the new **persistent npm or Homebrew** entry by its full path if the old `omp` shadows it, then:

```bash
/path/to/new/omp admin migrate --from legacy --plan --json
/path/to/new/omp admin migrate --from legacy --apply --yes --json
hash -r
omp admin doctor --json
```

Migration verifies the new entry and old ownership record, then backs up only a confirmed old OMP link. It does not delete unknown files, raw Pi, old stacks or user data. npx is not a persistent migration target. Keep incomplete migration receipts and backups for reconciliation.

## Troubleshooting

| Symptom or error | What to do |
| --- | --- |
| `SYSTEM_DEPENDENCIES_MISSING` / unavailable Git | Prepare Git before npm/npx installation; Homebrew users should check dependencies and PATH. The verifier does not launch the macOS developer-tools installer. |
| `PATH_ACTION_REQUIRED` / `SHIM_CONFLICT` | Check command paths and existing files; do not overwrite an unknown command. |
| `NO_AUTHENTICATED_MODELS` / `MODEL_AUTH_UNAVAILABLE` / `HEADLESS_MODEL_REQUIRED` | Configure authentication through Pi, then select a usable model explicitly. |
| `CODING_ACCESS_REQUIRED` / `COMPLEX_PLAN_REQUIRED` | Inspect first and approve the coding plan required for this process. |
| `MAIN_AGENT_FALLBACK_DIRTY_OVERLAP` | Preserve existing changes and let the main agent handle the overlapping scope. |
| `WRITER_GATE_MANIFEST_REQUIRED` / `WRITER_GATE_MANIFEST_DRIFT` | Check that the manifest is committed at the approved HEAD and matches. |
| `WRITER_REVIEW_BLOCKED` / failed checks | Inspect the retained patch and findings; do not bypass integration checks. |
| `DIRECT_CHILD_BUDGET_EXHAUSTED` | Review `/agents`; this process cannot delegate more work or integrate a writer. |
| `OMP_CONTROLLED_STACK_UNAVAILABLE` / `M12_UPDATE_REQUIRED` | Inspect the version and diagnostics; recover with a verified bundle, not manual link changes. |
| `MANUAL_RECONCILIATION_REQUIRED` / integrity conflict | Preserve errors, journals, and backups; reconcile the reported conflict before retrying. |

For a [non-sensitive bug report](https://github.com/Ricardo121380/only-my-pi/issues), include the exact version, platform, redacted error code, and a minimal reproduction. Do not upload credentials, raw sessions, or private source.

<a id="advanced-installation"></a>
<a id="verify-release-assets"></a>
<a id="release-process-and-evidence"></a>

## Advanced installation: Full/Thin, offline and rollback

Homebrew/npm are the primary entry points. Full/Thin are manual, offline and recovery fallbacks sharing the same core identity. Full includes Node 24.19.0 and installs offline after download and verification. Thin retrieves only pinned Node 24.19.0 during installation. Both require preinstalled Git. Offline installation does not provide offline model inference.

Download the desired archive from the GitHub Release and verify its provenance first. This example uses Full (replace full with thin in the filename to verify Thin):

```bash
gh release download v0.4.0-preview.1 --repo Ricardo121380/only-my-pi \
  --pattern only-my-pi-0.4.0-preview.1-darwin-arm64-full.tar.gz
gh attestation verify only-my-pi-0.4.0-preview.1-darwin-arm64-full.tar.gz \
  --repo Ricardo121380/only-my-pi \
  --source-digest 38e71adc8c2c52cc332db288f5dcdd14f73bd8cb \
  --signer-digest 38e71adc8c2c52cc332db288f5dcdd14f73bd8cb \
  --source-ref refs/heads/main \
  --signer-workflow Ricardo121380/only-my-pi/.github/workflows/distribution-candidate.yml \
  --deny-self-hosted-runners
```

Only after verification succeeds, extract into a fresh working directory and choose a new, nonexistent program prefix:

```bash
tar -xzf only-my-pi-0.4.0-preview.1-darwin-arm64-full.tar.gz
./only-my-pi/install.sh --prefix /absolute/new/omp-directory
/absolute/new/omp-directory/bin/omp
```

The new installer refuses an existing prefix and does not add global links. Upgrade into another new directory; roll back by using the previous directory command. `build-receipt.json` records artifact SHA-256 and source identity. The new distribution manifest does not reinterpret historical stack manifests.


<details>
<summary>Legacy 0.3.0-preview.1 installation and recovery reference (old stacks only)</summary>

### Quick start


#### 1. Check your environment

This Preview does not support managed installation on Intel Macs, Rosetta, Linux, or Windows. The managed stack uses **Node.js 24.19.0** and **Pi 0.84.3**. The bootstrap installer supplies the runtime, so no system Node or npm is needed. Managed writers require Git. The installer uses the macOS tools `curl`, `shasum`, `tar`, `awk`, and `mktemp`.


#### 2. Verify the installer and preview the plan

Run as your normal user, without `sudo`. Download the pinned installer and verify its SHA-256 checksum. This checksum applies **only to 0.3.0-preview.1**:

```bash
mkdir -p only-my-pi-preview &&
cd only-my-pi-preview &&
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  https://github.com/Ricardo121380/only-my-pi/releases/download/v0.3.0-preview.1/install.sh \
  --output install.sh &&
printf '%s  install.sh\n' \
  '542dbcb468221841b460199c41afa9af1d178e8842d7a649b61e00742186e886' \
  | shasum -a 256 -c -
```

Only after verification succeeds, inspect the script and preview the installation. Stop if the download or checksum fails:

```bash
less install.sh
sh install.sh --release 0.3.0-preview.1 --payload thin --plan
```

`--plan` does not commit the managed installation, but it still downloads and extracts verified assets into temporary storage.

#### 3. Confirm installation

Review the target paths, package ownership, and proposed changes, then run:

```bash
sh install.sh --release 0.3.0-preview.1 --payload thin
```

The installer asks for confirmation. Add `--yes` only for an explicitly approved noninteractive installation. Shell profiles are changed only when you explicitly add `--configure-shell`.

For `PATH_ACTION_REQUIRED`, follow the printed instructions. With the default installation paths, check the current shell with:

```bash
export PATH="$HOME/.local/bin:$PATH"
omp admin doctor --json
```


#### 4. Configure a model and open a project

Without an authenticated model, run `pi` first and configure your provider using the [Pi documentation](https://github.com/earendil-works/pi). Use `/login` for supported login flows. Exit Pi when setup is complete, then return to your project:

```bash
cd /path/to/project
omp
```

Honor the Pi Project Trust prompt and select an authenticated model. Alternatively, use `omp --model provider/model-id`, replacing the placeholder with an actual model identifier.

**Use `omp` for everyday work, not `pi`.** The latter is the advanced, raw runtime entry and may load a different extension set. User-local installation does not mean local model inference. OMP supplies neither model subscriptions nor provider credits; keep credentials out of project configuration.


### Manage your installation

Inspect the version and installation, and explicitly check for releases in the same Preview series:

```bash
omp admin version --json
omp admin doctor --json
omp admin stack status --json
omp admin release check --channel preview --json
```

**There is no background updater.** The current installer and release resolver are pinned to an exact version. Install future releases with their own verified installers; do not substitute `latest` or a guessed version into an old script.

<details>
<summary>Update, rollback, and removal commands</summary>

For a version supported by the installed management CLI, first preview a verified local bundle:

```bash
omp admin stack update --bundle /absolute/path/reviewed-full.tar.gz --plan --json
```

After reviewing the plan, apply it:

```bash
omp admin stack update --bundle /absolute/path/reviewed-full.tar.gz --apply --yes --json
```

Rollback requires an available known-good stack. Preview it first:

```bash
omp admin stack rollback --plan --json
```

Confirm the target, then roll back:

```bash
omp admin stack rollback --apply --yes --json
```

To remove the managed stack, preview removal:

```bash
omp admin stack remove --plan --json
```

Confirm what will be kept and removed, then apply:

```bash
omp admin stack remove --apply --yes --json
```

Management CLI mutations use `--apply --yes`, unlike the bootstrap script's `--yes`. `omp admin uninstall` removes OMP activation and its entry, not the entire managed stack.

Exit active controlled Pi processes normally first; terminating them requires separate `--terminate-pi` authority. Removal reconciles ownership, preserves preexisting or changed user data, and may require manual reconciliation. Provider credentials, sessions, and system Homebrew installations are not removal targets.

</details>

<details>
<summary>Default paths and coexistence with an existing Pi installation</summary>

| Path | Purpose |
| --- | --- |
| `~/.local/bin/omp`, `~/.local/bin/pi` | User-level command links |
| `~/.local/share/only-my-pi/stacks/` | Verified managed stacks |
| `~/.local/share/only-my-pi/current-stack`, `~/.local/share/only-my-pi/lkg-stack` | Active and, when available, known-good stack pointers |
| `~/.local/share/only-my-pi/transactions/` | Installation journals |
| `~/.pi/agent/only-my-pi/` | Preferences, configuration state, and private run artifacts |
| `~/.pi/agent/npm/` | User-owned external Pi packages |

Existing Homebrew Node/Pi installations are preserved, although `PATH` order can make the user-level `pi` take precedence. Unknown command files are not overwritten. Third-party packages remain user-owned, and conflicts require explicit reconciliation. Do not manually delete journals or retarget stack pointers.

</details>


### Release bundles and verification

| Bundle | When to use it |
| --- | --- |
| **Thin** | Online installation; retrieves and verifies exact manifest-bound dependencies. Used in the quick start. |
| **Full** | Includes the embedded runtime and complete dependency payload; supports offline installation after download, verification, and transfer. |

Both install the same canonical stack. The online installer's `--payload full` still downloads from GitHub. **A fully offline installation requires a local Full bundle.** Offline installation does not imply offline model access.


<details>
<summary>Verify release assets, signatures, and build provenance</summary>

Use a GitHub CLI version with `release verify`, `release verify-asset`, and `attestation verify`. Download all release assets into a new, empty directory and verify them. Proceed with installation only when every check passes:

```bash
mkdir only-my-pi-release-assets &&
cd only-my-pi-release-assets &&
gh release download v0.3.0-preview.1 --repo Ricardo121380/only-my-pi &&
gh release verify v0.3.0-preview.1 --repo Ricardo121380/only-my-pi &&
shasum -a 256 -c SHA256SUMS &&
(
  for asset in *; do
    gh release verify-asset v0.3.0-preview.1 "$asset" \
      --repo Ricardo121380/only-my-pi || exit 1
  done
)
```

`SHA256SUMS` excludes itself and `release-index.json`; release attestations verify the complete asset set. You can also verify the Full bundle's bound source and build workflow:

```bash
gh attestation verify only-my-pi-0.3.0-preview.1-darwin-arm64-full.tar.gz \
  --repo Ricardo121380/only-my-pi \
  --source-digest aaf22c968c9defeb9106680a30504e4ca6949052 \
  --signer-digest aaf22c968c9defeb9106680a30504e4ca6949052 \
  --source-ref refs/heads/main \
  --signer-workflow Ricardo121380/only-my-pi/.github/workflows/m11-publish.yml \
  --deny-self-hosted-runners
```

The same source check applies to Thin. Add `--predicate-type https://spdx.dev/Document/v2.3` to select the SPDX attestation. Release materials also include a software bill of materials (SBOM), dependency artifact ledger, and third-party notices.

Published assets for this version are immutable. Later documentation or workflow commits on `main` do not change the released bytes. See the [release notes](docs/releases/0.3.0-preview.1.md) and [publication workflow](.github/workflows/m11-publish.yml).

</details>

<details>
<summary>Perform a first offline installation from a local Full bundle</summary>

Verify the Full bundle and required attestations on a connected machine, then transfer it to the target Mac. Replace the path below with the verified archive's absolute path. This uses the bundled Node runtime and does not fetch managed installation dependencies:

```bash
omp_bundle="/absolute/path/only-my-pi-0.3.0-preview.1-darwin-arm64-full.tar.gz"
omp_extract="$(mktemp -d)"
tar -xzf "$omp_bundle" -C "$omp_extract"
omp_payload="$omp_extract/only-my-pi"
mkdir "$omp_payload/omp"
tar -xzf "$omp_payload/only-my-pi.tgz" -C "$omp_payload/omp"

env PATH="$omp_payload/node/bin:$PATH" \
  "$omp_payload/node/bin/node" "$omp_payload/omp/package/bin/omp.mjs" \
  admin stack install --bundle "$omp_bundle" --plan --json
```

Review the plan, then install from the same shell:

```bash
env PATH="$omp_payload/node/bin:$PATH" \
  "$omp_payload/node/bin/node" "$omp_payload/omp/package/bin/omp.mjs" \
  admin stack install --bundle "$omp_bundle" --apply --yes --json
```

With OMP already installed, use `omp admin stack install --bundle "$omp_bundle" --plan --json`, review the plan, then use `--apply --yes --json`. Keep the verified archive for recovery; the extracted directory is only a temporary bootstrap location.

</details>



</details>

<a id="development-and-validation"></a>

## Development and contributing

Repository development requires **Node.js >=22.19.0**; CI checks `22.19.0` and `24.19.0`. Source development and the managed end-user installation are separate paths:

```bash
git clone https://github.com/Ricardo121380/only-my-pi.git
cd only-my-pi
npm ci --ignore-scripts --no-audit --no-fund

npm run lint
npm run typecheck
npm run schema:check
npm run pack:check
node --test tests/ci-contract.test.mjs tests/docs-links.test.mjs
npm run verify:m12
```

`npm test` runs the repository test suite. `npm run verify:m12` **inspects** the direct-agent acceptance contract; it does not execute acceptance checks. `npm run verify:m12:run` executes C1–C10; protected C11/C12 need separately authorized evidence. `NOT_RUN_BY_POLICY` is not a live-model pass.

A source edit does not replace the installed managed stack. Use disposable projects and configuration directories for integration tests, not your real Pi home. Never commit credentials, sessions, or run archives. Read the [contribution guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md) before contributing.

<a id="architecture-and-repository-layout"></a>

## Architecture and documentation

| Entry | Responsibility or further reading |
| --- | --- |
| [Direct session extension](extensions/omp-direct/) / [direct runtime](packages/direct-agent/) | Model selection, coding grants, tool boundaries, clone writing, and verification |
| [Release stack](packages/release-stack/) / [bootstrap](packages/bootstrap/) | Verification, ownership, transactions, recovery, and rollback |
| [Pinned dependencies](contracts/release/external/package.json) / [launcher](packages/direct-agent/launcher.mjs) | Reviewed dependencies and the extensions actually enabled; bundled does not mean active |
| [Architecture decision](docs/decisions/ADR-0013-direct-terminal-coding-agent.md) / [documentation index](docs/README.md) | Product boundaries and design records |
| [Changelog](CHANGELOG.md) / [milestones](docs/STATUS.md) / [Labs](docs/LABS.md) | Version changes, historical records, and non-default experiments |

`pi-subagents@0.57.0` is the sole runtime that creates child agents. Older orchestration controls remain under `/omp advanced ...`, not as required everyday steps; direct sessions no longer use `/omp run`. The historical `0.2.0-preview.1` remains `HOLD_PUBLICATION` as an `INTERNAL_DISTRIBUTION_FOUNDATION`; it is not a published installation target.

<a id="security-license-and-references"></a>

## Security and license

**Approval controls the agent workflow; it does not isolate the whole process.** Pi extensions and packages run with the invoking user's OS authority. Project Trust, tool restrictions, and Git clones are not complete sandboxes. Bash sandboxing is surface-specific; inspect its actual active/degraded state. Untrusted code or extensions require an outer boundary that covers the relevant files, credentials, and network access.

Coding approval does not authorize project-external writes, secret access, destructive Git operations, deployment, or publication. OMP does not silently stage, commit, or push. The direct product does not enable MCP, memory, sync, or experimental overlays, and has no silent permission bypass or background updater.

Keep credentials in Pi's authentication mechanism or your secret manager. Report suspected vulnerabilities through [private security reporting](https://github.com/Ricardo121380/only-my-pi/security/advisories/new), never by publicly disclosing sensitive material. See the [security policy](SECURITY.md) and [threat model](docs/threat-model.md).

First-party code is [MIT licensed](LICENSE). Third-party components retain their own licenses; consult the [third-party notices](THIRD_PARTY_NOTICES.md) and the released SBOM.

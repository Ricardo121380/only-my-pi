# Only My Pi · WebUI 0.1.0-preview.2 candidate

This is the next portable WebUI candidate, built from the current `main`
source. A candidate build and local acceptance do not establish a public
release. The published `webui-v0.1.0-preview.1` archive remains unchanged.

Requires native macOS 15+ on Apple Silicon. The archive includes Node 24.19.0,
Pi 1.5.0, native tool binaries and third-party licenses. Git must already be
installed. npm and a source build are not required to start it.

Extract the archive, enter `only-my-pi-webui`, and run `./start.command`.
Open the private one-time pairing link printed in the terminal. Add a trusted
project and configure a DeepSeek account in Settings. Main tasks and read-only
children require DeepSeek. No existing account is imported automatically.

Use `./start.command --check` to verify every manifest entry. Input `pair` for
a fresh pairing link, or `stop` / Ctrl+C for graceful shutdown. Configuration
and history remain in `~/Library/Application Support/OnlyMyPi/WebUI Preview/0.1.0-preview.2`;
you may choose a fresh absolute `--data-dir`. Previous-version data is retained
and is not migrated by this candidate.

The existing WebUI design and interactions are retained. Pi owns sessions,
tools and JSONL history. Viewing history does not execute a task; continuing
requires explicit selection and a new message. New execution does not inherit
previous approval. Stopping a task also stops its child process group.

Compared with preview.1, development uses `main` and the default `dev:web`
entry. The portable startup no longer imports Vite. Source documentation,
tests, verification records, comparison prototypes and legacy archives remain
in Git and are omitted from the portable copy before manifest generation.
Runtime dependencies, schemas, agent resources and licenses are retained.
`build-receipt.json` records the number and uncompressed size of omitted copies.

Approval and tool restrictions operate within the operating-system user's
permissions. This is an early preview for trusted local projects. Persistent
drafts, complete queue recovery and long-running use have separate acceptance;
CLI work and Electron packaging remain later work.

Build, source, lock and runtime file identities are recorded in
`build-receipt.json`, `preview-manifest.json` and `sbom.spdx.json`.
The archive acceptance uses actual Pi and a deterministic local model. It
does not renew external DeepSeek service qualification. First-party code is
MIT; retain the bundled notices and third-party licenses when redistributing.

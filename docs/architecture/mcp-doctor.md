# MCP Doctor

`mcp-doctor` is a static gate for a future project-scoped MCP profile. It reads
one JSON file and never starts a server, resolves a package, reads credentials,
or makes a network request.

It checks:

- explicit `hostConfigDiscovery: "off"` and output guard settings;
- exactly one stdio command or HTTPS URL per server;
- shell-wrapper and unpinned `npx/npm/pnpm/yarn/bunx` warnings;
- relative working directories;
- literal sensitive environment values and URL credentials;
- `directTools` breadth and dangerous tool names;
- include/exclude filter overlap.

```bash
node scripts/mcp-doctor.mjs --example
node scripts/mcp-doctor.mjs --file path/to/.mcp.json --strict
```

The repository keeps a non-secret static fixture for CI:

```bash
npm run mcp:doctor -- --file verification/fixtures/mcp.safe.json --strict
```

The checks are heuristics, not a sandbox or a guarantee that an MCP server is
benign. A passing result only means the configuration meets this repository's
static policy. The server process still inherits the launching user's file,
network, and credential access; use an OS/container boundary for untrusted
servers.

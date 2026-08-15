# Profile resolver

`only-my-pi` treats a profile as a reviewable capability selection, not as a
second hidden copy of Pi settings. The resolver joins a profile to the pinned
package inventory and produces a deterministic resolved view.

## Invariants

- Only inventory entries with `installed: true` can become active packages.
- Trial candidates cannot be promoted merely by adding their ID to a profile.
- Blocked packages always fail resolution.
- Filtered Pi packages preserve their explicit resource allowlist.
- Resolution is side-effect free: it prints JSON and never edits
  `~/.pi/agent/settings.json` or `.pi/settings.json`.
- Policy remains visible next to the package list, because package selection
  alone does not enforce network, sandbox, approval, or credential boundaries.

## Commands

Resolve the daily coding profile:

```bash
node scripts/profile-resolver.mjs profiles/coding.json
```

Print the Pi-compatible package fragment only:

```bash
node scripts/profile-resolver.mjs profiles/coding.json --pi-settings
```

Compare two resolved profiles:

```bash
node scripts/profile-resolver.mjs profiles/coding.json \
  --diff profiles/research.json
```

Check every profile and run the pure-function tests:

```bash
npm run profile:check
npm test
```

The generated Pi package fragment is an inspection artifact. Applying it to a
real settings file will be implemented as a separate, backup-first command with
an explicit approval boundary; this resolver deliberately cannot mutate local
configuration.

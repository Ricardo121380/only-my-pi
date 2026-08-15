# Context Doctor

Context Doctor is a non-mutating Pi extension that reports context pressure
without storing prompt text, reasoning, tool output, schemas, or credentials.

It listens to Pi's documented `before_agent_start`, `turn_start`, and `context`
events and computes:

- message count and role distribution;
- text character count and a clearly labelled four-characters-per-token
  approximation;
- active/configured tool counts and approximate schema size;
- system-prompt size;
- Pi's provider-aware context estimate when available.

The TUI gets a small `ctx` status item and `/omp-context` displays the most
recent summary. The extension returns no context replacement, adds no system
prompt instructions, writes no files, and performs no network requests.

## Privacy boundary

Only aggregate numbers are retained in memory. The implementation walks text
fields long enough to count characters but never includes their values in the
snapshot or UI. It deliberately does not log raw prompts, assistant reasoning,
tool arguments, tool results, file paths, environment variables, or provider
headers.

## Verification

```bash
node --test extensions/context-doctor/test.mjs
pi -e extensions/context-doctor/index.ts --no-session --no-context-files --no-skills --help
```

The four-character heuristic is not billing-grade tokenization. The
`providerEstimate` field from Pi is authoritative when it is available; the
heuristic is useful only for explaining relative contributors before a model
response supplies an exact estimate.

# Safe mode launcher

`scripts/safe-mode.mjs` builds a fixed, read-only Pi resource profile:

```text
--no-extensions
--no-skills
--no-prompt-templates
--no-themes
--no-context-files
--no-session
--no-approve
--tools read,grep,find,ls
```

It defaults to printing the exact command as JSON; it does not start Pi unless
the user adds `--run`. This makes review the normal path and prevents a wrapper
invocation from silently loading project instructions or third-party code.

```bash
npm run safe -- --shell --provider openai --model gpt-5 -- "inspect this repo"
npm run safe -- --run --provider openai --model gpt-5 -- "inspect this repo"
```

Only model/provider/thinking/output/offline flags are forwarded. The wrapper's
`--` separator joins the remaining words into one `Task:` message so a prompt
beginning with `-` cannot be reinterpreted by Pi's parser. Pi `@file` shorthand
is rejected. Flags that can
re-enable extensions, skills, broader tools, approval, API keys, or persistence
are rejected. `PI_TELEMETRY=0` is set for the child process.

## Boundary

This is not a sandbox. The selected built-in read/search tools still execute as
the invoking user and may be able to read outside the working directory. The
prompt and any data the model is asked to inspect still go to the configured
Provider. Pi's `--offline` disables Pi startup/update/package traffic; it does
not by itself prevent Provider, shell, MCP, or extension network access. Use an
OS/container/VM boundary and a local model when those properties are required.

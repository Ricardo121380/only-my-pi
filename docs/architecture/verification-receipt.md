# Verification receipts

The verification runner turns reproducible checks into a small, reviewable
receipt. It does not let the model declare success and does not preserve raw
command output.

The repository suite is JSON and contains argument arrays, not shell strings.
Every command must be explicitly allowlisted, declare a bounded timeout, and
state that its output is not expected to contain sensitive data. Output is
limited to two MiB per check. The receipt records:

- suite and source Git commit;
- exact command and argument vector;
- pass/fail, exit code, signal, timeout and output-limit state;
- elapsed time and stdout/stderr byte counts;
- SHA-256 output fingerprints, but not raw output.

The default command is a dry-run:

```bash
npm run verify
```

Generate a receipt only from a clean implementation commit:

```bash
npm run verify -- --run \
  --output verification/receipts/2026-08-15-bootstrap.json
```

The runner creates a new file with exclusive-create semantics and refuses an
output path outside `verification/receipts`. It does not overwrite an existing
receipt.

## Privacy and trust boundary

An output hash is not encryption and may permit guessing a short predictable
secret. Suites must therefore be designed not to print credentials, source
secrets, raw prompts, or private datasets. This runner also does not sandbox
commands: it is intended for reviewed, repository-owned checks. Untrusted test
code still belongs in a container or VM.

# Verification receipts

The verification runner turns reproducible checks into a small, reviewable
receipt. It does not let the model declare success and does not preserve raw
command output.

The versioned `release-gates-v1` manifest contains argument arrays, not shell
strings. Every command is explicitly allowlisted, declares a bounded timeout,
and states that its output is not expected to contain sensitive data. Output is
limited to two MiB per check. The receipt records:

- suite and source Git commit;
- exact command and argument vector;
- pass/fail, exit code, signal, timeout and output-limit state;
- elapsed time and stdout/stderr byte counts;
- SHA-256 output fingerprints, but not raw output.

The default command is a manifest inspector:

```bash
npm run verify
```

Generate the final receipt only from a clean implementation commit:

```bash
npm run verify -- --run \
  --output verification/receipts/2026-08-16-harness-mvp.json
```

The runner reads only `verification/release-gates-v1.json`, checks that the
source worktree is clean, executes every fixed gate with `shell:false`, and
creates a new file with exclusive-create semantics. It refuses an output path
outside `verification/receipts` and never overwrites an existing receipt. The
receipt records the manifest digest and exact gate ID order, so an older suite
cannot be promoted as a release result.

## Privacy and trust boundary

An output hash is not encryption and may permit guessing a short predictable
secret. Gates must therefore be designed not to print credentials, source
secrets, raw prompts, or private datasets. This runner also does not sandbox
commands: it is intended for reviewed, repository-owned checks. Untrusted test
code still belongs in a container or VM. CI executes the same manifest and
validates the same receipt contract without Provider credentials.

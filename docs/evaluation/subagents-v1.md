# Subagents v1 offline evaluation baseline

This corpus is a deterministic contract evaluation for the successor S0–S2
implementation. It does not call a model, Pi, `pi-subagents`, a Provider, the
network, or a real user configuration directory. A passing result is therefore
evidence for typed contract behavior only; it is not evidence of live model
quality, throughput, cancellation, worktree isolation, cost, or Provider
compatibility.

The versioned manifest is
`verification/evaluation/subagents-v1/manifest.json`. It binds 15 reviewed
fixtures, a fixed seed, three repetitions, generator identity and digest,
baseline measurements, metric definitions, and exact thresholds. Fixtures
cover Agent correlation, homogeneous BatchSwarm, Workflow DAG validation,
bounded dynamic goal proposals, recovery idempotency, parent budgets, and
terminal-proof cancellation.

Three baselines are retained:

- `single-agent-reference` exposes why a one-Agent implementation cannot claim
  orchestration coverage;
- `legacy-v1-reference` records the reviewed safety gaps in heterogeneous batch
  admission, budget overshoot, duplicate effects, and unproven cancellation;
- `current-release` is the S0–S2 contract implementation under evaluation.

Run the corpus with:

```sh
node --test tests/subagents-evaluation.test.mjs
```

Live gates belong to S5 and remain `NOT_RUN_BY_POLICY` until separately
authorized. The offline report always carries
`claim=CONTRACT_PREVIEW_OFFLINE_SIMULATOR` and `liveQualityClaim=false`.

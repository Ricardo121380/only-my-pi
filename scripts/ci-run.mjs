#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, nodeTestFiles, testLane, isNodeTest } from "./ci-plan.mjs";
import { M12_DETERMINISTIC_CHECKS } from "./m12-deterministic-acceptance.mjs";
import { runCheck, formatGateProgress } from "./verification-receipt.mjs";

const focusedCoverage = M12_DETERMINISTIC_CHECKS.filter(check => check.id.endsWith("-coverage") && check.id !== "global-coverage");
const coveredFiles = new Set(focusedCoverage.flatMap(check => check.args.filter(arg => arg.endsWith(".test.mjs"))));
const historicalNpmChecks = ["release-gates-v1", "release-gates-v2", "daily-harness-gates-v1"]
  .flatMap(name => JSON.parse(fs.readFileSync(path.join(root, "verification", `${name}.json`), "utf8")).gates)
  .filter(check => check.command === "npm");
const npm = (script) => {
  const budgets = historicalNpmChecks.filter(check => JSON.stringify(check.args) === JSON.stringify(["run", script]))
    .map(check => check.timeoutMs);
  return { id: script, command: "npm", args: ["run", script], ...(budgets.length ? { timeoutMs: Math.min(...budgets) } : {}) };
};
const node = (id, args) => ({ id, command: process.execPath, args });

export function checksForLane(lane, files = nodeTestFiles()) {
  const tests = files.filter(file => testLane(file) === lane && !(lane === "cli" && coveredFiles.has(file)))
    .map(file => node(file, ["--test", "--test-concurrency=1", "--test-reporter=tap", file]));
  if (lane === "docs") return [npm("lint"), ...tests];
  if (lane === "static") return ["typecheck", "schema:check", "pack:check", "secret:scan"].map(npm);
  if (lane === "web") {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
    return [npm("test:web"), ...(scripts["test:web:b2"] ? [npm("test:web:b2")] : []), ...(scripts["build:web:minimal"] ? [npm("build:web:minimal")] : []), npm("build:web"), ...(scripts["build:web:b2"] ? [npm("build:web:b2")] : []), ...tests];
  }
  if (lane === "cli") return [
    ...["doctor", "doctor:profiles", "doctor:modes", "doctor:subagents-topology", "agents:check"].map(npm),
    ...focusedCoverage, ...tests,
  ];
  if (lane === "coverage") return M12_DETERMINISTIC_CHECKS.filter(check => check.id === "global-coverage");
  if (lane === "packaging") {
    const receipts = [
      ["2026-08-16-harness-mvp.json", "6941761b3948d96a77596e1302d3205efb5169f1"],
      ["2026-08-17-post-merge-maintenance.json", "bff3e3be376bb2ee614a441685e7cab14324727a"],
    ].filter(([file]) => fs.existsSync(path.join(root, "verification/receipts", file)))
      .map(([file, sha]) => node(file, ["scripts/release-receipt-check.mjs", "--receipt", `verification/receipts/${file}`,
        "--source-commit", sha, "--manifest", "verification/manifests/release-gates-v1-2026-08.json"]));
    return [
      ...receipts, node("public-baseline-authority", ["--input-type=module", "--eval",
        'const { inspectPublicBaseline } = await import("./scripts/public-baseline-gates.mjs"); const { record } = await inspectPublicBaseline(); if (record.state !== "PUBLIC_BASELINE_VERIFIED") throw new Error("PUBLIC_BASELINE_PENDING"); console.log(record.state);']),
      { ...npm("test:e2e"), id: "test-e2e" },
      { ...npm("test:e2e:daily"), id: "D12", label: "test-e2e-daily" },
    ];
  }
  throw new Error(`Unknown CI lane: ${lane}`);
}

function inspectSource() {
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    clean: execFileSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" }).trim() === "",
  };
}

export async function runLane(lane, { checks = checksForLane(lane), execute = runCheck, output, sourceState = inspectSource } = {}) {
  const source = sourceState();
  const report = { kind: "only-my-pi-development-ci", lane,
    sourceCommit: source.commit, sourceClean: source.clean,
    nodeVersion: process.version, platform: process.platform, arch: process.arch,
    startedAt: new Date().toISOString(), status: "RUNNING", rawOutputStored: false,
    results: checks.map(check => ({ id: check.label ?? check.id, status: "NOT_RUN" })) };
  const save = () => {
    if (!output) return;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  };
  save();
  // Keep the former full-tests/D15 budget, while recording each file separately.
  const deadline = Date.now() + 1_800_000;
  let next = 0;
  let failed = false;
  async function runOne(index) {
    const check = checks[index];
    const id = check.label ?? check.id;
    report.results[index] = { id, status: "RUNNING", startedAt: new Date().toISOString() };
    save();
    process.stdout.write(`START ${id} ${report.results[index].startedAt}\n`);
    let result = await execute({ ...check,
      // Reuse the existing bounded, redacted test diagnostics and process-group
      // timeout handling. Keep fresh-tarball's evidence extraction contract.
      id: ["test-e2e", "D12"].includes(check.id) ? check.id : "full-tests",
      timeoutMs: Math.max(1, Math.min(check.timeoutMs ?? 1_800_000, deadline - Date.now())), maxOutputBytes: 4 * 1024 * 1024,
      env: { CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" },
    }, { cwd: root });
    if (check.id === "test-e2e" && result.evidence?.sourceCommit !== report.sourceCommit) {
      result = { ...result, passed: false, status: "FAIL", expectationPassed: false, diagnostic: "FRESH_SOURCE_COMMIT_MISMATCH" };
    }
    report.results[index] = { ...report.results[index], ...result, id, completedAt: new Date().toISOString() };
    if (!result.passed) failed = true;
    save();
    process.stdout.write(formatGateProgress({ ...result, id }, result.diagnostic));
  }
  async function worker() {
    while (!failed && next < checks.length) await runOne(next++);
  }
  // Build and governance steps remain sequential. Only independent Node files
  // run two at a time, matching the existing root suite's concurrency.
  const firstTest = checks.findIndex(check => isNodeTest(check.id));
  const serialEnd = firstTest < 0 ? checks.length : firstTest;
  while (!failed && next < serialEnd) await runOne(next++);
  await Promise.all([worker(), worker()]);
  const after = sourceState();
  report.sourceCommitAfter = after.commit;
  report.sourceCleanAfter = after.clean;
  if (source.commit !== after.commit || (source.clean && !after.clean)
      || (process.env.GITHUB_ACTIONS === "true" && !source.clean)) {
    failed = true;
    report.sourceFailure = "SOURCE_CHANGED_OR_DIRTY";
    process.stderr.write(`${report.sourceFailure}\n`);
  }
  report.status = failed ? "FAIL" : "PASS";
  report.completedAt = new Date().toISOString();
  save();
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [lane, output] = process.argv.slice(2);
  const report = await runLane(lane, { output });
  process.exitCode = report.status === "PASS" ? 0 : 1;
}

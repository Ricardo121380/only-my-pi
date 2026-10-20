import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import pty from "node-pty";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClassificationHost, classificationBudget } from "./fixtures/classification-host.mjs";
import { until } from "./fixtures/mcp-host.mjs";

test("real Pi TUI applies project selection, authorizes native classification and delivers its result", { timeout: 60000 }, async t => {
  const f = await createClassificationHost();
  let output = "", exited, terminal;
  t.after(async () => {
    if (process.env.OMP_CLASSIFIER_EVIDENCE_DIR) await fs.writeFile(path.join(process.env.OMP_CLASSIFIER_EVIDENCE_DIR, "tui-output.txt"), output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, ""));
    if (terminal && !exited) { terminal.kill("SIGTERM"); await until(() => exited, Boolean, "classification TUI exit"); } await f.close();
  });
  await f.configure();
  const file = path.join(f.root, "selection.json");
  await fs.writeFile(file, JSON.stringify({ revision: 0, classifier: { accountId: f.account.accountId, model: "fixtureclass/sentiment", budget: classificationBudget } }));
  terminal = pty.spawn(f.stack.nodePath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 140, rows: 44 });
  terminal.onData(data => { output += data; }); terminal.onExit(value => { exited = value; });
  await until(() => output, text => text.includes("Inspect") || exited, "classification TUI start", 30000); assert.equal(exited, undefined, output);
  terminal.write(`/omp-classifier apply ${file}\r`);
  await until(() => f.calls(), state => state.config.revision === 1, "TUI selection persisted");
  await until(() => output, text => text.includes("分类配置与请求账本"), "TUI result view");
  const marker = output.length; terminal.write("\x1b");
  await until(() => output.slice(marker), text => text.includes("Inspect"), "TUI editor closed");
  terminal.write("Classify a helpful example\r");
  await until(() => output, text => text.includes("本任务，按其他额度运行"), "TUI explicit unknown-cost approval", 15000);
  assert.equal(f.received.length, 0);
  terminal.write("\x1b[B\r");
  const ledger = await until(() => f.calls(), state => state.tasks.at(-1)?.requests[0]?.status === "completed", "TUI classification result", 15000);
  assert.equal(f.received.length, 1); assert.equal(ledger.tasks.at(-1).requests[0].result.answers.sentiment.choice, "positive");
  await until(() => output, text => text.includes("positive"), "TUI product result");
  await until(() => f.calls(), state => state.tasks.at(-1).status === "stopped", "TUI task settled");
  terminal.write("\x04"); await until(() => exited, Boolean, "TUI clean exit"); assert.equal(exited.exitCode, 0);
});

test("public headless CLI requires task consent and never falls back to ambient credentials", { timeout: 30000 }, async t => {
  const f = await createClassificationHost(); t.after(() => f.close()); await f.configure(); await f.select();
  const execution = promisify(execFile)(f.stack.nodePath, [f.cli, "--model", "fixture/one", "--no-session", "-p", "classification probe"], { cwd: f.project, env: { ...f.env, TYPESAFE_API_KEY: "ambient-synthetic-denied" }, timeout: 20000 });
  execution.child.stdin.end();
  const result = await execution;
  assert.equal(f.received.length, 0);
  assert.equal((await f.calls()).tasks.at(-1).requests.length, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /ambient-synthetic-denied/);
});

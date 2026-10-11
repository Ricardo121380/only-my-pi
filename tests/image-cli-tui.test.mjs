import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import pty from "node-pty";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createImageHost, imageBudget, imageDigest } from "./fixtures/image-host.mjs";
import { until } from "./fixtures/mcp-host.mjs";

test("public image CLI and real Pi TUI select independently, consent and persist actual image references", { timeout: 60000 }, async t => {
  const f = await createImageHost(); let output = "", exited, terminal;
  t.after(async () => {
    if (process.env.OMP_IMAGE_EVIDENCE_DIR) await fs.writeFile(path.join(process.env.OMP_IMAGE_EVIDENCE_DIR, "image-tui-output.txt"), output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, ""));
    if (terminal && !exited) { terminal.kill("SIGTERM"); await until(() => exited, Boolean, "image TUI exit"); } await f.close();
  });
  await f.configure();
  const cli = async args => JSON.parse((await promisify(execFile)(f.stack.nodePath, [f.cli, "image", ...args, "--project", f.project], { env: f.env, timeout: 15000 })).stdout);
  assert.equal((await cli(["list", f.account.accountId])).models[0].id, "fixtureimage/checkerboard");
  assert.deepEqual((await cli(["status"])).tasks, []);
  const file = path.join(f.root, "image-selection.json"); await fs.writeFile(file, JSON.stringify({ revision: 0, image: { accountId: f.account.accountId, model: "fixtureimage/checkerboard", budget: imageBudget } }));
  terminal = pty.spawn(f.stack.nodePath, [f.cli, "--model", "fixture/one", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 140, rows: 44 });
  terminal.onData(data => { output += data; }); terminal.onExit(value => { exited = value; });
  await until(() => output, text => text.includes("Inspect") || exited, "image TUI ready", 30000); assert.equal(exited, undefined, output);
  terminal.write(`/omp-image apply ${file}\r`); await until(() => f.calls(), state => state.config.revision === 1, "TUI image selection");
  await until(() => output, text => text.includes("生图配置与请求账本"), "image TUI configuration");
  const marker = output.length; terminal.write("\x1b"); await until(() => output.slice(marker), text => text.includes("Inspect"), "image TUI configuration closed");
  terminal.write("Generate the checkerboard\r"); await until(() => output, text => text.includes("本任务，按其他额度运行"), "image TUI consent", 15000); assert.equal(f.received.length, 0);
  terminal.write("\x1b[B\r"); const ledger = await until(() => f.calls(), state => state.tasks.at(-1)?.requests[0]?.storage?.status === "saved", "TUI actual image", 15000);
  assert.equal(f.received.length, 1); assert.equal(ledger.tasks.at(-1).requests[0].storage.artifacts[0].sha256, imageDigest);
  await until(() => output, text => text.includes("\"sha256\"") && text.includes(imageDigest.slice(0, 16)), "TUI sourced image result"); await until(() => f.calls(), state => state.tasks.at(-1).status === "stopped", "image TUI settled");
  terminal.write("\x04"); await until(() => exited, Boolean, "TUI clean image exit"); assert.equal(exited.exitCode, 0);
});

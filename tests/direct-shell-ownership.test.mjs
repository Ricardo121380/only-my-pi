import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedBashOperations } from "../packages/direct-agent/shell.mjs";
import { projectExecutionState } from "../packages/project-gates/index.mjs";

test("owned shell streams output and confirms its execution group before release", async () => {
  const chunks = [], shell = createOwnedBashOperations();
  const result = await shell.exec("printf 'owned shell'", process.cwd(), { onData: (data) => chunks.push(data), env: { PATH: "/usr/bin:/bin" } });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), "owned shell");
  assert.deepEqual(projectExecutionState(), { active: 0, unconfirmed: false });
});
test("shell exit with a pipe-owning background process triggers group cleanup", async () => {
  const shell = createOwnedBashOperations();
  await assert.rejects(shell.exec("sleep 30 &", process.cwd(), { onData() {}, timeout: 3, env: { PATH: "/usr/bin:/bin" } }), /SHELL_DESCENDANT_ACTIVE/);
  assert.deepEqual(projectExecutionState(), { active: 0, unconfirmed: false });
});
test("cancelled shell is not a successful command and does not release before exit", async () => {
  const signal = new AbortController(), shell = createOwnedBashOperations();
  const running = shell.exec("printf ready; sleep 30", process.cwd(), { signal: signal.signal, onData() { signal.abort(); }, timeout: 3, env: { PATH: "/usr/bin:/bin" } });
  await assert.rejects(running, /SHELL_CANCELLED/);
  assert.deepEqual(projectExecutionState(), { active: 0, unconfirmed: false });
});

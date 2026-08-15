import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Pi adapter registers lifecycle handlers and emits redacted receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "only-my-pi-ledger-adapter-"));
  process.env.ONLY_MY_PI_LEDGER_DIR = directory;
  const { default: extension } = await import("./index.ts");
  const handlers = new Map();
  extension({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });

  assert.deepEqual([...handlers.keys()].sort(), [
    "session_before_compact",
    "session_before_fork",
    "session_before_switch",
    "session_before_tree",
    "session_compact",
    "session_info_changed",
    "session_shutdown",
    "session_start",
    "session_tree",
    "tool_execution_end",
    "tool_execution_start",
  ]);

  const ctx = {
    sessionManager: {
      getSessionId: () => "session-test",
      getSessionFile: () => "/private/project/session.jsonl",
    },
  };
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  await handlers.get("tool_execution_start")(
    { toolCallId: "call-1", toolName: "bash", args: { command: "echo sk-secret" } },
    ctx,
  );
  await handlers.get("tool_execution_end")(
    { toolCallId: "call-1", toolName: "bash", result: { output: "sk-secret" }, isError: false },
    ctx,
  );
  await handlers.get("session_shutdown")({ reason: "quit" }, ctx);

  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const text = await readFile(join(directory, files[0]), "utf8");
  assert.equal(text.includes("sk-secret"), false);
  assert.equal(text.includes("/private/project/session.jsonl"), false);
  const receipts = text.trim().split("\n").map(JSON.parse);
  assert.deepEqual(receipts.map((receipt) => receipt.event), [
    "session_start",
    "tool_call_start",
    "tool_call_end",
    "session_shutdown",
  ]);
  assert.equal(receipts[1].toolCallIdHash, receipts[2].toolCallIdHash);
  delete process.env.ONLY_MY_PI_LEDGER_DIR;
});

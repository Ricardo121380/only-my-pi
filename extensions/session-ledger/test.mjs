import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReceiptLedger, hashValue, resolveLedgerDirectory, summarizeValue } from "./ledger.mjs";

assert.deepEqual(summarizeValue("secret prompt"), { type: "string", length: 13 });
assert.deepEqual(summarizeValue({ token: "secret", nested: true }), { type: "object", keys: 2 });
assert.equal(hashValue({ b: 2, a: 1 }), hashValue({ a: 1, b: 2 }));
assert.throws(() => resolveLedgerDirectory({ ONLY_MY_PI_LEDGER_DIR: "relative" }), /absolute path/);

const directory = await mkdtemp(join(tmpdir(), "only-my-pi-ledger-"));
const ledger = createReceiptLedger({ directory, runId: "run-test", now: () => "2026-01-01T00:00:00.000Z" });
await ledger.redactToolStart({ toolCallId: "call-1", toolName: "bash", args: { command: "echo secret" }, sessionId: "session-test" });
await ledger.redactToolEnd({ toolCallId: "call-1", toolName: "bash", result: { output: "do not persist" }, isError: false, sessionId: "session-test" });
await ledger.append("session_start", { sessionId: "session-test", details: { reason: "startup" } });
await ledger.flush();

const lines = (await readFile(ledger.path, "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(lines.length, 3);
assert.equal(lines[0].schemaVersion, 1);
assert.equal(lines[0].event, "tool_call_start");
assert.equal(lines[0].sessionId, "session-test");
assert.equal(JSON.stringify(lines[0]).includes("secret"), false);
assert.equal(JSON.stringify(lines[1]).includes("do not persist"), false);
assert.equal(lines[0].toolCallIdHash, lines[1].toolCallIdHash);
assert.equal((await stat(directory)).mode & 0o777, 0o700);
assert.equal((await stat(ledger.path)).mode & 0o777, 0o600);
assert.throws(() => createReceiptLedger({ directory, fileName: "../escape.jsonl" }), /must not contain a path/);

const looseDirectory = await mkdtemp(join(tmpdir(), "only-my-pi-ledger-loose-"));
await chmod(looseDirectory, 0o755);
const looseLedger = createReceiptLedger({ directory: looseDirectory, runId: "loose" });
await assert.rejects(() => looseLedger.append("session_start"), /must not be accessible/);
assert.equal((await stat(looseDirectory)).mode & 0o777, 0o755);

const symlinkParent = await mkdtemp(join(tmpdir(), "only-my-pi-ledger-link-"));
const linkedDirectory = join(symlinkParent, "ledger-link");
await symlink(directory, linkedDirectory, "dir");
const linkedLedger = createReceiptLedger({ directory: linkedDirectory, runId: "linked" });
await assert.rejects(() => linkedLedger.append("session_start"), /must not be a symbolic link/);
console.log(`session-ledger smoke ok (${ledger.path})`);

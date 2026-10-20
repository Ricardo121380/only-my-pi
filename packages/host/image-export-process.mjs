import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { groupAlive, processIdentity } from "./ownership.mjs";
import { hostError } from "./contracts.mjs";

export async function publishImageExport({ record, bytes, save, beforePublish }) {
  if (process.platform !== "darwin") throw hostError("IMAGE_EXPORT_PROCESS_ISOLATION_UNAVAILABLE", 409);
  const parentPath = record.target.directories.at(-1).path, target = path.basename(record.target.path), temporary = `.omp-image-${record.operationId}.tmp`;
  const worker = fileURLToPath(new URL("./image-export-worker.mjs", import.meta.url));
  const sha = value => createHash("sha256").update(value).digest("hex");
  const source = { nodePath: process.execPath, nodeSha256: sha(await fs.readFile(process.execPath)), workerPath: worker, workerSha256: sha(await fs.readFile(worker)) };
  const literal = value => `(literal ${JSON.stringify(value)})`;
  const profile = `(version 1) (deny default) (deny process-fork)
    (allow process-exec ${literal(process.execPath)}) (allow signal (target same-sandbox))
    (allow sysctl-read) (allow mach-lookup (global-name "com.apple.system.logger"))
    (allow file-read-metadata)
    (allow file-read* ${literal("/")} ${literal(process.execPath)} ${literal(worker)} (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Apple") (subpath "/dev/fd") ${literal("/dev/null")} ${literal("/dev/urandom")} ${literal("/dev/random")} ${literal(parentPath)} ${literal(path.join(parentPath, target))} ${literal(path.join(parentPath, temporary))})
    (allow file-write* ${literal("/dev/null")} ${literal(path.join(parentPath, target))} ${literal(path.join(parentPath, temporary))})`;
  const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, worker], { cwd: parentPath, detached: true, stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: "/var/empty", TMPDIR: "/var/empty", LANG: "en_US.UTF-8" } });
  child.stdin.on("error", () => {}); let buffer = "", receipt, rejected, ready;
  const gate = new Promise((resolve, reject) => { ready = resolve; rejected = reject; });
  gate.catch(() => {});
  const exited = new Promise(resolve => { child.once("error", error => { rejected(error); resolve({ code: null }); }); child.once("exit", (code, signal) => { rejected(hostError("IMAGE_EXPORT_RECEIPT_LOST", 409)); resolve({ code, signal }); }); });
  let stderr = ""; child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(0, 4096); });
  child.stdout.on("data", chunk => {
    buffer += chunk.toString(); if (buffer.length > 8192) { rejected(hostError("IMAGE_EXPORT_RECEIPT_INVALID", 409)); return; }
    let end; while ((end = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { const result = JSON.parse(line); if (result.phase === "ready") ready(); else if (["completed", "unknown", "failed"].includes(result.phase)) { receipt = result; rejected(hostError(result.error ?? "IMAGE_EXPORT_WORKER_FAILED", 409)); } else rejected(hostError("IMAGE_EXPORT_RECEIPT_INVALID", 409)); } catch { rejected(hostError("IMAGE_EXPORT_RECEIPT_INVALID", 409)); } }
  });
  let commandSent = false;
  try {
    const identity = await processIdentity(child.pid); if (!identity) throw hostError("IMAGE_EXPORT_WORKER_FAILED", 409);
    record.worker = { pid: child.pid, identity, ...source, profileSha256: sha(profile) }; record.executor = "HOST_BOUNDED_EXPORT_WORKER"; await save(record);
    child.stdin.write(JSON.stringify({ parentPath, parent: record.target.directories.at(-1), target, temporary, before: record.target.before, data: bytes.toString("base64"), sha256: record.source.artifact.sha256 }) + "\n");
    await Promise.race([gate, new Promise((_, reject) => setTimeout(() => reject(hostError("IMAGE_EXPORT_TIMEOUT", 409)), 10000).unref())]);
    await beforePublish(); commandSent = true; child.stdin.end('"publish"\n');
    const outcome = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(hostError("IMAGE_EXPORT_TIMEOUT", 409)), 10000).unref())]);
    record.worker.exitCode = outcome.code;
    if (outcome.code !== 0 || groupAlive(child.pid) || !receipt) throw hostError("IMAGE_EXPORT_RECEIPT_LOST", 409);
    return receipt;
  } catch (error) {
    child.stdin.destroy();
    try { process.kill(-child.pid, "SIGKILL"); } catch (kill) { if (kill.code !== "ESRCH") throw kill; }
    const outcome = await exited;
    if (record.worker) { record.worker.exitCode = outcome.code; record.worker.signal = outcome.signal; record.worker.diagnostic = stderr; }
    if (groupAlive(child.pid) || commandSent) return { phase: "unknown", error: "IMAGE_EXPORT_RESULT_UNKNOWN" };
    return receipt ?? { phase: "failed", error: error.code ?? "IMAGE_EXPORT_FAILED" };
  }
}

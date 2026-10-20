import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { processIdentity } from "../../packages/host/ownership.mjs";

export const errorEvidence = error => ({ code: error?.code ?? null, message: String(error?.message ?? error) });
export async function observation(read) {
  try { return { status: "KNOWN", value: await read() }; }
  catch (error) { return { status: "UNKNOWN", error: errorEvidence(error) }; }
}
export const byteEvidence = raw => ({ bytes: Buffer.byteLength(raw), base64: Buffer.from(raw).toString("base64"), sha256: createHash("sha256").update(raw).digest("hex") });
export const fileEvidence = file => observation(async () => byteEvidence(await fs.readFile(file)));
export async function processEvidence(pid) {
  return { pid, identity: await observation(() => processIdentity(pid)), group: await observation(async () => {
    const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "pid,ppid,pgid,lstart,state,pcpu,etime,command"], { maxBuffer: 4 * 1024 * 1024 });
    return stdout.split("\n").filter(line => Number(line.trim().split(/\s+/u)[2]) === pid);
  }) };
}
export async function saveRegressionEvidence(label, data) {
  const output = process.env.OMP_REGRESSION_EVIDENCE_ROOT;
  if (!output) return;
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  if (!path.isAbsolute(output) || !path.relative(repo, output).startsWith("..")) throw new Error("EXTERNAL_EVIDENCE_ROOT_REQUIRED");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `${label}-${process.pid}-${randomUUID()}.json`), JSON.stringify({ at: Date.now(), node: process.version, ...data }, null, 2));
}
export async function mcpDenialEvidence(f, context) {
  const mcp = await observation(() => f.mcp({ type: "status" }));
  const reception = [];
  for (const run of mcp.value?.runs ?? []) for (const entry of run.processes) {
    if (typeof entry.runtimeDir !== "string") {
      reception.push({ runId: run.runId, process: entry, counts: { status: "UNKNOWN", reason: "RECEIVER_PATH_UNAVAILABLE" } });
      continue;
    }
    const file = path.join(entry.runtimeDir, "received.jsonl");
    const raw = await observation(() => fs.readFile(file));
    const parsed = raw.status === "KNOWN" ? await observation(async () => raw.value.toString().trim().split("\n").filter(Boolean).map(JSON.parse)) : raw;
    reception.push({ runId: run.runId, process: entry, file,
      raw: raw.status === "KNOWN" ? { status: "KNOWN", value: byteEvidence(raw.value) } : raw,
      counts: parsed.status === "KNOWN" ? { status: "KNOWN", call: parsed.value.filter(row => row.type === "call").length, effect: parsed.value.filter(row => row.type === "effect").length, records: parsed.value } : parsed,
      identity: await observation(() => processIdentity(entry.pid)) });
  }
  const hostTaskJournal = await fileEvidence(path.join(f.config, "only-my-pi/host/tasks.json"));
  const worker = hostTaskJournal.status === "KNOWN" ? await observation(async () => JSON.parse(Buffer.from(hostTaskJournal.value.base64, "base64").toString()).tasks.find(task => task.taskId === context.taskId)?.worker ?? null) : hostTaskJournal;
  const snapshot = { root: f.root, ...context, worker,
    task: await observation(() => f.task(context.taskId)), hostTaskJournal, mcp,
    reception: { status: mcp.status === "KNOWN" && reception.length && reception.every(row => row.counts.status === "KNOWN") ? "KNOWN" : "UNKNOWN", processes: reception },
    readme: await fileEvidence(path.join(f.project, "README.md")), providerRequests: f.requests.map(({ body }) => body) };
  await saveRegressionEvidence("mcp-denial", snapshot);
  return snapshot;
}

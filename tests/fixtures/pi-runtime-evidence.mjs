import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// Opt-in process evidence. Inputs/credentials are synthetic and loopback-only.
// Receipts stay outside the repository and never claim installation/Provider proof.
export async function writePiEvidence(name, { sdk, ...observations }) {
  const output = process.env.OMP_PI130_EVIDENCE_ROOT;
  if (!output) return;
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  if (!path.isAbsolute(output) || !path.relative(repo, output).startsWith("..")) throw new Error("EXTERNAL_EVIDENCE_ROOT_REQUIRED");
  const hash = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex");
  const manifest = path.resolve(path.dirname(sdk), "../package.json");
  const manifestBytes = await fs.readFile(manifest).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  let piVersion = null;
  try { piVersion = JSON.parse(manifestBytes?.toString() ?? "null")?.version ?? null; } catch {} // Deliberately damaged admission inputs remain evidence.
  const copiedRoot = path.resolve(path.dirname(sdk), "../../only-my-pi/package");
  const sourceRoot = await fs.stat(copiedRoot).then(() => copiedRoot, () => repo);
  const files = ["packages/direct-agent/launcher.mjs", "packages/direct-agent/tui-runtime.mjs", "packages/direct-agent/session-entry.mjs", "packages/direct-agent/request-policy.mjs", "packages/direct-agent/codemode.mjs", "packages/mcp/native.mjs", "packages/host/rpc-worker.mjs", "packages/host/account-rpc-entry.mjs", "packages/host/pi-input-bridge.mjs"];
  if (observations.scope?.startsWith("CLIENT-01A")) files.push("package.json", "package-lock.json", "bin/omp.mjs", "packages/host/accounts.mjs", "packages/host/account-activity.mjs", "packages/host/account-auth.mjs", "packages/host/account-auth-worker.mjs", "packages/host/account-cli.mjs", "packages/host/account-oauth.mjs", "packages/host/account-oauth-worker.mjs", "packages/host/account-runtime.mjs", "packages/host/auth-process.mjs", "packages/host/tasks.mjs", "packages/host/server.mjs");
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await hash(path.join(sourceRoot, file))])));
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `${randomUUID()}.json`), JSON.stringify({ scope: "PI130-01_SOURCE_PROCESS_LOOPBACK_ONLY",
    case: name, node: { version: process.version, path: process.execPath, sha256: await hash(process.execPath) },
    pi: { version: piVersion, manifestSha256: manifestBytes && createHash("sha256").update(manifestBytes).digest("hex"), sdkSha256: await hash(sdk) },
    sourceRoot, sources, ...observations }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

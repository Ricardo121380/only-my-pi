// A fixed material replay; unresolved current conditions never admit this candidate.
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fail = code => { throw Error(code); };
const within = (file, root) => file === root || file.startsWith(root + path.sep);
const digest = bytes => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const exists = file => fs.lstat(file).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
const read = file => fs.readFile(file).catch(error => { if (error.code === "ENOENT") fail("GIR_CANDIDATE_INPUT_MISSING"); throw error; });
const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");

async function inventory(root, prefix = "", budget = { files: 0, bytes: 0, entries: 0 }) {
  const records = [];
  if (prefix.split("/").length > 24) fail("GIR_CANDIDATE_INPUT_BUDGET");
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    if (++budget.entries > 12000) fail("GIR_CANDIDATE_INPUT_BUDGET");
    if (name === ".git" || name.includes("\\")) fail("GIR_CANDIDATE_PATH_UNSAFE");
    const relative = prefix + name, file = path.join(root, relative), stat = await fs.lstat(file);
    if (stat.isDirectory()) { records.push(...await inventory(root, relative + "/", budget)); continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file) fail("GIR_CANDIDATE_PATH_UNSAFE");
    if (++budget.files > 10000 || stat.size > 512 * 1024 * 1024 || (budget.bytes += stat.size) > 3 * 1024 * 1024 * 1024) fail("GIR_CANDIDATE_INPUT_BUDGET");
    if ((stat.mode & 0o111) !== 0 && (stat.mode & 0o111) !== 0o111) fail("GIR_CANDIDATE_INPUT_DRIFT");
    const hash = crypto.createHash("sha256");
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    records.push({ path: relative, bytes: stat.size, sha256: "sha256:" + hash.digest("hex"), mode: stat.mode & 0o111 ? "100755" : "100644" });
  }
  return records;
}

async function verifyInputs(inputs, manifest, manifestSha256) {
  if (digest(await read(path.join(inputs, "manifest.json"))) !== manifestSha256) fail("GIR_CANDIDATE_MANIFEST_DRIFT");
  const actual = (await inventory(inputs)).filter(item => item.path !== "manifest.json");
  const expected = new Map(manifest.files.map(item => [item.path, item]));
  const names = new Set(actual.map(item => item.path));
  if (manifest.files.some(item => !names.has(item.path))) fail("GIR_CANDIDATE_INPUT_MISSING");
  if (expected.size !== manifest.files.length || actual.length !== expected.size || actual.some(item => !expected.has(item.path))) fail("GIR_CANDIDATE_UNREVIEWED_OVERLAY");
  for (const item of actual) {
    const pin = expected.get(item.path);
    if (item.sha256 !== pin.sha256 || item.bytes !== pin.bytes || item.mode !== pin.mode) fail("GIR_CANDIDATE_INPUT_DRIFT");
  }
}

export async function runGirCandidate(args) {
  const [inputs, output] = args;
  if (args.length !== 2 || ![inputs, output].every(value => value && path.isAbsolute(value) && path.resolve(value) === value)) fail("GIR_CANDIDATE_PATH_UNSAFE");
  if (await exists(output) || await exists(output + ".receipt.json")) fail("GIR_CANDIDATE_OUTPUT_EXISTS");
  if (await fs.realpath(inputs) !== inputs || await fs.realpath(path.dirname(output)) !== path.dirname(output) || within(output, inputs) || within(inputs, output) || within(output, repo) || within(repo, output)) fail("GIR_CANDIDATE_PATH_UNSAFE");
  const stat = await exists(path.join(inputs, "manifest.json"));
  if (!stat) fail("GIR_CANDIDATE_INPUT_MISSING");
  if (!stat.isFile() || stat.isSymbolicLink()) fail("GIR_CANDIDATE_PATH_UNSAFE");
  if (stat.size > 2 * 1024 * 1024) fail("GIR_CANDIDATE_INPUT_BUDGET");
  const raw = await read(path.join(inputs, "manifest.json")), manifest = JSON.parse(raw);
  if (manifest.purpose !== "GIR_MATERIAL_CANDIDATE_ONLY") fail("GIR_CANDIDATE_PURPOSE_DENIED");
  const recipe = JSON.parse(await fs.readFile(path.join(repo, "contracts/release/parser-resources-v1/native-gir-candidate.json")));
  if (recipe.protectedInputRoots.some(root => within(output, root) || within(root, output))) fail("GIR_CANDIDATE_PATH_UNSAFE");
  if (digest(raw) !== recipe.manifestSha256) fail("GIR_CANDIDATE_MANIFEST_DRIFT");
  if (recipe.protectedInputRoots.some(root => !path.isAbsolute(root) || path.resolve(root) !== root)) fail("GIR_CANDIDATE_PRIVATE_PATH_BINDINGS_REQUIRED");
  await verifyInputs(inputs, manifest, recipe.manifestSha256);
  const env = manifest.environment;
  const sw = flag => spawnSync("/usr/bin/sw_vers", [flag], { encoding: "utf8" }).stdout?.trim();
  if (process.platform !== "darwin" || process.arch !== env.architecture || os.release() !== env.kernelRelease || sw("-productVersion") !== env.macOS || sw("-buildVersion") !== env.buildVersion) fail("GIR_CANDIDATE_ENVIRONMENT_DRIFT");
  for (const item of env.externalFiles) {
    const bytes = await read(item.path);
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) fail("GIR_CANDIDATE_ENVIRONMENT_DRIFT");
  }
  const nodeBytes = await fs.readFile(process.execPath);
  const receipt = { formatVersion: 1, purpose: manifest.purpose, manifestSha256: recipe.manifestSha256, node: { version: process.version, path: process.execPath, sha256: digest(nodeBytes) }, runnerSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))), recipeSha256: digest(await fs.readFile(path.join(repo, "contracts/release/parser-resources-v1/native-gir-candidate.json"))), inputRoot: inputs, outputRoot: output, environment: env, commands: [], status: "FAIL", candidateAdmission: "BLOCKED", blockers: recipe.blockers, nativeBuild: "NOT_RUN", licensingClosure: "INCOMPLETE", Full: "NOT_RUN" };
  await fs.mkdir(output);
  const materials = path.join(output, "materials");
  try {
    await fs.cp(inputs, materials, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: true });
    if (digest(await read(path.join(materials, "manifest.json"))) !== recipe.manifestSha256) fail("GIR_CANDIDATE_MANIFEST_DRIFT");
    await verifyInputs(materials, manifest, recipe.manifestSha256);
    const command = ["/usr/bin/sandbox-exec", "-p", env.networkPolicy, "/usr/bin/python3", "config/generate.py", ".."];
    const result = spawnSync(command[0], command.slice(1), { cwd: materials, env: { ...env.fixedVariables, PATH: path.join(materials, "tools/xmlstarlet/bin") + ":" + path.join(materials, "tools/bin") + ":/usr/bin:/bin" }, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    receipt.commands.push({ command, cwd: materials, exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, ...(result.error ? { error: result.error.message } : {}) });
    if (result.status !== 0 || result.error) fail("GIR_CANDIDATE_GENERATION_FAILED");
    await verifyInputs(inputs, manifest, recipe.manifestSha256);
    await verifyInputs(materials, manifest, recipe.manifestSha256);
    receipt.outputFiles = await inventory(output);
    receipt.outputSha256 = digest(JSON.stringify(receipt.outputFiles));
    // Successful replay is technical evidence. The fixed recipe has unresolved
    // current copying/quotation conditions, so this entry cannot return PASS.
    receipt.generation = "PASS_TECHNICAL_REPLAY_ONLY";
    receipt.status = "PARTIAL_CURRENT_CONDITIONS_BLOCKED";
    process.exitCode = 2;
  } catch (error) {
    receipt.error = error.message;
    process.exitCode = 1;
  } finally {
    await fs.writeFile(output + ".receipt.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: receipt.status, generation: receipt.generation, candidateAdmission: receipt.candidateAdmission, blockers: receipt.blockers, outputFiles: receipt.outputFiles?.length, outputSha256: receipt.outputSha256, error: receipt.error, output, receipt: output + ".receipt.json", nativeBuild: "NOT_RUN", licensingClosure: "INCOMPLETE", Full: "NOT_RUN" }));
  }
}

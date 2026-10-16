// Material generation only. Execution diagnostics have their own immutable receipt.
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/u, "");
const fail = code => { throw Error(code); };
const digest = bytes => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const within = (file, root) => file === root || file.startsWith(root + path.sep);
const exists = file => fs.lstat(file).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
const read = file => fs.readFile(file).catch(error => { if (error.code === "ENOENT") fail("GENERATED_CANDIDATE_INPUT_MISSING"); throw error; });

async function inventory(root, prefix = "", budget = { files: 0, bytes: 0, entries: 0 }) {
  if (prefix.split("/").length > 30) fail("GENERATED_CANDIDATE_INPUT_BUDGET");
  const rows = [];
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    if (++budget.entries > 40000) fail("GENERATED_CANDIDATE_INPUT_BUDGET");
    if (name.toLowerCase() === ".git" || name.includes("\\")) fail("GENERATED_CANDIDATE_PATH_UNSAFE");
    const relative = prefix + name, file = path.join(root, relative), stat = await fs.lstat(file);
    if (stat.isDirectory()) { rows.push(...await inventory(root, relative + "/", budget)); continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file) fail("GENERATED_CANDIDATE_PATH_UNSAFE");
    if (++budget.files > 30000 || stat.size > 512 * 1024 * 1024 || (budget.bytes += stat.size) > 3 * 1024 * 1024 * 1024) fail("GENERATED_CANDIDATE_INPUT_BUDGET");
    if ((stat.mode & 0o111) !== 0 && (stat.mode & 0o111) !== 0o111) fail("GENERATED_CANDIDATE_INPUT_DRIFT");
    const hash = crypto.createHash("sha256");
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    rows.push({ path: relative, bytes: stat.size, sha256: "sha256:" + hash.digest("hex"), mode: stat.mode & 0o111 ? "100755" : "100644" });
  }
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

async function verifyInputs(root, manifest, pin) {
  if (digest(await read(path.join(root, "manifest.json"))) !== pin) fail("GENERATED_CANDIDATE_MANIFEST_DRIFT");
  const actual = (await inventory(root)).filter(row => row.path !== "manifest.json");
  const expected = new Map(manifest.files.map(row => [row.path, row]));
  const names = new Set(actual.map(row => row.path));
  if (manifest.files.some(row => !names.has(row.path))) fail("GENERATED_CANDIDATE_INPUT_MISSING");
  if (expected.size !== manifest.files.length || actual.length !== expected.size || actual.some(row => !expected.has(row.path))) fail("GENERATED_CANDIDATE_UNREVIEWED_OVERLAY");
  for (const row of actual) {
    const prior = expected.get(row.path);
    if (row.bytes !== prior.bytes || row.sha256 !== prior.sha256 || row.mode !== prior.mode) fail("GENERATED_CANDIDATE_INPUT_DRIFT");
  }
}

export async function runGeneratedCandidate(args) {
  const [inputs, output] = args;
  if (args.length !== 2 || ![inputs, output].every(value => value && path.isAbsolute(value) && path.resolve(value) === value)) fail("GENERATED_CANDIDATE_PATH_UNSAFE");
  const execution = output + ".execution", receiptFile = output + ".receipt.json";
  if (await exists(output) || await exists(execution) || await exists(receiptFile)) fail("GENERATED_CANDIDATE_OUTPUT_EXISTS");
  if (await fs.realpath(inputs) !== inputs || await fs.realpath(path.dirname(output)) !== path.dirname(output) || within(output, inputs) || within(inputs, output) || within(output, repo) || within(repo, output)) fail("GENERATED_CANDIDATE_PATH_UNSAFE");
  const stat = await exists(path.join(inputs, "manifest.json"));
  if (!stat) fail("GENERATED_CANDIDATE_INPUT_MISSING");
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) fail("GENERATED_CANDIDATE_PATH_UNSAFE");
  const raw = await read(path.join(inputs, "manifest.json")), manifest = JSON.parse(raw);
  if (manifest.purpose !== "GENERATED_INPUT_MATERIAL_CANDIDATE_ONLY") fail("GENERATED_CANDIDATE_PURPOSE_DENIED");
  const recipeBytes = await read(path.join(repo, "contracts/release/parser-resources-v1/native-generated-candidate.json"));
  if (digest(recipeBytes) !== "sha256:320f6560f2895eac1863dc7636e8b600ff34aaf8f759c56449543fffcbef4145") fail("GENERATED_CANDIDATE_RECIPE_DRIFT");
  const recipe = JSON.parse(recipeBytes);
  if (recipe.protectedInputRoots.some(root => within(output, root) || within(root, output))) fail("GENERATED_CANDIDATE_PATH_UNSAFE");
  await verifyInputs(inputs, manifest, recipe.manifestSha256);
  if (recipe.protectedInputRoots.some(root => !path.isAbsolute(root) || path.resolve(root) !== root)) fail("GENERATED_CANDIDATE_PRIVATE_PATH_BINDINGS_REQUIRED");
  const driver = path.join(repo, "scripts/probes/lib/generated-input-candidate.py");
  const driverBytes = await read(driver);
  if (digest(driverBytes) !== recipe.driverSha256) fail("GENERATED_CANDIDATE_DRIVER_DRIFT");
  const env = manifest.environment;
  const sw = flag => spawnSync("/usr/bin/sw_vers", [flag], { encoding: "utf8" }).stdout?.trim();
  if (process.platform !== "darwin" || process.arch !== env.architecture || os.release() !== env.kernelRelease || sw("-productVersion") !== env.macOS || sw("-buildVersion") !== env.buildVersion) fail("GENERATED_CANDIDATE_ENVIRONMENT_DRIFT");
  const verifyEnvironmentFiles = async () => {
    for (const row of env.externalFiles) {
      const bytes = await read(row.path);
      if (bytes.length !== row.bytes || digest(bytes) !== row.sha256) fail("GENERATED_CANDIDATE_ENVIRONMENT_DRIFT");
    }
  };
  await verifyEnvironmentFiles();
  const receipt = { formatVersion: 1, purpose: manifest.purpose, inputRoot: inputs, outputRoot: output, executionRoot: execution, manifestSha256: recipe.manifestSha256, recipeSha256: digest(recipeBytes), driverSha256: recipe.driverSha256, runnerSha256: digest(await read(fileURLToPath(import.meta.url))), node: { version: process.version, path: process.execPath, sha256: digest(await read(process.execPath)) }, environment: env, status: "FAIL", nativeBuild: "NOT_RUN", licensingClosure: "INCOMPLETE", Full: "NOT_RUN", U2: "BLOCKED" };
  await fs.mkdir(output);
  await fs.mkdir(execution);
  try {
    await fs.writeFile(path.join(execution, "driver.py"), driverBytes, { flag: "wx" });
    await fs.writeFile(path.join(execution, "recipe.json"), recipeBytes, { flag: "wx" });
    await fs.copyFile(fileURLToPath(import.meta.url), path.join(execution, "runner.mjs"));
    await fs.copyFile(path.join(repo, "scripts/probes/webui-g2-generated-inputs.mjs"), path.join(execution, "cli.mjs"));
    const materials = path.join(output, "materials");
    await fs.cp(inputs, materials, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: true });
    await verifyInputs(materials, manifest, recipe.manifestSha256);
    // The same deny-network and deny-write policy is used for every generator
    // and the independent network/write negative controls in acceptance.
    const policy = env.networkPolicy + `(allow file-write* (subpath ${JSON.stringify(output)}) (subpath ${JSON.stringify(execution)}) (literal "/dev/null"))`;
    receipt.sandboxPolicy = policy;
    const command = ["/usr/bin/sandbox-exec", "-p", policy, "/usr/bin/python3", "-B", path.join(execution, "driver.py"), materials, output, execution];
    const result = spawnSync(command[0], command.slice(1), { cwd: execution, env: { ...env.fixedVariables, PATH: "/usr/bin:/bin", HOME: execution, TMPDIR: execution }, encoding: "utf8", timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
    receipt.command = { command, exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, ...(result.error ? { error: result.error.message } : {}) };
    if (result.status !== 0 || result.error) fail("GENERATED_CANDIDATE_GENERATION_FAILED");
    await verifyInputs(inputs, manifest, recipe.manifestSha256);
    await verifyInputs(materials, manifest, recipe.manifestSha256);
    await verifyEnvironmentFiles();
    const report = JSON.parse(await read(path.join(output, "generation.json")));
    if (report.generatedObjects !== 3 || report.reusedAutoheaderTemplates !== 5 || report.macroFiles !== 111 || report.currentConditions !== "SATISFIED_LOCAL_PRIVATE_OPERATIONS") fail("GENERATED_CANDIDATE_SCOPE_DRIFT");
    receipt.outputFiles = await inventory(output);
    receipt.outputSha256 = digest(JSON.stringify(receipt.outputFiles));
    receipt.status = "PASS_MATERIAL_CANDIDATE";
  } catch (error) {
    receipt.error = error.message;
    process.exitCode = 1;
  } finally {
    receipt.executionFiles = await inventory(execution);
    receipt.executionSha256 = digest(JSON.stringify(receipt.executionFiles));
    await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: receipt.status, outputFiles: receipt.outputFiles?.length, outputSha256: receipt.outputSha256, error: receipt.error, output, receipt: receiptFile, nativeBuild: "NOT_RUN", licensingClosure: "INCOMPLETE", Full: "NOT_RUN" }));
  }
}

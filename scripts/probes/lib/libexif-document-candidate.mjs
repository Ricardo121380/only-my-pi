// Local document materials only. This does not admit a native kit or release.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fail = code => { throw Error(code); };
const within = (file, root) => file === root || file.startsWith(root + path.sep);
const digest = bytes => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const exists = file => fs.lstat(file).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
const read = file => fs.readFile(file).catch(error => { if (error.code === "ENOENT") fail("EXIF_CANDIDATE_INPUT_MISSING"); throw error; });
const recipeFile = fileURLToPath(new URL("../../../contracts/release/parser-resources-v1/native-libexif-document-candidate.json", import.meta.url));
const repo = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function inventory(root, prefix = "", budget = { files: 0, bytes: 0 }) {
  const records = [];
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    if (name === ".git" || name.includes("\\")) fail("EXIF_CANDIDATE_PATH_UNSAFE");
    const relative = prefix + name;
    const file = path.join(root, relative);
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) { records.push(...await inventory(root, relative + "/", budget)); continue; }
    let bytes, target;
    if (stat.isSymbolicLink()) {
      target = await fs.readlink(file);
      if (path.isAbsolute(target) || !within(path.resolve(path.dirname(file), target), root)) fail("EXIF_CANDIDATE_PATH_UNSAFE");
      // Preserve bounded dangling links in complete upstream source archives.
      const real = await fs.realpath(file).catch(error => { if (error.code !== "ENOENT") throw error; });
      if (real && !within(real, root)) fail("EXIF_CANDIDATE_PATH_UNSAFE");
      bytes = Buffer.from(target);
    } else {
      if (!stat.isFile() || stat.size > 128 * 1024 * 1024 || await fs.realpath(file) !== file) fail("EXIF_CANDIDATE_PATH_UNSAFE");
      // These fixed inputs use Git's two regular-file modes: all execute bits
      // present, or none. Reject a partial execute-bit change as drift too.
      if ((stat.mode & 0o111) !== 0 && (stat.mode & 0o111) !== 0o111) fail("EXIF_CANDIDATE_INPUT_DRIFT");
      bytes = await fs.readFile(file);
    }
    budget.files++;
    budget.bytes += bytes.length;
    if (budget.files > 20000 || budget.bytes > 1024 * 1024 * 1024) fail("EXIF_CANDIDATE_INPUT_BUDGET");
    records.push({ path: relative, bytes: bytes.length, sha256: digest(bytes), mode: target !== undefined ? "120000" : stat.mode & 0o111 ? "100755" : "100644", ...(target !== undefined ? { target } : {}) });
  }
  return records;
}

async function verifyInputs(inputs, manifest) {
  const records = (await inventory(inputs)).filter(item => item.path !== "manifest.json");
  const expected = new Map(manifest.files.map(item => [item.path, item]));
  const actual = new Set(records.map(item => item.path));
  if (manifest.files.some(item => !actual.has(item.path))) fail("EXIF_CANDIDATE_INPUT_MISSING");
  if (expected.size !== manifest.files.length || records.length !== expected.size || records.some(item => !expected.has(item.path))) fail("EXIF_CANDIDATE_UNREVIEWED_OVERLAY");
  for (const item of records) {
    const pin = expected.get(item.path);
    if (item.bytes !== pin.bytes || item.sha256 !== pin.sha256 || item.mode !== pin.mode || item.target !== pin.target) fail("EXIF_CANDIDATE_INPUT_DRIFT");
  }
  return records;
}

export async function runLibexifCandidate(args) {
  const [inputs, output] = args;
  if (args.length !== 2 || ![inputs, output].every(value => value && path.isAbsolute(value) && path.resolve(value) === value)) fail("EXIF_CANDIDATE_PATH_UNSAFE");
  if (await exists(output) || await exists(output + ".receipt.json")) fail("EXIF_CANDIDATE_OUTPUT_EXISTS");
  if (await fs.realpath(inputs) !== inputs || await fs.realpath(path.dirname(output)) !== path.dirname(output) || within(output, inputs) || within(inputs, output) || within(output, repo) || within(repo, output)) fail("EXIF_CANDIDATE_PATH_UNSAFE");
  const raw = await read(path.join(inputs, "manifest.json"));
  const manifest = JSON.parse(raw);
  if (manifest.purpose !== "LIBEXIF_DOCUMENT_CANDIDATE_ONLY") fail("EXIF_CANDIDATE_PURPOSE_DENIED");
  const recipe = JSON.parse(await fs.readFile(recipeFile));
  if (digest(raw) !== recipe.manifestSha256) fail("EXIF_CANDIDATE_MANIFEST_DRIFT");
  await verifyInputs(inputs, manifest);
  const env = manifest.environment;
  const sw = flag => spawnSync("/usr/bin/sw_vers", [flag], { encoding: "utf8" }).stdout?.trim();
  if (process.platform !== "darwin" || process.arch !== env.architecture || os.release() !== env.kernelRelease || sw("-productVersion") !== env.macOS || sw("-buildVersion") !== env.buildVersion) fail("EXIF_CANDIDATE_ENVIRONMENT_DRIFT");
  for (const item of env.externalFiles) {
    const bytes = await read(item.path);
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) fail("EXIF_CANDIDATE_ENVIRONMENT_DRIFT");
  }
  const receipt = { formatVersion: 1, purpose: manifest.purpose, manifestSha256: recipe.manifestSha256, node: process.version, inputRoot: inputs, outputRoot: output, environment: env, commands: [], status: "FAIL", nativeBuild: "NOT_RUN", licensingClosure: "INCOMPLETE", Full: "NOT_RUN" };
  await fs.mkdir(output);
  const materials = path.join(output, "materials");
  try {
    await fs.cp(inputs, materials, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    // Validate the bytes that will actually be read, after copying and before execution.
    if (digest(await read(path.join(materials, "manifest.json"))) !== recipe.manifestSha256) fail("EXIF_CANDIDATE_MANIFEST_DRIFT");
    await verifyInputs(materials, manifest);
    const run = (executable, arguments_) => {
      const command = ["/usr/bin/sandbox-exec", "-p", env.networkPolicy, executable, ...arguments_];
      const result = spawnSync(command[0], command.slice(1), { cwd: materials, env: env.fixedVariables, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
      receipt.commands.push({ command, cwd: materials, exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, ...(result.error ? { error: result.error.message } : {}) });
      if (result.status !== 0 || result.error) fail("EXIF_CANDIDATE_TOOL_FAILED");
      return result;
    };
    const doxygen = "tools/doxygen/bin/doxygen", dot = "tools/graphviz/bin/dot";
    if (run(doxygen, ["-v"]).stdout.trim() !== recipe.versions.doxygen || !run(dot, ["-V"]).stderr.includes("graphviz version " + recipe.versions.graphviz + " ")) fail("EXIF_CANDIDATE_TOOL_VERSION_DRIFT");
    await fs.mkdir(path.join(output, "configuration"));
    const effective = run(doxygen, ["-x_noenv", "config/Doxyfile"]);
    await fs.writeFile(path.join(output, "configuration/effective-config-diff.txt"), effective.stdout, { flag: "wx" });
    run(doxygen, ["config/Doxyfile"]);
    const docs = path.join(output, "documentation/libexif-api.html");
    const repair = JSON.parse(await read(path.join(materials, "config/reviewed-crawler-link-repair.json")));
    const helper = path.join(docs, "doxygen_crawl.html");
    const original = await fs.readFile(helper);
    if (repair.review !== "REVIEWED_EXACT_CRAWLER_LINK_REPAIR" || digest(original) !== repair.beforeSha256) fail("EXIF_CANDIDATE_OVERLAY_PRECONDITION_DRIFT");
    let repaired = original.toString("utf8");
    for (const item of repair.replacements) {
      const before = 'href="' + item.before + '"';
      if (repaired.split(before).length !== 2) fail("EXIF_CANDIDATE_OVERLAY_PRECONDITION_DRIFT");
      repaired = repaired.replace(before, 'href="' + item.after + '"');
    }
    repaired = repair.notice + repaired;
    if (digest(repaired) !== repair.afterSha256) fail("EXIF_CANDIDATE_OVERLAY_RESULT_DRIFT");
    await fs.mkdir(path.join(output, "raw-documentation"));
    await fs.writeFile(path.join(output, "raw-documentation/doxygen_crawl.html"), original, { flag: "wx" });
    await fs.writeFile(helper, repaired);
    receipt.transforms = [{ recipe: "materials/config/reviewed-crawler-link-repair.json", beforeSha256: digest(original), afterSha256: digest(repaired), replacements: repair.replacements.length, rawRetained: "raw-documentation/doxygen_crawl.html" }];
    const generated = await inventory(docs);
    const names = new Set(generated.map(item => item.path));
    for (const name of ["doxygen.css", "index.html", "files.html", "globals.html", ...recipe.graphs]) if (!names.has(name)) fail("EXIF_CANDIDATE_OUTPUT_INCOMPLETE");
    await fs.mkdir(path.join(output, "graph-renders"));
    for (const name of recipe.graphs) {
      const input = "../documentation/libexif-api.html/" + name.replace(/\.svg$/u, ".dot");
      if (!names.has(name.replace(/\.svg$/u, ".dot"))) fail("EXIF_CANDIDATE_DOT_INPUT_MISSING");
      run(dot, ["-Tsvg", input, "-o", "../graph-renders/" + name]);
    }
    await verifyInputs(inputs, manifest);
    await verifyInputs(materials, manifest);
    const binding = { formatVersion: 1, purpose: manifest.purpose, manifestSha256: recipe.manifestSha256, versions: recipe.versions, generatedFiles: generated, generationInputs: manifest.files.filter(item => item.path.startsWith("source/exif/libexif/") || item.path.startsWith("source/doxygen/templates/") || item.path.startsWith("config/") || item.path === "tools/doxygen/bin/doxygen" || item.path === "tools/graphviz/bin/dot"), transforms: receipt.transforms, graphs: recipe.graphs.map(name => ({ svg: name, dot: name.replace(/\.svg$/u, ".dot"), replay: "graph-renders/" + name })), historicalEffectiveConfig: "UNVERIFIED", historicalDotInputs: "UNBOUND", nativeBuild: "NOT_RUN", licensingClosure: "INCOMPLETE", Full: "NOT_RUN" };
    await fs.writeFile(path.join(output, "generation-bindings.json"), JSON.stringify(binding, null, 2) + "\n", { flag: "wx" });
    receipt.outputFiles = await inventory(output);
    receipt.outputSha256 = digest(JSON.stringify(receipt.outputFiles));
    receipt.status = "PASS_LOCAL_DOCUMENT_GENERATION";
  } catch (error) {
    receipt.error = error.message;
    process.exitCode = 1;
  } finally {
    await fs.writeFile(output + ".receipt.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: receipt.status, outputSha256: receipt.outputSha256, outputFiles: receipt.outputFiles?.length, error: receipt.error, output, receipt: output + ".receipt.json", nativeBuild: "NOT_RUN", Full: "NOT_RUN" }));
  }
}

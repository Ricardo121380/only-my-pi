// Legacy fixed ledger, or explicit --candidate execution from frozen inputs.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code) => { throw Error(code); };
const within = (file, root) => file === root || file.startsWith(root + path.sep);
const exists = async (file) => fs.lstat(file).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
const safe = (name) => typeof name === "string" && /^[A-Za-z0-9_./@+~\-]+$/u.test(name) && !name.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
let inputBytes = 0;

async function read(root, name, pin, drift = "GENERATED_INPUT_BYTES_DRIFT") {
  if (!safe(name)) fail("GENERATED_INPUT_PATH_UNSAFE");
  const file = path.join(root, name);
  const stat = await exists(file);
  if (!stat) fail("GENERATED_INPUT_MISSING");
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024 || await fs.realpath(file) !== file) fail("GENERATED_INPUT_PATH_UNSAFE");
  inputBytes += stat.size;
  if (inputBytes > 256 * 1024 * 1024) fail("GENERATED_INPUT_BUDGET");
  const bytes = await fs.readFile(file);
  const item = { path: name, bytes: bytes.length, sha256: sha256(bytes), mode: stat.mode & 0o111 ? "100755" : "100644" };
  if (pin && (item.sha256 !== pin.sha256 || pin.bytes !== undefined && item.bytes !== pin.bytes || item.mode !== pin.mode)) fail(drift);
  return { bytes, item };
}

async function verifySet(root, expected) {
  if (!Array.isArray(expected) || expected.length > 2048 || new Set(expected.map((entry) => entry.path)).size !== expected.length) fail("GENERATED_INPUT_SET_DRIFT");
  const names = [];
  let entries = 0;
  async function scan(prefix = "") {
    if (prefix.split("/").length > 20) fail("GENERATED_INPUT_BUDGET");
    for (const name of await fs.readdir(path.join(root, prefix))) {
      if (++entries > 4096) fail("GENERATED_INPUT_BUDGET");
      const relative = prefix + name;
      if (!safe(relative)) fail("GENERATED_INPUT_PATH_UNSAFE");
      const stat = await fs.lstat(path.join(root, relative));
      if (stat.isSymbolicLink()) fail("GENERATED_INPUT_PATH_UNSAFE");
      if (stat.isDirectory()) await scan(relative + "/");
      else if (stat.isFile()) names.push(relative);
      else fail("GENERATED_INPUT_PATH_UNSAFE");
    }
  }
  await scan();
  if (JSON.stringify(names.sort()) !== JSON.stringify(expected.map((entry) => entry.path).sort())) fail("GENERATED_INPUT_SET_DRIFT");
  const files = new Map();
  for (const entry of expected) files.set(entry.path, await read(root, entry.path, entry));
  return files;
}

async function run() {
  const [kit, notices, origins, output] = process.argv.slice(2);
  const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
  if (process.argv.length !== 6 || ![kit, notices, origins, output].every((root) => root && path.isAbsolute(root) && path.resolve(root) === root)) fail("GENERATED_INPUT_PATH_UNSAFE");
  if (await exists(output)) fail("GENERATED_INPUT_OUTPUT_EXISTS");
  for (const input of [kit, notices, origins]) {
    if (await fs.realpath(input) !== input || within(output, input) || within(input, output)) fail("GENERATED_INPUT_PATH_UNSAFE");
  }
  if (within(output, repo) || within(repo, output) || await fs.realpath(path.dirname(output)) !== path.dirname(output)) fail("GENERATED_INPUT_PATH_UNSAFE");
  const recipeBytes = await fs.readFile(path.join(repo, "contracts/release/parser-resources-v1/native-generated-inputs.json"));
  if (sha256(recipeBytes) !== "sha256:8efe7810e87ddf1a1d241ff3be5beeb779e254996be452fd552cdb855a8b1200") fail("GENERATED_INPUT_RECIPE_DRIFT");
  const recipe = JSON.parse(recipeBytes);
  const kitReceipt = await read(kit, "kit.json", recipe.kit.receipt, "GENERATED_INPUT_KIT_DRIFT");
  if (JSON.parse(kitReceipt.bytes).kitSha256 !== recipe.kit.id) fail("GENERATED_INPUT_KIT_DRIFT");
  const inventoryFile = await read(kit, "source-inventory.json", recipe.kit.sourceInventory);
  const inventory = new Map(JSON.parse(inventoryFile.bytes));
  if (inventory.size !== 29336) fail("GENERATED_INPUT_KIT_DRIFT");
  const overlay = await read(kit, "generated-overlays.json", recipe.kit.configureOverlay, "GENERATED_INPUT_OVERLAY_DRIFT");
  const priorFile = await read(notices, "generated-notices.json", recipe.prior.report, "GENERATED_INPUT_PRIOR_DRIFT");
  const prior = JSON.parse(priorFile.bytes);
  if (prior.ledger.length !== 368 || prior.completeGeneratorMacroFilesRetained !== 111 || sha256(JSON.stringify(prior.supplement)) !== recipe.prior.supplementSha256) fail("GENERATED_INPUT_PRIOR_DRIFT");
  const priorSet = await verifySet(path.join(notices, "supplement"), Object.entries(prior.supplement).map(([name, pin]) => ({ path: name, ...pin })));
  const originInventory = await read(origins, "inventory.json", recipe.originsInventory);
  const originPins = JSON.parse(originInventory.bytes).files;
  if (originPins.length !== recipe.originsFiles) fail("GENERATED_INPUT_SET_DRIFT");
  const originSet = await verifySet(origins, [...originPins, { path: "inventory.json", ...recipe.originsInventory }]);
  const copies = new Map();
  for (const [name, file] of priorSet) copies.set("prior/" + name, file);
  for (const [name, file] of originSet) copies.set("origins/" + name, file);
  const source = new Map();
  async function getSource(name) {
    if (source.has(name)) return source.get(name);
    const binding = inventory.get(name);
    if (!binding) fail("GENERATED_INPUT_SOURCE_UNBOUND");
    const file = await read(path.join(kit, "sources"), name, binding);
    source.set(name, file);
    // Matching prior bytes stay in their original, independently frozen scope.
    const retained = priorSet.get("source/" + name);
    if (retained) {
      if (!retained.bytes.equals(file.bytes) || retained.item.mode !== file.item.mode) fail("GENERATED_INPUT_OVERLAY_DRIFT");
    } else copies.set("source/" + name, file);
    return file;
  }
  for (const row of prior.ledger) {
    const file = await getSource(row.path);
    if (file.item.sha256 !== row.sha256 || file.item.bytes !== row.bytes || file.item.mode !== row.mode) fail("GENERATED_INPUT_OVERLAY_DRIFT");
  }
  for (const pin of recipe.sourceInputs) {
    const file = await getSource(pin.path);
    if (file.item.sha256 !== pin.sha256 || file.item.bytes !== pin.bytes || file.item.mode !== pin.mode) fail("GENERATED_INPUT_BYTES_DRIFT");
  }
  const families = {};
  for (const row of recipe.macroRows) {
    const candidate = await getSource(row.path);
    const retained = copies.get(row.completeNoticeMaterial);
    if (!retained || !retained.bytes.equals(candidate.bytes)) fail("GENERATED_INPUT_MACRO_DRIFT");
    for (const name of row.toolMaterials) if (!originSet.has(name)) fail("GENERATED_INPUT_SOURCE_UNBOUND");
    for (const binding of row.exactMembers) {
      if (!originSet.get(binding.member)?.bytes.equals(candidate.bytes)) fail("GENERATED_INPUT_MACRO_DRIFT");
    }
    for (const name of [...row.packageInputs, ...row.aggregateIncludes]) await getSource(name);
    families[row.family] = (families[row.family] ?? 0) + 1;
  }
  if (recipe.macroRows.length !== 111 || new Set(recipe.macroRows.map((row) => row.path)).size !== 111 || JSON.stringify(Object.entries(families).sort()) !== JSON.stringify(Object.entries(recipe.families).sort())) fail("GENERATED_INPUT_MACRO_DRIFT");
  for (const tool of recipe.tools) {
    const file = originSet.get(tool.archive);
    if (!file || file.item.sha256 !== tool.archivePin.sha256 || file.item.bytes !== tool.archivePin.bytes) fail("GENERATED_INPUT_TOOL_DRIFT");
    for (const name of tool.noticeMaterials) if (!originSet.has(name)) fail("GENERATED_INPUT_SOURCE_UNBOUND");
  }
  let autoheaderReplays = 0;
  if (recipe.remainingInputs.length !== 8) fail("GENERATED_INPUT_RULE_DRIFT");
  for (const row of recipe.remainingInputs) {
    const candidate = await getSource(row.path);
    if (candidate.item.sha256 !== row.candidate.sha256) fail("GENERATED_INPUT_RULE_DRIFT");
    for (const name of row.inputMaterials) await getSource(name);
    for (const name of row.toolMaterials) if (!originSet.has(name)) fail("GENERATED_INPUT_SOURCE_UNBOUND");
    if (row.replayMaterials) {
      if (row.replayMaterials.length !== 2 || row.replay.some((run) => run.exit !== 0 || run.sha256 !== candidate.item.sha256 || run.network !== "DENIED")) fail("GENERATED_INPUT_REPLAY_DRIFT");
      for (const name of row.replayMaterials) if (!originSet.get(name)?.bytes.equals(candidate.bytes)) fail("GENERATED_INPUT_REPLAY_DRIFT");
      autoheaderReplays++;
    }
  }
  if (autoheaderReplays !== 5) fail("GENERATED_INPUT_REPLAY_DRIFT");
  const bytes = (name) => source.get(name).bytes;
  const spec = bytes("exif/libexif.spec.in").toString().replace(/^Name: @PACKAGE@$/mu, "Name: libexif").replace(/^Version: @VERSION@$/mu, "Version: 0.6.26");
  const stdintSource = bytes("exif/m4m/stdint.m4").toString();
  const marker = 'AX_CHECK_DEFINED_TYPE(uint8_t,\nstdint.h,\n[\ncat > "$1" <<EOF\n';
  const stdint = stdintSource.split(marker)[1]?.split("EOF],")[0];
  if (!bytes("ffi/doc/stamp-vti").equals(bytes("ffi/doc/version.texi")) || !bytes("exif/libexif.spec").equals(Buffer.from(spec)) || !stdint || !bytes("exif/libexif/_stdint.h").equals(Buffer.from(stdint))) fail("GENERATED_INPUT_STATIC_DRIFT");
  const plain = (wire) => ({ bytes: wire, item: { bytes: wire.length, sha256: sha256(wire), mode: "100644" } });
  copies.set("recipe.json", plain(recipeBytes));
  copies.set("prior-generated-notices.json", priorFile);
  copies.set("kit-receipt.json", kitReceipt);
  copies.set("source-inventory.json", inventoryFile);
  copies.set("generated-overlays.json", overlay);
  const report = {
    at: new Date().toISOString(), status: "PARTIAL", validation: "NOT_COMPLETED", issue: 22, task: "G2-00-02", requirements: recipe.requirements,
    recipeSha256: sha256(recipeBytes), probeSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))), kitId: recipe.kit.id,
    sourceInventorySha256: inventoryFile.item.sha256, selectedSourceFilesRehashed: source.size, wholeKitRevalidation: "NOT_RUN",
    priorSupplementSha256: recipe.prior.supplementSha256, originsInventorySha256: originInventory.item.sha256,
    macroRows: recipe.macroRows, families, tools: recipe.tools, remainingInputs: recipe.remainingInputs, autoheaderReplays,
    staticCorrespondences: 3, historicalGeneratorInvocations: "UNVERIFIED", distribution: recipe.distribution, pending: recipe.pending,
    issueCompletion: "PARTIAL", licensingClosure: "INCOMPLETE", generatorExecution: "FIVE_HEADERS_REPLAYED_TWICE_OTHER_GENERATORS_NOT_RUN",
    nativeBuild: "NOT_RUN", Full: "NOT_RUN", U2: "BLOCKED"
  };
  // All input and scope checks finish before the new output is created.
  await fs.mkdir(output, { mode: 0o700 });
  const supplement = path.join(output, "supplement");
  try {
    await fs.mkdir(supplement, { mode: 0o700 });
    const expected = [];
    for (const [name, file] of [...copies].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const destination = path.join(supplement, name);
      const mode = file.item.mode === "100755" ? 0o755 : 0o644;
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, file.bytes, { flag: "wx", mode });
      await fs.chmod(destination, mode);
      expected.push({ ...file.item, path: name });
    }
    const copied = await verifySet(supplement, expected);
    report.supplement = [...copied.values()].map((file) => file.item).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    report.supplementSha256 = sha256(JSON.stringify(report.supplement));
    report.validation = "PASS_FIXED_GENERATED_INPUT_AND_CONDITIONS_LEDGER_ONLY";
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    report.inputBytes = inputBytes;
    await fs.writeFile(path.join(output, "generated-inputs.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, validation: report.validation, macroFiles: recipe.macroRows.length, remainingInputs: 8, autoheaderReplays, supplementFiles: report.supplement?.length, supplementSha256: report.supplementSha256, issueCompletion: report.issueCompletion, error: report.error, output }));
  }
}

await (process.argv[2] === "--candidate"
  ? import("./lib/generated-input-candidate.mjs").then(({ runGeneratedCandidate }) => runGeneratedCandidate(process.argv.slice(3)))
  : run()).catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error.message }));
  process.exitCode = 1;
});

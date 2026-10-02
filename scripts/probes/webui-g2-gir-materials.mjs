// Fixed GIR material evidence. This CLI never fetches or executes upstream code.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const fail = (code) => { throw Error(code); };
const within = (file, root) => file === root || file.startsWith(root + path.sep);
const exists = async (file) => fs.lstat(file).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
const sha256 = (bytes) => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
let inputBytes = 0;

async function read(root, name, pin, drift = "GIR_MATERIAL_INPUT_DRIFT") {
  if (!/^[A-Za-z0-9_./+\-]+$/u.test(name) || name.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) fail("GIR_MATERIAL_PATH_UNSAFE");
  const file = path.join(root, name);
  const stat = await exists(file);
  if (!stat) fail("GIR_MATERIAL_INPUT_MISSING");
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024 || await fs.realpath(file) !== file) fail("GIR_MATERIAL_PATH_UNSAFE");
  inputBytes += stat.size;
  if (inputBytes > 256 * 1024 * 1024) fail("GIR_MATERIAL_INPUT_BUDGET");
  const bytes = await fs.readFile(file);
  const item = { path: name, sha256: sha256(bytes), bytes: bytes.length, mode: stat.mode & 0o111 ? "100755" : "100644" };
  if (pin && (item.sha256 !== pin.sha256 || pin.bytes !== undefined && item.bytes !== pin.bytes || pin.mode !== undefined && item.mode !== pin.mode)) fail(drift);
  return { bytes, item };
}

async function listFiles(root, prefix = "", files = [], budget = { entries: 0 }) {
  if (prefix.split("/").length > 16) fail("GIR_MATERIAL_FILE_BUDGET");
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    if (++budget.entries > 512) fail("GIR_MATERIAL_FILE_BUDGET");
    const relative = prefix + name;
    const stat = await fs.lstat(path.join(root, relative));
    if (stat.isSymbolicLink()) fail("GIR_MATERIAL_PATH_UNSAFE");
    if (stat.isDirectory()) await listFiles(root, relative + "/", files, budget);
    else {
      files.push(relative);
      if (files.length > 256) fail("GIR_MATERIAL_FILE_BUDGET");
    }
  }
  return files;
}

async function verifySet(root, expected) {
  if (!Array.isArray(expected) || expected.length > 256 || new Set(expected.map((entry) => entry.path)).size !== expected.length) fail("GIR_MATERIAL_SET_DRIFT");
  const names = await listFiles(root);
  if (JSON.stringify(names.sort()) !== JSON.stringify(expected.map((entry) => entry.path).sort())) fail("GIR_MATERIAL_SET_DRIFT");
  const files = new Map();
  for (const entry of expected) files.set(entry.path, await read(root, entry.path, entry));
  return files;
}

function verifyOrigins(files, recipe) {
  const receipts = JSON.parse(files.get("acquisition/requests.json").bytes);
  for (const receipt of receipts) {
    const material = files.get(receipt.path);
    if (!material || receipt.sha256 !== material.item.sha256 || receipt.bytes !== material.item.bytes || !receipt.url.startsWith("https://")) fail("GIR_MATERIAL_ORIGIN_DRIFT");
  }
  const commit = JSON.parse(files.get("acquisition/gir-commit.json").bytes);
  const tree = JSON.parse(files.get("acquisition/gir-tree.json").bytes);
  const blobs = new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry]));
  if (commit.sha !== recipe.fixedCommit || commit.commit.tree.sha !== recipe.fixedTree || tree.sha !== recipe.fixedTree || tree.truncated || blobs.size !== 53) fail("GIR_MATERIAL_ORIGIN_DRIFT");
  for (const expected of recipe.fixedFiles) {
    const file = files.get("snapshot/" + expected.path);
    const blob = blobs.get(expected.path);
    const actualBlob = crypto.createHash("sha1").update(Buffer.from("blob " + file.bytes.length + "\0")).update(file.bytes).digest("hex");
    if (actualBlob !== expected.gitBlob || blob?.sha !== actualBlob || blob.mode !== expected.mode || file.item.sha256 !== expected.sha256) fail("GIR_MATERIAL_ORIGIN_DRIFT");
  }
  const run = JSON.parse(files.get("acquisition/ci-run.json").bytes);
  const jobs = JSON.parse(files.get("acquisition/ci-jobs.json").bytes);
  const artifacts = JSON.parse(files.get("acquisition/ci-artifacts.json").bytes);
  const generated = JSON.parse(files.get("acquisition/generated-commit.json").bytes);
  if (run.id !== recipe.ciRun.id || run.head_sha !== recipe.ciRun.headSha || run.conclusion !== "success" || !jobs.jobs.some((job) => job.id === recipe.ciRun.jobId && job.run_id === run.id) || artifacts.total_count !== 0 || generated.sha !== recipe.ciRun.generatedCommit || !generated.parents.some((parent) => parent.sha === run.head_sha)) fail("GIR_MATERIAL_ORIGIN_DRIFT");
  const logs = receipts.find((receipt) => receipt.path === "acquisition/ci-logs-response.json");
  if (logs?.status !== 403) fail("GIR_MATERIAL_ORIGIN_DRIFT");
  const prior = JSON.parse(files.get("prior-review.json").bytes);
  if (prior.commit !== recipe.fixedCommit || prior.tracked.length !== 53 || prior.girFiles !== 40 || recipe.fixedFiles.some((file) => !prior.tracked.some((entry) => entry.path === file.path && entry.sha256 === file.sha256))) fail("GIR_MATERIAL_PRIOR_DRIFT");
  const glib = JSON.parse(files.get("acquisition/glib-287-commit.json").bytes);
  const gnu = JSON.parse(files.get("acquisition/gnu-libc-223-commit.json").bytes);
  if (glib.sha !== recipe.glibComparatorCommit || gnu.sha !== recipe.gnuComparatorCommit || files.get("acquisition/glib-287/COPYING").bytes.toString() !== "LICENSES/LGPL-2.1-or-later.txt") fail("GIR_MATERIAL_ORIGIN_DRIFT");
}

const normalize = (text) => text.replace(/\s+/gu, " ").trim();
const xmlText = (text) => text.replace(/&#x([0-9A-Fa-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gu, (_, hex, decimal, named) => named ? { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named] : String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10)));

function slice(files, reference) {
  const file = files.get(reference.path);
  if (!file || !Number.isInteger(reference.startByte) || !Number.isInteger(reference.endByteExclusive) || reference.startByte < 0 || reference.endByteExclusive <= reference.startByte || reference.endByteExclusive > file.bytes.length) fail("GIR_MATERIAL_QUOTE_DRIFT");
  const bytes = file.bytes.subarray(reference.startByte, reference.endByteExclusive);
  if (sha256(bytes) !== reference.sha256) fail("GIR_MATERIAL_QUOTE_DRIFT");
  return bytes.toString("utf8");
}

function verifyQuotes(candidate, origins, recipe) {
  if (recipe.quotes.length !== 25) fail("GIR_MATERIAL_QUOTE_DRIFT");
  for (const quote of [...recipe.quotes, recipe.attribution]) {
    const gir = normalize(xmlText(slice(candidate, quote.gir)));
    const source = normalize(slice(origins, quote.source).replace(/^ \* ?/gmu, ""));
    if (gir !== source || quote.normalizedSha256 && sha256(gir) !== quote.normalizedSha256) fail("GIR_MATERIAL_QUOTE_DRIFT");
    if (quote.manualSection) slice(origins, quote.manualSection);
  }
}

async function run() {
  const [kit, origins, output] = process.argv.slice(2);
  const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
  if (process.argv.length !== 5 || ![kit, origins, output].every((root) => root && path.isAbsolute(root) && path.resolve(root) === root)) fail("GIR_MATERIAL_PATH_UNSAFE");
  if (await exists(output)) fail("GIR_MATERIAL_OUTPUT_EXISTS");
  for (const input of [kit, origins]) {
    if (await fs.realpath(input) !== input || within(output, input) || within(input, output)) fail("GIR_MATERIAL_PATH_UNSAFE");
  }
  if (within(kit, origins) || within(origins, kit)) fail("GIR_MATERIAL_PATH_UNSAFE");
  if (within(output, repo) || within(repo, output) || await fs.realpath(path.dirname(output)) !== path.dirname(output)) fail("GIR_MATERIAL_PATH_UNSAFE");
  const recipeBytes = (await read(repo, "contracts/release/parser-resources-v1/native-gir-materials.json", { sha256: "sha256:dcace8f94c42e8a175abbd2cc3a501bb7fab98e246c19b4fa2497853ccda46cd" }, "GIR_MATERIAL_RECIPE_DRIFT")).bytes;
  const recipe = JSON.parse(recipeBytes);
  const kitReceipt = await read(kit, "kit.json", recipe.kit.receipt, "GIR_MATERIAL_KIT_DRIFT");
  const sourceInventory = await read(kit, "source-inventory.json", recipe.kit.sourceInventory);
  if (JSON.parse(kitReceipt.bytes).kitSha256 !== recipe.kit.id) fail("GIR_MATERIAL_KIT_DRIFT");
  const candidate = await verifySet(path.join(kit, recipe.kit.girPrefix), recipe.fixedFiles);
  const sourceRecords = new Map(JSON.parse(sourceInventory.bytes));
  for (const file of recipe.fixedFiles) {
    const binding = sourceRecords.get("rsvg/librsvg-rebind/gir-files/" + file.path);
    if (binding?.sha256 !== file.sha256 || binding.mode !== file.mode) fail("GIR_MATERIAL_KIT_DRIFT");
  }
  const originInventory = await read(origins, "inventory.json", recipe.originsInventory);
  const originFiles = JSON.parse(originInventory.bytes).files;
  if (originFiles.length !== recipe.originFiles) fail("GIR_MATERIAL_SET_DRIFT");
  const originSet = await verifySet(origins, [...originFiles, recipe.originsInventory]);
  verifyOrigins(originSet, recipe);
  verifyQuotes(candidate, originSet, recipe);
  const report = {
    at: new Date().toISOString(), status: "PARTIAL", validation: "NOT_COMPLETED", issue: recipe.issue, task: recipe.task, requirements: recipe.requirements,
    recipeSha256: sha256(recipeBytes), probeSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))), kitId: recipe.kit.id,
    sourceInventorySha256: sourceInventory.item.sha256, wholeKitRevalidation: "NOT_RUN", originsInventorySha256: originInventory.item.sha256,
    fixedCommit: recipe.fixedCommit, fixedTree: recipe.fixedTree, fixedFiles: recipe.fixedFiles, rows: recipe.rows, ciRun: recipe.ciRun,
    transformations: recipe.transformations, quotes: recipe.quotes, attribution: recipe.attribution, quoteReviewScope: recipe.quoteReviewScope,
    quoteCorrespondence: "PASS_25_MEMBERS_AND_ATTRIBUTION_WITH_FIXED_GLIB_COMPARATOR_ONLY", distribution: recipe.distribution, pending: recipe.pending,
    originalSupplierInputs: "NOT_ACQUIRED", actualOriginalToGirReplay: "BLOCKED", historicalManualVersion: "UNVERIFIED", licensingClosure: "INCOMPLETE",
    issueCompletion: "PARTIAL", generatorExecution: "NOT_RUN", nativeBuild: "NOT_RUN", Full: "NOT_RUN", U2: "BLOCKED"
  };
  // Verify all fixed evidence before creating the output. A partial ledger must
  // remain distinguishable from missing or altered evidence, which exits 1.
  await fs.mkdir(output, { mode: 0o700 });
  const supplement = path.join(output, "supplement");
  const copies = new Map();
  for (const [name, file] of candidate) copies.set("candidate/" + name, file);
  for (const [name, file] of originSet) copies.set("origins/" + name, file);
  copies.set("kit-receipt.json", kitReceipt);
  copies.set("source-inventory.json", sourceInventory);
  copies.set("recipe.json", { bytes: recipeBytes, item: { sha256: sha256(recipeBytes), bytes: recipeBytes.length, mode: "100644" } });
  try {
    await fs.mkdir(supplement, { mode: 0o700 });
    for (const [name, file] of copies) {
      const destination = path.join(supplement, name);
      const mode = file.item.mode === "100755" ? 0o755 : 0o644;
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, file.bytes, { flag: "wx", mode });
      await fs.chmod(destination, mode);
    }
    const copied = await verifySet(supplement, [...copies].map(([name, file]) => ({ ...file.item, path: name })));
    report.supplement = [...copied.values()].map((file) => file.item).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    report.supplementSha256 = sha256(JSON.stringify(report.supplement));
    report.validation = "PASS_FIXED_GIR_MATERIALS_AND_COMPARATOR_LEDGER_ONLY";
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    report.inputBytes = inputBytes;
    await fs.writeFile(path.join(output, "gir-materials.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, validation: report.validation, girFiles: report.rows.length, fixedFiles: recipe.fixedFiles.length, supplementFiles: report.supplement?.length, supplementSha256: report.supplementSha256, issueCompletion: report.issueCompletion, error: report.error, output }));
  }
}

await run().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error.message }));
  process.exitCode = 1;
});

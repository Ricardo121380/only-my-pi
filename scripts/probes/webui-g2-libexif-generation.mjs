// Legacy fixed-material ledger, or --candidate for pinned local tool execution.
// Neither mode admits a native kit or release.
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
const relativePath = (value) => typeof value === "string" && /^[A-Za-z0-9_./@+~\-]+$/u.test(value) && !value.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
let inputBytes = 0;

async function read(root, name, pin, drift = "EXIF_GENERATION_INPUT_DRIFT") {
  if (!relativePath(name)) fail("EXIF_GENERATION_PATH_UNSAFE");
  const file = path.join(root, name);
  const stat = await exists(file);
  if (!stat) fail("EXIF_GENERATION_INPUT_MISSING");
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024 || await fs.realpath(file) !== file) fail("EXIF_GENERATION_PATH_UNSAFE");
  inputBytes += stat.size;
  if (inputBytes > 64 * 1024 * 1024) fail("EXIF_GENERATION_INPUT_BUDGET");
  const bytes = await fs.readFile(file);
  const item = { path: name, sha256: sha256(bytes), bytes: bytes.length, mode: stat.mode & 0o111 ? "100755" : "100644" };
  if (pin && (item.sha256 !== pin.sha256 || pin.bytes !== undefined && item.bytes !== pin.bytes || pin.mode !== undefined && item.mode !== pin.mode)) fail(drift);
  return { item, bytes };
}

async function inventory(root, prefix = "") {
  const files = [];
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    const relative = prefix + name;
    if (!relativePath(relative)) fail("EXIF_GENERATION_PATH_UNSAFE");
    const stat = await fs.lstat(path.join(root, relative));
    if (stat.isSymbolicLink()) fail("EXIF_GENERATION_PATH_UNSAFE");
    if (stat.isDirectory()) files.push(...await inventory(root, relative + "/"));
    else files.push((await read(root, relative)).item);
    if (files.length > 1024) fail("EXIF_GENERATION_FILE_BUDGET");
  }
  return files;
}

async function verifySet(root, expected) {
  if (!Array.isArray(expected) || expected.length > 1024 || new Set(expected.map((entry) => entry.path)).size !== expected.length) fail("EXIF_GENERATION_SET_DRIFT");
  const actual = await inventory(root);
  if (JSON.stringify(actual.map((entry) => entry.path).sort()) !== JSON.stringify(expected.map((entry) => entry.path).sort())) fail("EXIF_GENERATION_SET_DRIFT");
  const files = new Map();
  for (const entry of expected) files.set(entry.path, await read(root, entry.path, entry));
  return files;
}

// For the fixed hue=220/saturation=100/gamma=80 recipe only. This is the
// sextant-3 HSL conversion used by the pinned image.cpp and util.cpp rules.
function composeCss(retained) {
  const template = (name) => retained.get("public/doxygen-1.16.1/templates/html/" + name).bytes.toString("utf8");
  const colors = (value) => value.replace(/##[A-Fa-f0-9]{2}/gu, (marker) => {
    const lightness = Math.pow(parseInt(marker.slice(2), 16) / 255, 0.8);
    const saturation = 100 / 255;
    const maximum = lightness <= 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const minimum = lightness + lightness - maximum;
    const fraction = 220 / 360 * 6 - 3;
    const offset = maximum > 0 ? maximum * ((maximum - minimum) / maximum) * fraction : 0;
    return "#" + [minimum, maximum - offset, maximum].map((channel) => Math.trunc(channel * 255).toString(16).padStart(2, "0").toUpperCase()).join("");
  });
  return Buffer.from("/* The standard CSS for doxygen 1.16.1*/\n\nhtml {\n" + colors(template("lightmode_settings.css")) + "}\n\n@media (prefers-color-scheme: dark) {\n  html:not(.dark-mode) {\n    color-scheme: dark;\n\n" + colors(template("darkmode_settings.css")) + "}}\n" + template("doxygen.css") + template("scrollbar.css"));
}

function verifyOrigins(origins, recipe) {
  for (const name of ["doxygen-requests.json", "doxygen-generated-data-requests.json", "doxygen-api-data-requests.json"]) {
    const receipts = JSON.parse(origins.get("acquisition/" + name).bytes);
    for (const receipt of receipts) {
      const material = origins.get("acquisition/" + receipt.path);
      if (receipt.status !== 200 || receipt.commit !== recipe.doxygen.commit || receipt.url !== "https://raw.githubusercontent.com/doxygen/doxygen/" + receipt.commit + "/" + receipt.upstreamPath || !material || material.item.sha256 !== receipt.sha256 || material.item.bytes !== receipt.bytes) fail("EXIF_GENERATION_ORIGIN_DRIFT");
      const blob = crypto.createHash("sha1").update(Buffer.from("blob " + material.bytes.length + "\0")).update(material.bytes).digest("hex");
      if (blob !== receipt.gitBlob) fail("EXIF_GENERATION_ORIGIN_DRIFT");
    }
  }
  const tag = JSON.parse(origins.get("acquisition/graphviz-tag.json").bytes);
  const license = JSON.parse(origins.get("acquisition/graphviz-license-metadata.json").bytes);
  const licenseBytes = origins.get("acquisition/graphviz-epl-v10.txt").bytes;
  if (tag.name !== recipe.graphviz.version || tag.target !== recipe.graphviz.commit || tag.commit.id !== tag.target || license.commit_id !== tag.target || license.file_path !== "epl-v10.txt" || !Buffer.from(license.content, "base64").equals(licenseBytes) || origins.get("acquisition/graphviz-COPYING").bytes.toString() !== "epl-v10.txt") fail("EXIF_GENERATION_ORIGIN_DRIFT");
}

function generatedInputs(basename, allInputs) {
  const sourceFile = /^(exif[-a-z]+)_8([hc])\.(?:html|js)$/u.exec(basename);
  if (sourceFile) return ["origins/candidate/exif/libexif/" + sourceFile[1] + "." + sourceFile[2]];
  const structures = {
    "structExifGPSIfdTagInfo": "exif-gps-ifd.h", "structExifRational": "exif-utils.h", "structExifSRational": "exif-utils.h",
    "struct__ExifContent": "exif-content.h", "struct__ExifData": "exif-data.h", "struct__ExifEntry": "exif-entry.h",
    "struct__ExifMnoteData": "exif-mnote-data-priv.h", "struct__ExifMnoteDataMethods": "exif-mnote-data-priv.h"
  };
  const structure = structures[basename.replace(/\.(?:html|js)$/u, "")];
  return structure ? ["origins/candidate/exif/libexif/" + structure] : allInputs;
}

function ledger(retained, origins, prior, recipe) {
  const sourcePages = new Set(prior.sourcePages.map((entry) => entry.page));
  const assets = new Set(prior.assetBindings.map((entry) => entry.name));
  const graphs = new Set(recipe.graphviz.outputs);
  const prefix = "documentation/libexif-api.html/";
  const sourceInputs = [...origins.keys()].filter((name) => name.startsWith("candidate/exif/libexif/")).map((name) => "origins/" + name);
  const records = [...retained.keys()].filter((name) => name.startsWith(prefix)).map((name) => {
    const basename = name.slice(prefix.length);
    const record = { ...retained.get(name).item, material: "retained/" + name };
    if (sourcePages.has(basename)) return { ...record, kind: "RETAINED_SOURCE_PAGE", proof: "UNCHANGED_PRIOR_LINE_CORRESPONDENCE_ONLY" };
    if (assets.has(basename)) return { ...record, kind: "RETAINED_ASSET", proof: "UNCHANGED_PRIOR_ASSET_CORRESPONDENCE_ONLY" };
    if (basename === recipe.css.name) return { ...record, kind: "CSS", proof: "EXACT_FIXED_TEMPLATE_COMPOSITION", historicalConfiguration: "UNVERIFIED", generatedMaterial: "derived/doxygen.css" };
    if (graphs.has(basename)) return {
      ...record, kind: "GRAPHVIZ_SVG", declaredGenerator: "14.1.2 (0)", fixedVersionSource: recipe.graphviz.commit,
      toolMaterials: ["origins/acquisition/graphviz-tag.json", "origins/acquisition/graphviz-svg.c", "origins/acquisition/graphviz-COPYING", "origins/acquisition/graphviz-epl-v10.txt"],
      ruleMaterials: ["origins/acquisition/doxygen-dotgraph.cpp", "origins/acquisition/doxygen-dotrunner.cpp", "origins/acquisition/doxygen-dotnode.cpp", "origins/acquisition/" + (basename === "graph_legend.svg" ? "doxygen-dotlegendgraph.cpp" : "doxygen-dotclassgraph.cpp")],
      sourceInputs: basename === "graph_legend.svg" ? ["origins/acquisition/doxygen-dotlegendgraph.cpp"] : sourceInputs,
      exactDotInput: "UNBOUND", historicalToolIdentity: "UNVERIFIED", regeneration: "NOT_RUN", outputLicense: "NOT_INFERRED_FROM_GENERATOR_OR_PARENT_LIBRARY"
    };
    if (/\.(?:map|md5)$/u.test(basename)) return { ...record, kind: "GRAPH_CACHE_OR_MAP", ruleMaterial: "origins/acquisition/doxygen-dotgraph.cpp", proof: "RETAINED_OUTPUT_NOT_REGENERATION", md5Meaning: "DIGEST_OF_DOXYGEN_GRAPH_INPUT_NOT_SVG_FILE" };
    if (/\.(?:html|js)$/u.test(basename)) {
      const inputs = generatedInputs(basename, sourceInputs);
      if (inputs.some((input) => !origins.has(input.slice("origins/".length)))) fail("EXIF_GENERATION_SOURCE_UNBOUND");
      const bytes = retained.get(name).bytes;
      const start = bytes.indexOf("@licstart"), end = bytes.indexOf("@licend");
      if (start >= 0 && end < start) fail("EXIF_GENERATION_NOTICE_DRIFT");
      return {
        ...record, kind: "REMAINING_GENERATED_DATA", sourceInputs: inputs,
        ruleMaterials: basename.endsWith(".js") ? ["retained/public/doxygen-1.16.1/src/ftvhelp.cpp", "retained/public/doxygen-1.16.1/src/index.cpp"] : ["retained/public/doxygen-1.16.1/src/htmlgen.cpp", "retained/public/doxygen-1.16.1/src/index.cpp", "origins/acquisition/doxygen-filedef.cpp", "origins/acquisition/doxygen-classdef.cpp"],
        ruleSymbols: basename === "menudata.js" ? ["writeMenuData", "renderQuickLinksAsJs"] : basename.endsWith(".js") ? ["generateJSNavTree", "generateJSTreeFiles", "generateJSTree"] : ["FileDefImpl::writeDocumentation", "ClassDefImpl::writeDocumentation", "writeIndexHierarchy"],
        configurationMaterial: "origins/candidate/exif/doc/Doxyfile.in", generationBinding: "UNVERIFIED", statementMaterials: ["retained/public/doxygen-1.16.1/doc/index.dox", "origins/candidate/exif/.reuse/dep5", "origins/candidate/exif/LICENSES/LGPL-2.0-or-later.txt"], redistributionFulfillment: "UNVERIFIED",
        embeddedNotice: start >= 0 ? { material: record.material, startByte: start, endByteExclusive: end + "@licend".length, sha256: sha256(bytes.subarray(start, end + "@licend".length)), status: "COMPLETE_ORIGINAL_MARKED_NOTICE_RETAINED" } : { status: "NO_MARKED_NOTICE_IN_THIS_FILE_NOT_A_LICENSE_CONCLUSION" },
        footerObservation: basename.endsWith(".html") ? (bytes.includes(Buffer.from("doxygen.svg")) ? "DOXYGEN_SVG_FOOTER_PRESENT" : "NO_DOXYGEN_SVG_FOOTER_IN_THIS_PAGE") : "NOT_HTML"
      };
    }
    fail("EXIF_GENERATION_UNACCOUNTED_OUTPUT");
  });
  if (records.length !== recipe.documentationFiles || records.filter((entry) => entry.kind === "REMAINING_GENERATED_DATA").length !== recipe.remainingGeneratedFiles || records.filter((entry) => entry.kind === "GRAPHVIZ_SVG").length !== 5 || records.filter((entry) => entry.kind === "RETAINED_SOURCE_PAGE").length !== recipe.retainedSourcePages || records.filter((entry) => entry.kind === "RETAINED_ASSET").length !== recipe.retainedAssetBindings) fail("EXIF_GENERATION_LEDGER_DRIFT");
  for (const name of graphs) if (!retained.get(prefix + name).bytes.toString().includes("Generated by graphviz version 14.1.2 (0)")) fail("EXIF_GENERATION_GRAPH_DRIFT");
  return records;
}

async function copy(supplement, prefix, files) {
  for (const [name, { bytes, item }] of files) {
    const destination = path.join(supplement, prefix, name);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const mode = item.mode === "100755" ? 0o755 : 0o644;
    await fs.writeFile(destination, bytes, { flag: "wx", mode });
    await fs.chmod(destination, mode);
    await read(supplement, prefix + "/" + name, item);
  }
}

async function run() {
  const [priorRoot, originRoot, output] = process.argv.slice(2);
  const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
  if (process.argv.length !== 5 || ![priorRoot, originRoot, output].every((value) => value && path.isAbsolute(value) && path.resolve(value) === value)) fail("EXIF_GENERATION_PATH_UNSAFE");
  if (await exists(output)) fail("EXIF_GENERATION_OUTPUT_EXISTS");
  for (const root of [priorRoot, originRoot]) {
    if (await fs.realpath(root) !== root || within(output, root) || within(root, output)) fail("EXIF_GENERATION_PATH_UNSAFE");
  }
  if (within(output, repo) || within(repo, output) || await fs.realpath(path.dirname(output)) !== path.dirname(output)) fail("EXIF_GENERATION_PATH_UNSAFE");
  const recipeBytes = await fs.readFile(new URL("../../contracts/release/parser-resources-v1/native-libexif-generation.json", import.meta.url));
  if (sha256(recipeBytes) !== "sha256:33cebbffa6c316ff1c38362992d4c3ee96c87223b20f27236e4c40ddfb589ce6") fail("EXIF_GENERATION_RECIPE_DRIFT");
  const recipe = JSON.parse(recipeBytes);
  if (recipe.kind !== "only-my-pi-libexif-generation-materials" || recipe.issueCompletion !== "PARTIAL" || recipe.generatorExecution !== "NOT_RUN" || recipe.Full !== "NOT_RUN" || recipe.U2 !== "BLOCKED") fail("EXIF_GENERATION_SCOPE_DRIFT");
  const priorBytes = (await read(priorRoot, "libexif-doc-materials.json", { sha256: recipe.priorReportSha256 }, "EXIF_GENERATION_PRIOR_DRIFT")).bytes;
  const prior = JSON.parse(priorBytes);
  if (prior.supplementSha256 !== recipe.priorSupplementSha256 || prior.supplement.length !== recipe.priorSupplementFiles || sha256(JSON.stringify(prior.supplement)) !== recipe.priorSupplementSha256) fail("EXIF_GENERATION_PRIOR_DRIFT");
  const retained = await verifySet(path.join(priorRoot, "supplement"), prior.supplement);
  const originInventoryBytes = (await read(originRoot, "inventory.json", { sha256: recipe.originInventorySha256 })).bytes;
  const originInventory = JSON.parse(originInventoryBytes);
  if (originInventory.files.length !== recipe.originFiles) fail("EXIF_GENERATION_SET_DRIFT");
  const origins = await verifySet(originRoot, [...originInventory.files, { path: "inventory.json", sha256: recipe.originInventorySha256, bytes: originInventoryBytes.length, mode: "100644" }]);
  verifyOrigins(origins, recipe);
  const css = composeCss(retained);
  if (css.length !== recipe.css.bytes || !css.equals(retained.get("documentation/libexif-api.html/doxygen.css").bytes)) fail("EXIF_GENERATION_CSS_DRIFT");
  const records = ledger(retained, origins, prior, recipe);
  // All fixed input, full file-set and correspondence checks precede writing.
  await fs.mkdir(output, { mode: 0o700 });
  const supplement = path.join(output, "supplement");
  const report = {
    at: new Date().toISOString(), status: "PARTIAL", validation: "NOT_COMPLETED", issue: recipe.issue, task: recipe.task, requirements: recipe.requirements,
    recipeSha256: sha256(recipeBytes), probeSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
    priorReportSha256: recipe.priorReportSha256, priorSupplementSha256: recipe.priorSupplementSha256, originInventorySha256: recipe.originInventorySha256,
    css: { ...recipe.css, correspondence: "PASS_ALL_BYTES", sha256: sha256(css), ruleMaterials: ["retained/public/doxygen-1.16.1/src/htmlgen.cpp", "retained/public/doxygen-1.16.1/src/util.cpp", "origins/acquisition/doxygen-image.cpp"] },
    graphviz: recipe.graphviz, footer: recipe.footer, files: records, pending: recipe.pending,
    redistribution: { status: "UNVERIFIED", generatorSourceNotOutputLicense: true, originalStatementsRetained: true, materials: ["retained/public/doxygen-1.16.1/LICENSE", "retained/public/doxygen-1.16.1/doc/index.dox", "origins/acquisition/graphviz-epl-v10.txt", "origins/candidate/exif/.reuse/dep5", "origins/candidate/exif/LICENSES/LGPL-2.0-or-later.txt"], condition: "Keep the complete scoped input and embedded notices; resolve output-specific rights and actual fulfillment before redistribution. No synthetic license replaces the originals." },
    retainedProofs: { sourcePages: prior.sourcePages, assetBindings: prior.assetBindings, jqueryComponents: prior.jqueryComponents, root: "supplement/retained", rerun: "NOT_RUN" },
    generatorExecution: "NOT_RUN", archiveRegeneration: "NOT_RUN", nativeBuild: "NOT_RUN", Full: "NOT_RUN", U2: "BLOCKED", licensingClosure: "INCOMPLETE", issueCompletion: "PARTIAL"
  };
  try {
    await fs.mkdir(supplement, { mode: 0o700 });
    await copy(supplement, "retained", retained);
    await copy(supplement, "origins", origins);
    await fs.mkdir(path.join(supplement, "derived"), { mode: 0o700 });
    await fs.writeFile(path.join(supplement, "derived/doxygen.css"), css, { flag: "wx", mode: 0o644 });
    await fs.writeFile(path.join(supplement, "prior-report.json"), priorBytes, { flag: "wx", mode: 0o644 });
    await fs.writeFile(path.join(supplement, "recipe.json"), recipeBytes, { flag: "wx", mode: 0o644 });
    report.supplement = await inventory(supplement);
    const expected = [...[...retained.keys()].map((name) => "retained/" + name), ...[...origins.keys()].map((name) => "origins/" + name), "derived/doxygen.css", "prior-report.json", "recipe.json"].sort();
    if (JSON.stringify(report.supplement.map((entry) => entry.path).sort()) !== JSON.stringify(expected)) fail("EXIF_GENERATION_COPY_SET_DRIFT");
    if (!css.equals((await read(supplement, "derived/doxygen.css", { sha256: report.css.sha256, bytes: css.length, mode: "100644" })).bytes)) fail("EXIF_GENERATION_COPY_DRIFT");
    report.supplementSha256 = sha256(JSON.stringify(report.supplement));
    report.inputBytes = inputBytes;
    report.validation = "PASS_FIXED_CSS_AND_GENERATION_MATERIAL_LEDGER_ONLY";
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(output, "libexif-generation.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, validation: report.validation, cssBytes: css.length, documentationFiles: records.length, supplementFiles: report.supplement?.length, supplementSha256: report.supplementSha256, issueCompletion: report.issueCompletion, error: report.error, output }));
  }
}

await (process.argv[2] === "--candidate"
  ? import("./lib/libexif-document-candidate.mjs").then(({ runLibexifCandidate }) => runLibexifCandidate(process.argv.slice(3)))
  : run()).catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error.message }));
  process.exitCode = 1;
});

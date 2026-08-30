#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileAgentResource } from "../packages/agent-registry/upstream-resource.mjs";

export { compileAgentResource };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "agents");
const OUTPUT_DIR = path.join(SOURCE_DIR, "generated");
const BUNDLE_OUTPUT_DIR = path.join(ROOT, "bundles", "only-my-pi-agent-bundle", "agents");
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

function containedFile(relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("agent prompt path must be repository-relative");
  }
  const target = path.resolve(ROOT, relativePath);
  const rel = path.relative(ROOT, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`agent prompt escapes repository: ${relativePath}`);
  const real = fs.realpathSync(target);
  const realRel = path.relative(fs.realpathSync(ROOT), real);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) throw new Error(`agent prompt symlink escapes repository: ${relativePath}`);
  return real;
}

export function buildAgentResources({ rootDir = ROOT } = {}) {
  const sourceDir = path.join(rootDir, "agents");
  if (!fs.existsSync(sourceDir)) return [];
  const files = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  return files.map((file) => {
    const sourcePath = path.join(sourceDir, file);
    const manifest = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    const promptPath = containedFile(manifest.prompt?.file);
    const compiled = compileAgentResource(manifest, fs.readFileSync(promptPath, "utf8"));
    const readOnly = manifest.writer === false && !(manifest.tools?.allow ?? []).some((tool) => MUTATING_TOOLS.has(tool));
    const bundleEligible = readOnly || (manifest.id === "implementer" && manifest.contractStatus === "runtime-ready");
    return {
      sourcePath,
      outputPath: path.join(rootDir, "agents", "generated", `${compiled.name}.md`),
      bundleOutputPath: bundleEligible ? path.join(rootDir, "bundles", "only-my-pi-agent-bundle", "agents", `${compiled.name}.md`) : null,
      readOnlyOutputPath: readOnly ? path.join(rootDir, "bundles", "only-my-pi-agent-bundle", "agents", `${compiled.name}.md`) : null,
      readOnly,
      bundleEligible,
      ...compiled,
    };
  });
}

function syncOutputDirectory(directory, resources, pathKey) {
  fs.mkdirSync(directory, { recursive: true });
  const expected = new Set(resources.map((resource) => path.basename(resource[pathKey])));
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md") && !expected.has(entry.name)) {
      throw new Error(`refusing to remove stale generated resource automatically: ${entry.name}`);
    }
  }
  for (const resource of resources) fs.writeFileSync(resource[pathKey], resource.content, { encoding: "utf8", mode: 0o644 });
}

function writeResources(resources) {
  syncOutputDirectory(OUTPUT_DIR, resources, "outputPath");
  syncOutputDirectory(BUNDLE_OUTPUT_DIR, resources.filter((resource) => resource.bundleEligible), "bundleOutputPath");
}

function checkResources(resources) {
  const errors = [];
  for (const resource of resources) {
    if (!fs.existsSync(resource.outputPath)) errors.push(`missing generated agent: ${path.relative(ROOT, resource.outputPath)}`);
    else if (fs.readFileSync(resource.outputPath, "utf8") !== resource.content) errors.push(`stale generated agent: ${path.relative(ROOT, resource.outputPath)}`);
    if (resource.bundleEligible) {
      if (!fs.existsSync(resource.bundleOutputPath)) errors.push(`missing bundle generated agent: ${path.relative(ROOT, resource.bundleOutputPath)}`);
      else if (fs.readFileSync(resource.bundleOutputPath, "utf8") !== resource.content) errors.push(`stale bundle generated agent: ${path.relative(ROOT, resource.bundleOutputPath)}`);
    }
  }
  if (fs.existsSync(BUNDLE_OUTPUT_DIR)) {
    const expected = new Set(resources.filter((resource) => resource.bundleEligible).map((resource) => path.basename(resource.bundleOutputPath)));
    for (const entry of fs.readdirSync(BUNDLE_OUTPUT_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md") && !expected.has(entry.name)) errors.push(`unexpected bundle generated agent: ${entry.name}`);
    }
  }
  return errors;
}

function main() {
  const option = process.argv[2];
  if (!new Set(["--write", "--check"]).has(option) || process.argv.length !== 3) throw new Error("usage: generate-subagent-resources.mjs --write|--check");
  const resources = buildAgentResources();
  if (resources.length === 0) throw new Error("no canonical Agent manifests found");
  if (option === "--write") writeResources(resources);
  else {
    const errors = checkResources(resources);
    if (errors.length) throw new Error(errors.join("\n"));
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: option.slice(2), agents: resources.map(({ name, sourceDigest, promptDigest, readOnly, bundleEligible }) => ({ name, sourceDigest, promptDigest, readOnly, bundleEligible })) }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`agent-resource-generator: ${error.message}\n`);
    process.exitCode = 1;
  }
}

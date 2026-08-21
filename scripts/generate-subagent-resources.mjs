#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileAgentResource } from "../packages/agent-registry/upstream-resource.mjs";

export { compileAgentResource };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "agents");
const OUTPUT_DIR = path.join(SOURCE_DIR, "generated");

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
    return { sourcePath, outputPath: path.join(rootDir, "agents", "generated", `${compiled.name}.md`), ...compiled };
  });
}

function writeResources(resources) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const expected = new Set(resources.map((resource) => path.basename(resource.outputPath)));
  for (const entry of fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md") && !expected.has(entry.name)) {
      throw new Error(`refusing to remove stale generated resource automatically: ${entry.name}`);
    }
  }
  for (const resource of resources) fs.writeFileSync(resource.outputPath, resource.content, { encoding: "utf8", mode: 0o644 });
}

function checkResources(resources) {
  const errors = [];
  for (const resource of resources) {
    if (!fs.existsSync(resource.outputPath)) errors.push(`missing generated agent: ${path.relative(ROOT, resource.outputPath)}`);
    else if (fs.readFileSync(resource.outputPath, "utf8") !== resource.content) errors.push(`stale generated agent: ${path.relative(ROOT, resource.outputPath)}`);
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
  process.stdout.write(`${JSON.stringify({ ok: true, mode: option.slice(2), agents: resources.map(({ name, sourceDigest, promptDigest }) => ({ name, sourceDigest, promptDigest })) }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`agent-resource-generator: ${error.message}\n`);
    process.exitCode = 1;
  }
}

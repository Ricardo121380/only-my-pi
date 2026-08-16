import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function markdownFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
    }
  };
  visit(root);
  return files;
}

test("all repository-local Markdown links resolve inside the repository", () => {
  const failures = [];
  for (const file of markdownFiles(ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = match[1].trim();
      if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
      const relative = decodeURIComponent(raw.split("#", 1)[0]);
      const resolved = path.resolve(path.dirname(file), relative);
      const rel = path.relative(ROOT, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) failures.push(`${path.relative(ROOT, file)} -> ${raw} escapes repository`);
      else if (!fs.existsSync(resolved)) failures.push(`${path.relative(ROOT, file)} -> ${raw} is missing`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Codex Goal and Labs modules are not Pi package resources", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const resources = Object.values(manifest.pi ?? {}).flat().filter((value) => typeof value === "string");
  assert.ok(resources.every((resource) => !resource.startsWith("./codex/")));
  assert.ok(resources.every((resource) => !resource.startsWith("./packages/acp-v1")));
  assert.ok(resources.every((resource) => !resource.startsWith("./packages/deepseek-conformance")));
  assert.ok(resources.every((resource) => !resource.startsWith("./packages/workspace-checkpoint")));
});

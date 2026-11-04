#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const DOC_TESTS = new Set([
  "tests/docs-links.test.mjs", "tests/m12-product-contract.test.mjs",
  "tests/subagents-provenance.test.mjs", "tests/ci-contract.test.mjs",
  "tests/ci-plan.test.mjs",
]);

// Keep Node's test-name conventions, including tests outside tests/.
// Vitest owns the TypeScript browser tests under webui/ and prototypes/.
export function isNodeTest(file) {
  return !/^(?:webui|prototypes)\/src\/.*\.test\.tsx?$/u.test(file) && (
    /(?:^|\/)(?:test|test-.+|.+[._-]test)\.(?:[cm]?js|[cm]?ts)$/u.test(file)
    || /(?:^|\/)test\/.*\.(?:[cm]?js|[cm]?ts)$/u.test(file)
  );
}

export function testLane(file) {
  if (DOC_TESTS.has(file)) return "docs";
  if (file.startsWith("webui/") || file.startsWith("prototypes/")) return "web";
  if (/^tests\/(?:direct-minimal-runtime|dev-web|b2-native-web|browser-probe-identity|host-(?:account(?:s|-.+)|auth-process|catalog|session-scan|lifecycle|server|sdk-probe|pi110-runtime|ownership|rpc-worker|task-binding|task-resume|task-metrics|usage|approval-bridge|control-state|controlled-.+|minimal-web|tool-stream))\.test\.mjs$/u.test(file)) return "web";
  return "cli";
}

export function nodeTestFiles(cwd = root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0").filter(isNodeTest).sort();
}

const ROOT_DOC = /^(?:README(?:\.[\w-]+)?\.md|AGENTS\.md|CONTEXT\.md|CONTRIBUTING\.md|CHANGELOG\.md|SECURITY\.md|CODE_OF_CONDUCT\.md|THIRD_PARTY_NOTICES\.md|LICENSE)$/u;
export function classifyChanges(files) {
  const plan = { docs: true, web: false, cli: false, packaging: false };
  for (const file of files) {
    if (ROOT_DOC.test(file) || /^docs\/.*\.(?:md|png|svg|jpe?g|webp)$/u.test(file) || /^prototypes\/(?:README|DESIGN)\.md$/u.test(file)) continue;
    if (/^webui\/(?:src\/.+\.(?:[cm]?[jt]sx?|css|svg|png|jpe?g|webp)|(?:index|minimal)\.html)$/u.test(file)
      || /^prototypes\/(?:src\/.+\.(?:[cm]?[jt]sx?|css|svg|png|jpe?g|webp)|(?:index|minimal)\.html)$/u.test(file)
      || ["scripts/dev-web.mjs", "packages/direct-agent/minimal-services.mjs"].includes(file)) { plan.web = true; continue; }
    if (isNodeTest(file) && !file.startsWith("tests/ci-")) {
      plan[testLane(file)] = true;
      continue;
    }
    // Runtime Markdown (skills, prompts, agents, modes) is intentionally NOT
    // documentation-only. Unknown paths fail closed to all affected lanes.
    plan.web = true;
    plan.cli = true;
    plan.packaging = true;
  }
  return plan;
}

export function requiredFailures(plan, results) {
  const expected = { docs: true, static: plan.web || plan.cli || plan.packaging,
    web: plan.web, cli: plan.cli, packaging: plan.packaging };
  return Object.entries(expected).filter(([lane, selected]) =>
    results[lane]?.result !== (selected ? "success" : "skipped")).map(([lane]) => lane);
}

export function changedFiles(event, name, cwd = root) {
  if (name === "workflow_dispatch") return null;
  const base = name === "pull_request" ? event.pull_request?.base?.sha : event.before;
  const head = name === "pull_request" ? event.pull_request?.head?.sha : event.after;
  if (!/^[a-f0-9]{40}$/u.test(base ?? "") || /^0+$/u.test(base) || !/^[a-f0-9]{40}$/u.test(head ?? "")) return null;
  // A PR compares to its merge base; a push compares its actual before/after.
  const range = `${base}${name === "pull_request" ? "..." : ".."}${head}`;
  execFileSync("git", ["diff", "--check", range, "--"], { cwd, encoding: "utf8" });
  return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", range, "--"], { cwd, encoding: "utf8" })
    .split("\0").filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const files = changedFiles(event, process.env.GITHUB_EVENT_NAME);
  const plan = files === null ? { docs: true, web: true, cli: true, packaging: true } : classifyChanges(files);
  const output = Object.entries(plan).map(([key, value]) => `${key}=${value}`).join("\n");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### CI scope\n\n${output.replaceAll("\n", "  \n")}\n\nChanged paths: ${files?.length ?? "full run"}. Unselected lanes are skipped, not release evidence.\n`);
  console.log(JSON.stringify({ plan, changedPathCount: files?.length ?? null }));
}

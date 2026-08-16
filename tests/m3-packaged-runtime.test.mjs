import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("fresh scripts-disabled tarball exposes a dependency-closed Mode Registry", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m3-packaged-runtime-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync(
    process.env.npm_execpath || "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporary, "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_config_ignore_scripts: "true" },
    },
  ));
  assert.equal(packed.length, 1);
  execFileSync("tar", ["-xzf", path.join(temporary, packed[0].filename), "-C", temporary]);
  const packageRoot = path.join(temporary, "package");
  const runtimeModule = await import(`${pathToFileURL(path.join(packageRoot, "extensions/omp-control/runtime.mjs"))}?fresh=${Date.now()}`);
  const runtime = runtimeModule.createOmpRuntime();

  const listed = await runtime.execute("mode list");
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.ok(listed.modes.some((mode) => mode.id === "inspect"), JSON.stringify(listed));

  const shown = await runtime.execute("mode show inspect");
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.equal(shown.mode.modeId, "inspect");
  assert.equal(typeof shown.mode.promptPayloads?.[0]?.content, "string");
  assert.ok(shown.mode.promptPayloads[0].content.includes("Inspect Mode"));
});

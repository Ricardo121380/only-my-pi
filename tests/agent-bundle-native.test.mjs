import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

test("native Pi registers the agent-only package without loading it as executable code", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = fileURLToPath(new URL("../bundles/only-my-pi-agent-bundle", import.meta.url));
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: root,
    settingsManager: SettingsManager.inMemory({ packages: [bundle] }),
    noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    disabledBuiltinExtensions: ["mcp"],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.equal(loader.getExtensions().extensions.length, 0);
});

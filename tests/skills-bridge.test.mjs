import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SkillsBridgeError, createSkillsBridge } from "../packages/skills-bridge/index.mjs";

test("skills bridge discovers trusted project skills and reports deterministic conflicts", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-skills-"));
  try {
    await fs.mkdir(path.join(temp, "project", ".agents", "skills", "lint"), { recursive: true });
    await fs.mkdir(path.join(temp, "user", "lint"), { recursive: true });
    await fs.writeFile(path.join(temp, "project", ".agents", "skills", "lint", "SKILL.md"), "# project lint\n");
    await fs.writeFile(path.join(temp, "user", "lint", "SKILL.md"), "# user lint\n");
    const bridge = createSkillsBridge({ projectRoot: path.join(temp, "project"), trustedProject: true, roots: [{ kind: "user", path: path.join(temp, "user") }] });
    const result = await bridge.discover();
    assert.equal(result.skills[0].id, "project:lint");
    assert.deepEqual(result.conflicts, [{ name: "lint", candidates: ["project:lint", "user:lint"] }]);
    assert.match((await bridge.load("project:lint")).content, /project/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
test("untrusted project skills are not discovered and symlinks fail closed", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-skills-"));
  try {
    await fs.mkdir(path.join(temp, "project", ".agents", "skills", "danger"), { recursive: true });
    await fs.writeFile(path.join(temp, "secret.md"), "secret");
    await fs.symlink(path.join(temp, "secret.md"), path.join(temp, "project", ".agents", "skills", "danger", "SKILL.md"));
    const bridge = createSkillsBridge({ projectRoot: path.join(temp, "project"), trustedProject: false });
    assert.deepEqual((await bridge.discover()).skills, []);
    const trusted = createSkillsBridge({ projectRoot: path.join(temp, "project"), trustedProject: true });
    await assert.rejects(() => trusted.discover(), (error) => error instanceof SkillsBridgeError && error.code === "SYMLINK_ESCAPE");
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

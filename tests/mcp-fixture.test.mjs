import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const fixture = new URL("./fixtures/mcp-host.mjs", import.meta.url).href;

test("failed Host fixture setup closes its listener before returning the error", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fixture-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const blocked = path.join(root, "file"); await fs.writeFile(blocked, "not a directory");
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createMcpHost } from ${JSON.stringify(fixture)};
    await assert.rejects(createMcpHost({ root: ${JSON.stringify(blocked)} }), { code: "ENOTDIR" });
    console.log("SETUP_FAILED_CLEANLY");
  `], { timeout: 10000 });
  assert.match(stdout, /SETUP_FAILED_CLEANLY/);
});

test("real extension fixtures initialize with an empty HOME and exact lock identities", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fixture-empty-home-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createMcpHost } from ${JSON.stringify(fixture)};
    const f = await createMcpHost({ root: ${JSON.stringify(path.join(root, "fixture"))}, installedExtensions: true });
    try {
      assert.deepEqual(f.bindings.map(b => [b.name, b.resolvedVersion]), [
        ["pi-permission-modes", "2.2.0"], ["pi-subagents", "0.57.0"],
        ["pi-agent-extensions", "0.5.4"], ["@narumitw/pi-lsp", "0.49.6"], ["@sreetej510/pi-usage", "0.7.1"]
      ]);
      console.log("REAL_EXTENSIONS_WITH_EMPTY_HOME");
    } finally { await f.close(); }
  `], { env: { PATH: process.env.PATH, HOME: root }, timeout: 30000 });
  assert.match(stdout, /REAL_EXTENSIONS_WITH_EMPTY_HOME/);
});

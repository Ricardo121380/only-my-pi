import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installPi } from "../packages/release-stack/release-payload-stager.mjs";
import { piRuntimeContract } from "../packages/release-stack/contracts.mjs";

async function fixture(t, actualVersion = "0.85.1") {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi-staging-test-"));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  const resolved = path.join(work, "resolved");
  await fs.mkdir(resolved);
  const calls = [];
  return { calls, options: { work, resolved, node: "/fixture/node", npm: "/fixture/npm", env: {}, piVersion: "0.85.1",
    async download(options) {
      calls.push(options);
      return { sha256: `sha256:${"a".repeat(64)}` };
    },
    async extract({ destination }) {
      const root = path.join(destination, "package");
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: actualVersion, devDependencies: { example: "1.0.0" } }));
      await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "{}");
    },
    async run(node, argv, options) {
      calls.push({ node, argv });
      assert.equal(JSON.parse(await fs.readFile(path.join(options.cwd, "package.json"))).devDependencies, undefined);
    },
  } };
}

test("Pi staging fetches the selected identity and disables dependency scripts", async (t) => {
  const { calls, options } = await fixture(t);
  const result = await installPi(options);
  assert.match(calls[0].url, /pi-coding-agent-0\.85\.1\.tgz$/u);
  assert.equal(calls[0].expectedSri, piRuntimeContract("0.85.1").integrity);
  assert.ok(calls[1].argv.includes("--ignore-scripts"));
  const manifest = JSON.parse(await fs.readFile(path.join(result.pi, "package.json")));
  assert.equal(manifest.version, "0.85.1");
  assert.deepEqual(manifest.devDependencies, { example: "1.0.0" });
});

test("Pi staging rejects a legacy package disguised as a candidate before npm runs", async (t) => {
  const { calls, options } = await fixture(t, "0.84.3");
  await assert.rejects(installPi(options), { code: "STACK_PI_IDENTITY_INVALID" });
  assert.equal(calls.length, 1);
});

test("Pi staging rejects unknown versions before download", async (t) => {
  const { calls, options } = await fixture(t);
  await assert.rejects(installPi({ ...options, piVersion: "latest" }), { code: "STACK_PI_IDENTITY_INVALID" });
  assert.equal(calls.length, 0);
});

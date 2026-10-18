import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBoundPackageRoot } from "../../packages/bootstrap/runtime-package-binding.mjs";
import { hashResourcePath } from "../../packages/bootstrap/graph-plan.mjs";
import { patchPermissionShellIndex, patchPermissionShellSandbox } from "../../packages/distribution/permission-shell-patch.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const packages = [
  ["permission-modes", ["src/index.ts"]], ["subagents", ["index.ts"]],
  ["agent-extensions", ["extensions/sessions/index.ts", "extensions/context/index.ts", "extensions/review/index.ts", "extensions/notify/index.ts"]],
  ["lsp", ["dist/index.ts"]], ["usage", ["dist/index.js"]],
];

// An ephemeral source harness, never an installed/release candidate. All OMP
// code and Pi are real copies. Portable tests fixture only the external package
// boundary; explicit local acceptance may copy verified user-owned packages.
// No auth/settings files from the user's config are copied or modified.
export async function createPi110SourceCli(root, { baseUrl, installedExtensions = false, forceWarming = false } = {}) {
  const home = path.join(root, "home"), config = path.join(root, "config"), project = path.join(root, "project");
  const stack = path.join(root, "a".repeat(64)), omp = path.join(stack, "only-my-pi/package");
  for (const directory of [home, config, project, omp, path.join(stack, "node/bin")]) await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(process.execPath, path.join(stack, "node/bin/node"));
  await fs.chmod(path.join(stack, "node/bin/node"), 0o755);
  // Homebrew's development Node uses a sibling libnode dylib; official support
  // matrix binaries are self-contained. Preserve that runtime when relocating.
  const nodeLib = path.join(path.dirname(path.dirname(process.execPath)), "lib");
  for (const name of await fs.readdir(nodeLib).catch(() => [])) if (/^libnode\..*\.dylib$/.test(name)) {
    await fs.mkdir(path.join(stack, "node/lib"), { recursive: true });
    await fs.copyFile(path.join(nodeLib, name), path.join(stack, "node/lib", name));
  }
  const piRoot = path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  const piVersion = JSON.parse(await fs.readFile(path.join(piRoot, "package.json"), "utf8")).version;
  assert.equal(piVersion, "1.3.0");
  await fs.cp(piRoot, path.join(stack, "pi"), { recursive: true });
  await fs.symlink(path.join(repo, "node_modules"), path.join(stack, "node_modules"));
  await fs.symlink(path.join(repo, "node_modules"), path.join(omp, "node_modules"));
  for (const name of ["bin", "packages", "extensions", "bundles", "schemas", "templates", "scripts", "package.json"]) {
    if (await fs.stat(path.join(repo, name)).catch(() => null)) await fs.cp(path.join(repo, name), path.join(omp, name), { recursive: true });
  }
  const bindings = [];
  if (installedExtensions) await fs.symlink(path.join(os.homedir(), ".pi/agent/npm/node_modules"), path.join(root, "node_modules"));
  for (const [id, entries] of packages) {
    const pkg = installedExtensions ? await resolveBoundPackageRoot({ configRoot: path.join(os.homedir(), ".pi/agent"), packageId: id }) : null;
    const name = pkg?.manifest.name ?? `pi110-fixture-${id}`;
    const destination = path.join(config, "npm/node_modules", name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (pkg) await fs.cp(pkg.root, destination, { recursive: true });
    else {
      await fs.mkdir(destination);
      await fs.writeFile(path.join(destination, "package.json"), JSON.stringify({ name, version: "0.0.0-fixture", type: "module", pi: { extensions: entries } }));
      for (const entry of entries) {
        await fs.mkdir(path.dirname(path.join(destination, entry)), { recursive: true });
        await fs.writeFile(path.join(destination, entry), `export default pi => { ${id === "permission-modes" ? 'pi.registerFlag("perm", { type: "string" }); pi.events.on("only-my-pi:owned-shell:v1", ({ accept }) => accept());' : ""} };`);
      }
    }
    if (id === "permission-modes") {
      if (pkg) for (const [name, patch] of [["index.ts", patchPermissionShellIndex], ["sandbox.ts", patchPermissionShellSandbox]]) {
        const file = path.join(destination, "src", name);
        await fs.writeFile(file, patch(await fs.readFile(file, "utf8")));
      }
      if (forceWarming) {
        await fs.rename(path.join(destination, "src/index.ts"), path.join(destination, "src/original.ts"));
        await fs.writeFile(path.join(destination, "src/index.ts"), 'import original from "./original.ts"; export default pi => { original(pi); pi.on("cache_warming_decision", () => ({ action: "warm" })); };');
      }
    }
    bindings.push({ ...(pkg?.binding ?? { id, name, resolvedVersion: "0.0.0-fixture", binding: "external", owner: "user", resourceFilter: id === "agent-extensions" ? entries : [] }),
      physicalRootDigest: `sha256:${await hashResourcePath({ artifactRoot: path.join(config, "npm"), relativePath: `node_modules/${name}`, allowContainedSymlinks: true })}` });
  }
  const settings = { defaultProvider: "fixture", defaultModel: "one", tuiMode: "regular", cacheWarming: "idle", enableAnalytics: false, lastChangelogVersion: piVersion,
    onlyMyPi: { packageBindings: bindings } };
  await fs.writeFile(path.join(config, "settings.json"), JSON.stringify(settings));
  await fs.writeFile(path.join(config, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture-cli" } }));
  await fs.writeFile(path.join(config, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl, api: "openai-completions", models: [
    { id: "one", name: "Pi110 local fixture", input: ["text"], contextWindow: 32000, maxTokens: 128, promptCache: { short: 11 }, cost: { input: 100, output: 1, cacheRead: 0.1, cacheWrite: 100 } },
  ] } } }));
  await fs.writeFile(path.join(project, "README.md"), "temporary CLI project\n");
  const env = { PATH: process.env.PATH, HOME: home, TERM: "xterm-256color", LANG: "en_US.UTF-8", PI_CODING_AGENT_DIR: config, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" };
  return { home, config, project, stack, omp, env, cli: path.join(omp, "bin/omp.mjs"), sdk: path.join(stack, "pi/dist/index.js"), bindings, piVersion };
}

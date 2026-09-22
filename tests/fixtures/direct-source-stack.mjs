import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveControlledStack, resolveDirectExtensionSet } from "../../packages/direct-agent/launcher.mjs";
import { resolveBoundPackageRoot } from "../../packages/bootstrap/runtime-package-binding.mjs";
import { patchPermissionShellIndex, patchPermissionShellSandbox } from "../../packages/distribution/permission-shell-patch.mjs";

// Source acceptance only: verified user-owned packages remain untouched and no
// credential files are copied. The final distributable still needs its own gate.
export async function prepareDirectSourceStack(root, config) {
  const stack = await resolveControlledStack();
  const userConfig = path.join(os.homedir(), ".pi/agent");
  const resolved = await resolveDirectExtensionSet({ stack, configRoot: userConfig });
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const extensions = resolved.extensions.map(entry => entry.startsWith(stack.ompPackageRoot + path.sep)
    ? path.join(repo, path.relative(stack.ompPackageRoot, entry)) : entry);
  assert.equal(extensions.length, 12);
  const bindings = [];
  for (const packageId of ["subagents", "web-access"]) {
    const pkg = await resolveBoundPackageRoot({ configRoot: userConfig, packageId });
    const destination = path.join(config, "npm/node_modules", pkg.manifest.name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(pkg.root, destination, { recursive: true });
    bindings.push(pkg.binding);
  }
  const settingsFile = path.join(config, "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  await fs.writeFile(settingsFile, JSON.stringify({ ...settings, onlyMyPi: { packageBindings: bindings } }));
  for (const binding of bindings) await resolveBoundPackageRoot({ configRoot: config, packageId: binding.id });
  const packageRoot = path.dirname(path.dirname(extensions[0])), copy = path.join(root, "permission");
  await fs.cp(packageRoot, copy, { recursive: true });
  await fs.symlink(path.dirname(packageRoot), path.join(root, "node_modules"), "dir");
  for (const [name, transform] of [["index.ts", patchPermissionShellIndex], ["sandbox.ts", patchPermissionShellSandbox]]) {
    const file = path.join(copy, "src", name);
    await fs.writeFile(file, transform(await fs.readFile(file, "utf8")));
  }
  extensions[0] = path.join(copy, "src/index.ts");
  return extensions;
}

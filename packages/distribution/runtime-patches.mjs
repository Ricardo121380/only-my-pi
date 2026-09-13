import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function once(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw new Error("reviewed runtime patch anchor differs");
  return text.replace(before, after);
}

/** Explicit, byte-bound build patches. Upstream ledger evidence is preserved;
 * the patched tree and this patch record are covered by distribution identity. */
export async function applyRuntimePatches({ runtimeRoot, version, platform }) {
  if (version !== "0.4.0-preview.2") return [];
  const patches = [];
  async function patch(relative, packageName, packageVersion, expected, transform) {
    const filename = path.join(runtimeRoot, "external-npm/node_modules", relative);
    const original = await fs.readFile(filename);
    if (digest(original) !== `sha256:${expected}`) throw new Error(`upstream patch input differs: ${relative}`);
    const changed = transform(original.toString("utf8"));
    await fs.writeFile(filename, changed);
    patches.push({ packageName, packageVersion, path: `node_modules/${relative}`, upstreamSha256: digest(original), patchedSha256: digest(changed) });
  }
  await patch("pi-permission-modes/src/paths.ts", "pi-permission-modes", "2.2.0",
    "6fd6416b685fa260ad4ea89f64f448398a5605ca4ee4490c677e81cae5b5c307", (text) => {
      const match = text.match(/export function removeSandboxPlaceholders\(root: string\): number \{[\s\S]*?\n\}/u);
      if (!match) throw new Error("permission cleanup patch anchor missing");
      return once(text, match[0], "export function removeSandboxPlaceholders(_root: string): number {\n  // OMP never identifies ownership from file size. Per-command leases own cleanup.\n  return 0;\n}");
    });
  await patch("pi-permission-modes/src/sandbox.ts", "pi-permission-modes", "2.2.0",
    "57a71b9ace6e00787c187a5d4ac70696e080acf47e154ec1e0ec637327700c54", (text) => {
      text = 'import { beginSandboxMountLease } from "../../../../only-my-pi/package/packages/distribution/sandbox-mount-ownership.mjs";\n' + text;
      text = once(text, "      try {\n        const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, customConfig as never);",
        "      const releaseOwnedMounts = beginSandboxMountLease();\n      let sandboxWrapped = false;\n      try {\n        const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, customConfig as never);\n        sandboxWrapped = true;");
      return once(text, "        removeSandboxPlaceholders(cwd);\n      }\n    },",
        '        try {\n          if (process.platform === "linux" && sandboxWrapped)\n            (SandboxManager as unknown as { cleanupAfterCommand(): void }).cleanupAfterCommand();\n        } finally { releaseOwnedMounts(); }\n      }\n    },');
    });
  if (platform.startsWith("linux-")) {
    await patch("@anthropic-ai/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js", "@anthropic-ai/sandbox-runtime", "0.0.76",
      "30c7edb9b3199da320e7ded80f2757c0045b07c890bc066ddc64a5f46dd7c639", (text) => {
        text = 'import { reserveSandboxMountPoints, cleanupOwnedSandboxMountPoints } from "../../../../../../only-my-pi/package/packages/distribution/sandbox-mount-ownership.mjs";\n' + text;
        const start = text.indexOf("    for (const mountPoint of bwrapMountPoints) {");
        const end = text.indexOf("    bwrapMountPoints.clear();", start);
        if (start < 0 || end < 0) throw new Error("sandbox cleanup patch anchor missing");
        text = once(text, text.slice(start, end), "    cleanupOwnedSandboxMountPoints();\n");
        return once(text, "        const wrappedCommand = quote([bwrapPath ?? 'bwrap', ...bwrapArgs]);",
          "        reserveSandboxMountPoints(bwrapArgs);\n        const wrappedCommand = quote([bwrapPath ?? 'bwrap', ...bwrapArgs]);");
      });
  }
  await fs.writeFile(path.join(runtimeRoot, "external-npm/omp-runtime-patches.json"), `${JSON.stringify({ formatVersion: 1,
    reason: "Preserve existing empty files and defer owned mountpoint cleanup until overlapping commands finish", patches }, null, 2)}\n`);
  return patches;
}

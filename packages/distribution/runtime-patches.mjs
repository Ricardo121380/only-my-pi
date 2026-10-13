import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { patchPermissionShellIndex, patchPermissionShellSandbox } from "./permission-shell-patch.mjs";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function once(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw new Error("reviewed runtime patch anchor differs");
  return text.replace(before, after);
}

/** Explicit, byte-bound build patches. Upstream ledger evidence is preserved;
 * the patched tree and this patch record are covered by distribution identity. */
export async function applyRuntimePatches({ runtimeRoot, version, platform, runtimeContract }) {
  if (runtimeContract !== undefined && !["phase1-pi0851", "pi110-v1"].includes(runtimeContract)) throw new Error("unknown runtime patch contract");
  if (version !== "0.4.0-preview.2" && !["phase1-pi0851", "pi110-v1"].includes(runtimeContract)) return [];
  if (runtimeContract === "pi110-v1") {
    const pi = JSON.parse(await fs.readFile(path.join(runtimeRoot, "pi/package.json"), "utf8"));
    if (pi.name !== "@earendil-works/pi-coding-agent" || pi.version !== "1.1.0" || platform !== "darwin-arm64") throw new Error("Pi 1.1.0 patch purpose, version or platform differs");
  }
  const patches = [];
  async function patch(relative, packageName, packageVersion, expected, transform) {
    if (runtimeContract === "pi110-v1") {
      const metadata = JSON.parse(await fs.readFile(path.join(runtimeRoot, "external-npm/node_modules", packageName, "package.json"), "utf8"));
      if (metadata.name !== packageName || metadata.version !== packageVersion) throw new Error(`runtime patch package version differs: ${packageName}`);
    }
    const filename = path.join(runtimeRoot, "external-npm/node_modules", relative);
    const original = await fs.readFile(filename);
    if (digest(original) !== `sha256:${expected}`) throw new Error(`upstream patch input differs: ${relative}`);
    const changed = transform(original.toString("utf8"));
    await fs.writeFile(filename, changed);
    patches.push({ packageName, packageVersion, path: `node_modules/${relative}`, upstreamSha256: digest(original), patchedSha256: digest(changed) });
  }
  if (runtimeContract === "pi110-v1") {
    await patch("pi-web-access/ssrf-protection.ts", "pi-web-access", "0.25.0",
      "c8280208780f19a2d66a0c9a04d2feb674f8baa813e6b88a1b12cd53675f71aa", (text) => {
        text = 'import { pinnedRequest as ompPinnedRequest } from "../../../only-my-pi/package/packages/web-policy/pinned-fetch.mjs";\n' + text;
        text = once(text, "const fetchImpl = options.fetch ?? fetch;", "const fetchImpl = options.fetch ?? ((url, init) => ompPinnedRequest(url, init, { lookup: options.lookup }));");
        return once(text, "const from = current;", "await response.body?.cancel();\n\t\tconst from = current;");
      });
    await patch("pi-web-access/utils.ts", "pi-web-access", "0.25.0",
      "6b588a7ff4503f165a6670b3611b0e9502dde0d348519016fb06861e8c640b05", (text) => {
        text = 'import { publicWebFetch as ompPublicWebFetch } from "../../../only-my-pi/package/packages/web-policy/pinned-fetch.mjs";\n' + text;
        text = once(text, 'await fetch(current, { ...requestInit, redirect: "manual" })', 'await ompPublicWebFetch(current, { ...requestInit, redirect: "manual" })');
        const apiRedirect = 'const next = new URL(location, current);\n\t\tif (next.protocol !== "http:" && next.protocol !== "https:") {';
        return once(text, apiRedirect, `await response.body?.cancel();\n\t\t${apiRedirect}`);
      });
    await patch("pi-web-access/extract.ts", "pi-web-access", "0.25.0",
      "dd47dcaa6ba077f27dd5a2364e28703d91c108cd4c6573cdf319d06ebb695add", (text) => {
        text = 'import { pinnedRequest as ompPinnedRequest } from "../../../only-my-pi/package/packages/web-policy/pinned-fetch.mjs";\n' + text;
        text = once(text, 'await fetch(current, { ...requestInit, headers, redirect: "manual" })', 'await ompPinnedRequest(current, { ...requestInit, headers, redirect: "manual" }, { lookup: validationOptions.lookup })');
        return once(text, "const from = current;", "await response.body?.cancel();\n\t\tconst from = current;");
      });
  }
  await patch("pi-permission-modes/src/index.ts", "pi-permission-modes", "2.2.0",
    "fd4462a3b7ba986af734c2e17ba8ea7178df56c933e87ed444ba90ba24c2fd5b", patchPermissionShellIndex);
  await patch("pi-permission-modes/src/paths.ts", "pi-permission-modes", "2.2.0",
    "6fd6416b685fa260ad4ea89f64f448398a5605ca4ee4490c677e81cae5b5c307", (text) => {
      const match = text.match(/export function removeSandboxPlaceholders\(root: string\): number \{[\s\S]*?\n\}/u);
      if (!match) throw new Error("permission cleanup patch anchor missing");
      return once(text, match[0], "export function removeSandboxPlaceholders(_root: string): number {\n  // OMP never identifies ownership from file size. Per-command leases own cleanup.\n  return 0;\n}");
    });
  await patch("pi-permission-modes/src/sandbox.ts", "pi-permission-modes", "2.2.0",
    "57a71b9ace6e00787c187a5d4ac70696e080acf47e154ec1e0ec637327700c54", (text) => {
      text = patchPermissionShellSandbox(text);
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
    ...(runtimeContract === "pi110-v1" ? { runtimeContract, piVersion: "1.1.0", platform } : {}),
    reason: runtimeContract === "pi110-v1"
      ? "Pin validated public Web DNS and redirects; preserve empty files and owned mount cleanup; delegate permission-shell execution without replacing sandbox policy"
      : "Preserve existing empty files and owned mount cleanup; delegate permission-shell execution to OMP without replacing sandbox policy", patches }, null, 2)}\n`);
  return patches;
}

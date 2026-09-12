import fs from "node:fs/promises";

// Legacy generated resource trees do not carry native packaging dependencies.
// Detect the intrinsic manifest before loading the native implementation.
let intrinsic;
export function loadIntrinsicDistribution() {
  intrinsic ??= (async () => {
    try { await fs.lstat(new URL("../../../../distribution-manifest.json", import.meta.url)); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const { loadDistribution } = await import("./runtime.mjs");
    return loadDistribution();
  })();
  return intrinsic;
}

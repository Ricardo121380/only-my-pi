import fs from "node:fs/promises";
import path from "node:path";

// Pi supports package-local branding through PI_PACKAGE_DIR and piConfig.
// Keep its original metadata/assets intact for `omp admin pi`.
export async function stagePiBranding(piRoot) {
  const destination = path.join(piRoot, "omp-assets");
  await fs.mkdir(destination);
  const metadata = JSON.parse(await fs.readFile(path.join(piRoot, "package.json"), "utf8"));
  metadata.piConfig = { ...metadata.piConfig, name: "omp", configDir: ".pi" };
  await fs.writeFile(path.join(destination, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  for (const entry of ["README.md", "CHANGELOG.md", "docs", "examples",
    "dist/modes/interactive/theme", "dist/modes/interactive/assets", "dist/core/export-html"]) {
    await fs.cp(path.join(piRoot, entry), path.join(destination, entry), { recursive: true, errorOnExist: true, force: false });
  }
}

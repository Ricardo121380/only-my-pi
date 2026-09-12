import fs from "node:fs/promises";
import path from "node:path";
import { homebrewFormula } from "../packages/distribution/homebrew.mjs";
import { hashFile } from "../packages/release-stack/deterministic-archive.mjs";

const [buildDirectory, output, mode] = process.argv.slice(2);
if (!path.isAbsolute(buildDirectory ?? "") || !path.isAbsolute(output ?? "") || (mode && mode !== "--local-fixture"))
  throw new Error("Usage: node scripts/build-homebrew-formula.mjs /absolute/build /absolute/only-my-pi.rb [--local-fixture]");
const receipt = JSON.parse(await fs.readFile(path.join(buildDirectory, "build-receipt.json"), "utf8"));
const formula = homebrewFormula(receipt, mode ? { localAssetDirectory: buildDirectory } : {});
for (const artifact of receipt.artifacts) {
  if (path.basename(artifact.filename) !== artifact.filename || await hashFile(path.join(buildDirectory, artifact.filename)) !== artifact.sha256)
    throw new Error("Homebrew input artifact is damaged");
}
await fs.writeFile(output, formula, { flag: "wx" });
console.log(output);

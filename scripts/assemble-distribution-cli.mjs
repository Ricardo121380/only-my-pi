import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemblePublicCli } from "../packages/distribution/cli-assembler.mjs";
const [outputRoot, ...platformDirectories] = process.argv.slice(2);
if (platformDirectories.length !== 3) throw new Error("Usage: node scripts/assemble-distribution-cli.mjs /output /macos /linux-arm64 /linux-x64");
console.log(JSON.stringify(await assemblePublicCli({ rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), outputRoot, platformDirectories }), null, 2));

import fs from "node:fs/promises";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { extractVerifiedTarGzip } from "../packages/release-stack/safe-extract.mjs";
const execFile = promisify(callback);
const [candidate, output, source] = process.argv.slice(2);
if (![candidate, output].every((item) => path.isAbsolute(item ?? "")) || !/^[a-f0-9]{40}$/u.test(source ?? "")) throw new Error("absolute candidate/output paths and source commit required");
const receipt = JSON.parse(await fs.readFile(path.join(candidate, "build-receipt.json"), "utf8"));
const platform = `${process.platform}-${process.arch}`;
if (receipt.sourceCommit !== source || receipt.version !== "0.4.0-preview.2" || !receipt.platforms?.[platform]) throw new Error("live candidate source/platform mismatch");
const archive = receipt.archives.find((item) => item.mode === "full" && item.platform === platform);
if (archive?.filename !== `only-my-pi-${receipt.version}-${platform}-full.tar.gz`) throw new Error("full archive missing");
await fs.mkdir(output, { recursive: false });
await extractVerifiedTarGzip({ archivePath: path.join(candidate, archive.filename), destination: path.join(output, "source"),
  expectedSha256: archive.sha256, maxEntries: 200_000, maxExtractedBytes: 2 * 1024 * 1024 * 1024 });
const prefix = path.join(output, "installed");
await execFile(path.join(output, "source/only-my-pi/install.sh"), ["--prefix", prefix], {
  env: { HOME: output, PATH: "/usr/bin:/bin" }, timeout: 180_000, maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ sourceCommit: source, platform, command: path.join(prefix, "bin/omp") }));

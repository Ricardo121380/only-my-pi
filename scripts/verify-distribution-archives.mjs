import fs from "node:fs/promises";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { extractVerifiedTarGzip } from "../packages/release-stack/safe-extract.mjs";

const execFile = promisify(callback);
const [build, output] = process.argv.slice(2);
if (!path.isAbsolute(build ?? "") || !path.isAbsolute(output ?? ""))
  throw new Error("Usage: node scripts/verify-distribution-archives.mjs /absolute/build /fresh/output");
await fs.mkdir(output);
const receipt = JSON.parse(await fs.readFile(path.join(build, "build-receipt.json"), "utf8"));
const identities = [];
for (const mode of ["full", "thin"]) {
  const artifact = receipt.archives.find((item) => item.mode === mode);
  if (!artifact || artifact.distributionId !== receipt.distributionId || path.basename(artifact.filename) !== artifact.filename)
    throw new Error("archive identity is missing");
  const extracted = path.join(output, mode);
  await extractVerifiedTarGzip({ archivePath: path.join(build, artifact.filename), destination: extracted,
    expectedSha256: artifact.sha256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
  const root = path.join(extracted, "only-my-pi");
  const home = path.join(output, `${mode}-home`);
  const prefix = path.join(output, `${mode}-installed`);
  await fs.mkdir(home);
  const env = { HOME: home, PATH: "/usr/bin:/bin", ...Object.fromEntries(
    ["HTTPS_PROXY", "HTTP_PROXY"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])) };
  const install = path.join(root, "install.sh");
  const command = mode === "full" ? "/usr/bin/sandbox-exec" : install;
  const args = mode === "full" ? ["-p", "(version 1)(allow default)(deny network*)", install, "--prefix", prefix] : ["--prefix", prefix];
  const installed = await execFile(command, args, { env, cwd: home, timeout: 180_000, maxBuffer: 1024 * 1024 });
  await fs.writeFile(path.join(output, `${mode}-install.log`), installed.stdout + installed.stderr);
  const { stdout } = await execFile("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", path.join(prefix, "bin/omp"), "admin", "version", "--json"], { env, cwd: home });
  const identity = JSON.parse(stdout);
  if (!identity.ok || identity.installation.channel !== "archive" || identity.distributionId !== receipt.distributionId
    || identity.sourceCommit !== receipt.sourceCommit) throw new Error("installed archive identity differs");
  identities.push(identity);
  await fs.writeFile(path.join(prefix, "preserve-fixture.txt"), "do not overwrite\n");
  try {
    // Use the already verified Node for the refusal check to avoid a second
    // Thin download. No replacement or fallback action is authorized here.
    await execFile(path.join(prefix, "node/bin/node"), [path.join(root, "install.mjs"), "--prefix", prefix, path.join(prefix, "node")], { env, cwd: home });
    throw new Error("existing installation was unexpectedly accepted");
  } catch (error) {
    if (!error.stderr?.includes("installation prefix already exists")) throw error;
  }
  if (await fs.readFile(path.join(prefix, "preserve-fixture.txt"), "utf8") !== "do not overwrite\n") throw new Error("unknown file was modified");
}
await fs.writeFile(path.join(output, "acceptance.json"), JSON.stringify({ status: "LOCAL_ARCHIVE_ACCEPTANCE_PASS",
  sourceCommit: receipt.sourceCommit, distributionId: receipt.distributionId, fullInstalledOffline: true,
  thinInstalledFromPinnedNode: true, unknownFilesPreserved: true, identities }, null, 2));
console.log(JSON.stringify({ status: "LOCAL_ARCHIVE_ACCEPTANCE_PASS", output }));

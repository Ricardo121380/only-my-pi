import fs from "node:fs/promises";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { extractVerifiedTarGzip } from "../release-stack/safe-extract.mjs";

const execFile = promisify(callback);

/** Build-time only. Downloads are pinned, checked before extraction and kept
 * inside the Pi component's signed tree, including upstream license files. */
export async function stageToolchain({ rootDir, runtimeRoot, work }) {
  const lock = JSON.parse(await fs.readFile(path.join(rootDir, "distribution/toolchain-darwin-arm64.json"), "utf8"));
  const destination = path.join(runtimeRoot, "pi/vendor-tools");
  await fs.mkdir(path.join(destination, "bin"), { recursive: true });
  for (const tool of lock.tools) {
    const archive = path.join(work, `${tool.name}.tar.gz`);
    await execFile("curl", ["--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "120", "--output", archive, tool.url]);
    const extracted = path.join(work, `tool-${tool.name}`);
    await extractVerifiedTarGzip({ archivePath: archive, destination: extracted, expectedSha256: tool.sha256,
      maxEntries: 1000, maxExtractedBytes: 64 * 1024 * 1024 });
    const source = path.join(extracted, tool.archiveRoot);
    const installed = path.join(destination, tool.name);
    await fs.cp(source, installed, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    // Regular files survive npm extraction; do not create tarball symlinks.
    const binary = path.join(destination, "bin", tool.binary);
    await fs.copyFile(path.join(installed, tool.binary), binary);
    await fs.chmod(binary, 0o755);
    const { stdout } = await execFile(binary, ["--version"]);
    if (!stdout.startsWith(`${tool.name} ${tool.version}`)) throw new Error(`tool version differs: ${tool.name}`);
  }
  await fs.writeFile(path.join(destination, "toolchain.json"), `${JSON.stringify(lock, null, 2)}\n`);
}

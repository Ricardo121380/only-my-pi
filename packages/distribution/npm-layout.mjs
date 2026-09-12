import fs from "node:fs/promises";
import path from "node:path";
import { distributionError } from "./runtime.mjs";

function shellQuote(value) { return `'${value.replaceAll("'", `'\\''`)}'`; }

/** npm does not extract tarball symlinks. Materialize audited .bin links as
 * ordinary launch scripts BEFORE hashing/packing, retaining each real entry's
 * directory for relative imports. Other symlink shapes need separate review.
 */
export async function materializeExecutableLinks(runtimeRoot) {
  const root = await fs.realpath(runtimeRoot);
  const converted = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(filename);
        const stat = await fs.stat(target);
        if (path.basename(directory) !== ".bin" || !target.startsWith(`${root}${path.sep}`)
          || !stat.isFile() || (stat.mode & 0o111) === 0)
          throw distributionError("DISTRIBUTION_SYMLINK_UNSUPPORTED", "only contained executable .bin links can be materialized for npm");
        const relative = path.relative(directory, target).split(path.sep).join("/");
        const script = `#!/bin/sh\n# only-my-pi npm-portable executable link\nexec "$(dirname "$0")"/${shellQuote(relative)} "$@"\n`;
        await fs.unlink(filename);
        await fs.writeFile(filename, script, { mode: 0o755, flag: "wx" });
        converted.push({ path: path.relative(root, filename).split(path.sep).join("/"), target: path.relative(root, target).split(path.sep).join("/") });
      } else if (entry.isDirectory()) await visit(filename);
      else if (!entry.isFile()) throw distributionError("DISTRIBUTION_FILE_TYPE_UNSUPPORTED", "runtime contains an unsupported file type");
    }
  }
  await visit(root);
  return converted.sort((a, b) => a.path.localeCompare(b.path));
}

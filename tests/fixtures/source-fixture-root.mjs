import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Each node:test file runs in its own process. Reuse an installation pathname
// only after the previous fixture removed it completely. Pi's source-hash
// checked transpilation cache then behaves like a stable installed extension,
// while settings, project files, sessions and ownership are recreated each time.
const roots = new Map();
export async function createSourceFixtureRoot(prefix) {
  const previous = roots.get(prefix);
  if (previous) {
    try { await fs.mkdir(previous, { mode: 0o700 }); return previous; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    // An occupied or retained failure directory belongs to its original run.
  }
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  roots.set(prefix, root);
  return root;
}

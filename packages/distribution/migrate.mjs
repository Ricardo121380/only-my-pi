import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson, canonicalJson, sha256, withConfigLock, assertSafeContainedPath } from "../config-runtime/index.mjs";
import { validateStackState } from "../release-stack/contracts.mjs";
import { createStackLayout } from "../release-stack/layout.mjs";
import { distributionError, readRegularJson } from "./runtime.mjs";

const fail = (message) => { throw distributionError("LEGACY_MIGRATION_UNSAFE", message); };
const statOrNull = (file) => fs.lstat(file).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});

export async function planLegacyMigration({ runtime, homeDir, env, inspectPaths }) {
  if (!["npm", "homebrew"].includes(runtime.channel) || env.npm_command === "exec" || runtime.root.split(path.sep).includes("_npx"))
    fail("Migration requires a persistent Homebrew or global npm installation.");
  const layout = createStackLayout({ homeDir });
  // Reject redirected parent directories before inspecting any ownership metadata.
  for (const directory of [layout.binRoot, layout.shareRoot])
    await assertSafeContainedPath(homeDir, directory, { leafType: "directory" });
  const receiptsRoot = path.join(layout.shareRoot, "migrations");
  await assertSafeContainedPath(homeDir, receiptsRoot, { leafType: "directory" });
  const receipts = await fs.readdir(receiptsRoot).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of receipts.filter((entry) => /^[a-f0-9-]{36}\.json$/u.test(entry))) {
    const receipt = await readRegularJson(path.join(receiptsRoot, name));
    if (["PREPARED", "LEGACY_MIGRATION_NEEDS_RECONCILIATION"].includes(receipt.status))
      fail(`An incomplete migration requires inspection: ${path.join(receiptsRoot, name)}. Preserve its backup before retrying.`);
  }
  const shim = await statOrNull(layout.ompShim);
  const paths = await inspectPaths({ env, homeDir, runtime });
  const replacement = paths.entries.filter((entry) => entry.path !== layout.ompShim)[0];
  if (!replacement?.current) fail("The next omp on PATH must resolve to this persistent installation.");
  const base = { formatVersion: 1, ok: true, mutation: false, status: "LEGACY_MIGRATION_PLAN",
    distributionId: runtime.stackId, packageVersion: runtime.distribution.version,
    shim: layout.ompShim, replacement: replacement.path, replacementTarget: replacement.target,
    preserved: [layout.piShim, layout.stacksRoot, layout.configRoot] };
  if (!shim) return { ...base, status: "LEGACY_MIGRATION_NOT_NEEDED", action: "none" };
  if (!shim.isSymbolicLink()) fail("The legacy omp entry is not an owned symbolic link; it was left unchanged.");
  await assertSafeContainedPath(homeDir, layout.stateFile, { leafType: "file" });
  const state = validateStackState(await readRegularJson(layout.stateFile));
  const link = await fs.readlink(layout.ompShim);
  const target = path.join(layout.stacksRoot, state.activeStack?.slice(7) ?? "", "bin/omp");
  if (state.status !== "INSTALLED" || state.shims?.omp?.targetClass !== "USER_LOCAL_CONTROLLED_STACK"
    || state.shims?.omp?.digest !== sha256("current-stack/bin/omp")
    || path.resolve(layout.binRoot, link) !== path.join(layout.currentStack, "bin/omp")
    || await fs.realpath(layout.ompShim) !== target)
    fail("The legacy entry does not match its installed ownership record.");
  await assertSafeContainedPath(homeDir, target, { leafType: "file" });
  const plan = { ...base, action: "backup-owned-link", link, stateDigest: state.stateDigest,
    inode: shim.ino, device: shim.dev };
  return { ...plan, planDigest: sha256(canonicalJson(plan)) };
}

export async function migrateLegacy(options) {
  const { argv, homeDir } = options;
  const flags = argv.filter((arg) => arg !== "--json");
  if (argv.filter((arg) => arg === "--json").length > 1
    || ![["--from", "legacy", "--plan"], ["--from", "legacy", "--apply", "--yes"]]
      .some((expected) => canonicalJson(flags) === canonicalJson(expected)))
    throw distributionError("INVALID_ARGUMENT", "Use migrate --from legacy --plan or --from legacy --apply --yes (optionally --json).");
  const plan = await planLegacyMigration(options);
  if (flags.includes("--plan") || plan.action === "none") return plan;
  const layout = createStackLayout({ homeDir });
  return withConfigLock(layout.shareRoot, { operation: "apply" }, async () => {
    const current = await planLegacyMigration(options);
    if (current.planDigest !== plan.planDigest) fail("The migration plan changed; inspect a fresh plan.");
    const id = randomUUID();
    const backup = path.join(layout.binRoot, `.omp-legacy-${id}`);
    const receipt = path.join(layout.shareRoot, "migrations", `${id}.json`);
    const journal = { ...plan, transactionId: id, backup, receipt, status: "PREPARED" };
    await atomicWriteJson(layout.shareRoot, receipt, journal);
    // The unique backup retains the relative link in its original directory.
    const checked = await fs.lstat(layout.ompShim);
    if (!checked.isSymbolicLink() || checked.ino !== plan.inode || checked.dev !== plan.device
      || await fs.readlink(layout.ompShim) !== plan.link || await statOrNull(backup))
      fail("The legacy entry changed before migration; inspect the prepared receipt.");
    await fs.rename(layout.ompShim, backup);
    const parent = await fs.open(layout.binRoot, "r");
    try { await parent.sync(); } finally { await parent.close(); }
    const actual = (await options.inspectPaths(options)).entries[0];
    if (!actual?.current) {
      // Do not overwrite a command created concurrently; the backup is recoverable.
      const result = { ...journal, ok: false, mutation: true, status: "LEGACY_MIGRATION_NEEDS_RECONCILIATION",
        next: `Inspect PATH and the preserved link at ${backup}; no user files were overwritten.` };
      await atomicWriteJson(layout.shareRoot, receipt, result);
      return result;
    }
    const result = { ...journal, mutation: true, status: "LEGACY_MIGRATED",
      next: "Run hash -r in existing shells, then omp admin doctor --json. The old Pi entry, stack and user data are preserved." };
    await atomicWriteJson(layout.shareRoot, receipt, result);
    return result;
  });
}

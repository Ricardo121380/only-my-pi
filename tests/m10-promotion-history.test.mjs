import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectM10Promotion } from "../packages/upstream-migration/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M9_SOURCE = "a5a71b596e8983ffbba8075f02bc2b39ba19a72b";
const M9_EVIDENCE = "2af92de9f701d305f7263aeecec017b7c10bd696";
const M9_HEAD = "e8a84ac";
const M9_MERGE = "510f11ce139a31c6bd495a8d28e25bdd0a58c525";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("M10 preserves the source/evidence M9 commit chain and merge commit", async () => {
  for (const commit of [M9_SOURCE, M9_EVIDENCE, M9_HEAD, M9_MERGE]) assert.doesNotThrow(() => git(["cat-file", "-e", `${commit}^{commit}`]));
  assert.equal(git(["show", "-s", "--format=%P", M9_EVIDENCE]), M9_SOURCE);
  const mergeParents = git(["show", "-s", "--format=%P", M9_MERGE]).split(" ");
  assert.equal(mergeParents.length, 2);
  assert.ok(mergeParents.some((commit) => commit.startsWith(M9_HEAD)));
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", M9_MERGE, "HEAD"]));

  const promotion = await inspectM10Promotion({ rootDir: ROOT });
  assert.ok(["HOLD", "PROMOTE"].includes(promotion.state));
  assert.equal(promotion.decision.defaultPiVersion, promotion.state === "PROMOTE" ? "0.84.3" : "0.84.1");
  assert.equal(promotion.decision.defaultSubagentsVersion, promotion.state === "PROMOTE" ? "0.57.0" : "0.45.2");
});

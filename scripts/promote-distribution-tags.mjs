import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { hashFile } from "../packages/release-stack/deterministic-archive.mjs";

const execFile = promisify(callback);
const [candidate, node22Receipt, node24Receipt, mode] = process.argv.slice(2);
if (![candidate, node22Receipt, node24Receipt].every((item) => path.isAbsolute(item ?? "")) || ![undefined, "--apply"].includes(mode))
  throw new Error("Usage: node scripts/promote-distribution-tags.mjs /candidate /public-node22.json /public-node24.json [--apply]");
const receipt = JSON.parse(await fs.readFile(path.join(candidate, "build-receipt.json"), "utf8"));
if (receipt.version !== "0.4.0-preview.1" || !/^[a-f0-9]{40}$/u.test(receipt.sourceCommit ?? "")
  || !/^sha256:[a-f0-9]{64}$/u.test(receipt.distributionId ?? "")) throw new Error("unexpected promotion identity");
for (const [filename, node] of [[node22Receipt, "22.19.0"], [node24Receipt, "24.19.0"]]) {
  const acceptance = JSON.parse(await fs.readFile(filename, "utf8"));
  if (acceptance.status !== "PUBLIC_INSTALL_ACCEPTANCE_PASS" || acceptance.publicRegistryVerified !== true
    || acceptance.node !== node || acceptance.selector !== `only-my-pi@${receipt.version}`
    || acceptance.sourceCommit !== receipt.sourceCommit || acceptance.distributionId !== receipt.distributionId
    || acceptance.checks?.length !== 9 || acceptance.checks.some((check) => check.exitCode !== 0))
    throw new Error(`exact public installation acceptance is missing for Node ${node}`);
}
const fetchPackage = async (name) => {
  const response = await fetch(`https://registry.npmjs.org/${name}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`npm metadata unavailable: HTTP ${response.status}`);
  return response.json();
};
const journal = { formatVersion: 1, version: receipt.version, sourceCommit: receipt.sourceCommit,
  distributionId: receipt.distributionId, status: "TAG_PROMOTION_PLAN", packages: [], completed: [] };
for (const name of ["only-my-pi-runtime-darwin-arm64", "only-my-pi"]) {
  const item = receipt.artifacts.find((entry) => entry.name === name);
  if (item?.filename !== `${name}-${receipt.version}.tgz` || await hashFile(path.join(candidate, item.filename)) !== item.sha256)
    throw new Error("local candidate bytes differ");
  const metadata = await fetchPackage(name);
  const version = metadata.versions?.[receipt.version];
  const integrity = `sha512-${crypto.createHash("sha512").update(await fs.readFile(path.join(candidate, item.filename))).digest("base64")}`;
  if (version?.dist?.integrity !== integrity || version.dist.attestations?.provenance?.predicateType !== "https://slsa.dev/provenance/v1")
    throw new Error("public package bytes or provenance differ");
  journal.packages.push({ name, integrity, previousTags: metadata["dist-tags"] });
}
if (mode === "--apply") {
  const save = () => fs.writeFile(path.join(candidate, "npm-default-tags.json"), `${JSON.stringify(journal, null, 2)}\n`);
  await save();
  try {
    for (const { name } of journal.packages) {
      for (const tag of ["preview", "latest"]) {
        if ((await fetchPackage(name))["dist-tags"]?.[tag] !== receipt.version)
          await execFile("npm", ["dist-tag", "add", `${name}@${receipt.version}`, tag, "--registry", "https://registry.npmjs.org"], { timeout: 60_000 });
        if ((await fetchPackage(name))["dist-tags"]?.[tag] !== receipt.version) throw new Error(`tag update was not confirmed: ${name}:${tag}`);
        journal.completed.push({ name, tag, version: receipt.version });
        await save();
      }
    }
    journal.status = "DEFAULT_TAGS_PROMOTED_AWAITING_DEFAULT_INSTALL_CHECKS";
    await save();
  } catch (error) { journal.status = "PARTIAL_TAG_PROMOTION_REQUIRES_RESUME"; await save(); throw error; }
}
console.log(JSON.stringify(journal, null, 2));

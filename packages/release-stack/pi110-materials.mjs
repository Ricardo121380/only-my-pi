import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../config-runtime/index.mjs";
import { sha256, validateStackManifest, validateArtifactLedger, EMBEDDED_NODE_ARCHIVE_SHA256, EMBEDDED_NODE_VERSION } from "./contracts.mjs";
import { createSpdxSbom, renderThirdPartyNotices } from "./sbom.mjs";

export const PI110_INPUT_SHA256 = "sha256:13e384c15ebe3fadc7ef10c363fc2e38bfeed1b2072cbc00de8e2d24bb58ff22";
export const PI130_INPUT_SHA256 = "sha256:9fb1a3df114bb57722112ed527997bfdaea5652c0f6637d13a2bc3de9ce4487d";
// Historical Pi110 exports remain callable; each version selects its own bytes.
export const FROZEN_PI_INPUTS = Object.freeze({
  "1.1.0": Object.freeze({ id: "pi110", runtimeContract: "pi110-v1", purpose: "GP110-04_PI_INPUT", sha256: PI110_INPUT_SHA256 }),
  "1.3.0": Object.freeze({ id: "pi130", runtimeContract: "pi130-v1", purpose: "GP130-02_PI_INPUT", sha256: PI130_INPUT_SHA256 }),
});
export function runtimeInputForContract(runtimeContract) {
  return Object.entries(FROZEN_PI_INPUTS).find(([, input]) => input.runtimeContract === runtimeContract)?.[0];
}
const ROOTS = ["node", "pi", "external-npm", "only-my-pi/package"];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

async function regularBytes(filename, missingCode = "PI110_INPUT_MISSING") {
  const stat = await fs.lstat(filename).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024
    || await fs.realpath(filename) !== path.resolve(filename)) fail(missingCode, "Pi runtime input must be a bounded regular file");
  return fs.readFile(filename);
}

function parseInputs(bytes, piVersion = "1.1.0") {
  const contract = FROZEN_PI_INPUTS[piVersion];
  if (!contract) fail("STACK_PI_IDENTITY_INVALID", "unknown frozen Pi input contract");
  if (sha256(bytes) !== contract.sha256) fail(`${contract.id.toUpperCase()}_INPUT_DRIFT`, "Pi input contract differs from its reviewed identity");
  return JSON.parse(bytes.toString("utf8"));
}

export async function loadPi110Inputs(rootDir, piVersion = "1.1.0") {
  const contract = FROZEN_PI_INPUTS[piVersion];
  if (!contract) fail("STACK_PI_IDENTITY_INVALID", "unknown frozen Pi input contract");
  const root = path.join(rootDir, "contracts/release", contract.id);
  const bytes = await regularBytes(path.join(root, "inputs.json"), `${contract.id.toUpperCase()}_INPUT_MISSING`);
  const inputs = parseInputs(bytes, piVersion);
  const files = {};
  for (const [name, digest] of Object.entries(inputs.files)) {
    files[name] = await regularBytes(path.join(root, name), `${contract.id.toUpperCase()}_INPUT_MISSING`);
    if (sha256(files[name]) !== digest) fail(`${contract.id.toUpperCase()}_INPUT_DRIFT`, `Pi frozen input differs: ${name}`);
  }
  return { inputs, bytes, files };
}

export async function verifyPi110Resources(piRoot, inputs) {
  for (const item of inputs.resources) {
    const metadata = JSON.parse(await regularBytes(path.join(piRoot, "node_modules", item.package, "package.json")));
    if (metadata.name !== item.package || metadata.version !== item.version) fail("PI110_RESOURCE_VERSION_INVALID", `Pi resource package differs: ${item.package}`);
    const filename = path.join(piRoot, item.path);
    const bytes = await regularBytes(filename);
    const stat = await fs.stat(filename);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256 || (stat.mode & 0o111) !== item.executable) {
      fail("PI110_RESOURCE_DRIFT", `Pi resource bytes or executable bits differ: ${item.path}`);
    }
  }
}

// File membership, bytes and execute bits are independent of the historical
// content digests, which deliberately do not include file modes.
async function inventory(root, roots, skipTop = []) {
  const entries = [];
  async function visit(relative) {
    const filename = path.join(root, relative);
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) {
      const real = await fs.realpath(filename);
      if (!real.startsWith(`${root}${path.sep}`)) fail("PI110_TREE_ESCAPE", `Pi runtime link escapes: ${relative}`);
      entries.push({ path: relative, type: "link", target: await fs.readlink(filename) });
    } else if (stat.isDirectory()) {
      entries.push({ path: relative, type: "directory" });
      for (const name of (await fs.readdir(filename)).sort()) {
        if (relative === "." && skipTop.includes(name)) continue;
        await visit(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      entries.push({ path: relative, type: "file", bytes: stat.size, sha256: sha256(await fs.readFile(filename)), executable: stat.mode & 0o111 });
    } else fail("PI110_TREE_TYPE_INVALID", `Pi runtime entry has unsupported type: ${relative}`);
  }
  for (const relative of roots) await visit(relative);
  return entries;
}

export async function verifyPi110AcquiredTrees({ resolved, artifactTreeRoots }) {
  let packages = 0;
  for (const relative of ["pi", "external-npm"]) {
    const npmRoot = path.join(resolved, relative);
    const lock = JSON.parse(await regularBytes(path.join(npmRoot, relative === "pi" ? "npm-shrinkwrap.json" : "package-lock.json")));
    for (const [entry, locked] of Object.entries(lock.packages)) {
      if (entry === "" && relative !== "pi") continue;
      const installed = path.join(npmRoot, entry);
      if (!await fs.lstat(installed).catch(() => null) && locked.optional === true) continue;
      const manifest = JSON.parse(await regularBytes(path.join(installed, "package.json")));
      const identity = `${manifest.name}@${manifest.version}`;
      const acquired = artifactTreeRoots.get(identity);
      if (!acquired) fail("PI110_ACQUISITION_MISSING", `Pi runtime archive is missing: ${identity}`);
      const skip = entry === "" ? ["node_modules", "npm-shrinkwrap.json", "omp-runtime-inputs.json"] : ["node_modules"];
      const actual = await inventory(installed, ["."], skip);
      const expected = await inventory(acquired, ["."], ["node_modules"]);
      // npm makes declared bin targets executable even with lifecycle scripts
      // disabled. No other file mode or byte normalization is admitted.
      const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
      if (entry !== "") for (const item of expected) {
        if (item.type === "file" && bins.some(bin => path.posix.normalize(`./${bin}`) === item.path.slice(2))) item.executable |= 0o111;
      }
      if (canonicalJson(actual) !== canonicalJson(expected)) fail("PI110_ACQUISITION_DRIFT", `Installed package differs from acquired archive: ${identity}`);
      packages++;
    }
  }
  return { packages };
}

export async function writePi110Materials({ resolved, sourceCommit, licensesRoot, patches, piVersion = "1.1.0" }) {
  const contract = FROZEN_PI_INPUTS[piVersion];
  const inputBytes = await regularBytes(path.join(resolved, "pi/omp-runtime-inputs.json"));
  const inputs = parseInputs(inputBytes, piVersion);
  await verifyPi110Resources(path.join(resolved, "pi"), inputs);
  const materials = { formatVersion: 1, kind: "only-my-pi-private-runtime-materials", purpose: inputs.purpose,
    sourceCommit, piVersion, platform: inputs.platform, nodeVersions: inputs.nodeVersions,
    inputSha256: contract.sha256, roots: ROOTS, entries: await inventory(resolved, ROOTS),
    licenses: await inventory(licensesRoot, (await fs.readdir(licensesRoot)).sort()), patches };
  const bytes = Buffer.from(`${JSON.stringify(materials, null, 2)}\n`);
  await fs.writeFile(path.join(resolved, `${contract.id}-materials.json`), bytes, { flag: "wx", mode: 0o600 });
  return sha256(bytes);
}

export async function verifyPi110Materials({ root, manifest }) {
  const piVersion = runtimeInputForContract(manifest.runtimeContract);
  const contract = FROZEN_PI_INPUTS[piVersion];
  if (!contract) fail("STACK_PI_IDENTITY_INVALID", "unknown frozen Pi materials contract");
  const bytes = await regularBytes(path.join(root, `${contract.id}-materials.json`));
  if (sha256(bytes) !== manifest.runtimeMaterialsDigest) fail("PI110_MATERIALS_DRIFT", "Pi runtime materials differ from the distribution binding");
  const materials = JSON.parse(bytes.toString("utf8"));
  if (materials.kind !== "only-my-pi-private-runtime-materials" || materials.formatVersion !== 1
    || materials.purpose !== contract.purpose || materials.piVersion !== piVersion
    || materials.sourceCommit !== manifest.sourceCommit || materials.platform !== "darwin-arm64"
    || canonicalJson(materials.nodeVersions) !== canonicalJson(["22.19.0", "24.19.0"])
    || materials.inputSha256 !== contract.sha256 || canonicalJson(materials.roots) !== canonicalJson(ROOTS)) {
    fail("PI110_MATERIALS_IDENTITY_INVALID", "Pi runtime materials have an unsupported purpose, version or platform");
  }
  const inputs = parseInputs(await regularBytes(path.join(root, "pi/omp-runtime-inputs.json")), piVersion);
  if (sha256(await regularBytes(path.join(root, "pi/npm-shrinkwrap.json"))) !== inputs.files["package-lock.json"]
    || sha256(await regularBytes(path.join(root, "pi/package.json"))) !== inputs.package.manifestSha256) {
    fail("PI110_INPUT_DRIFT", "Pi runtime package or dependency lock differs");
  }
  await verifyPi110Resources(path.join(root, "pi"), inputs);
  if (canonicalJson(await inventory(root, ROOTS)) !== canonicalJson(materials.entries)) fail("PI110_TREE_DRIFT", "Pi runtime file set, bytes, links or execute bits differ");
  const licensesRoot = path.join(root, "LICENSES");
  if (canonicalJson(await inventory(licensesRoot, (await fs.readdir(licensesRoot)).sort())) !== canonicalJson(materials.licenses)) {
    fail("PI110_LICENSE_DRIFT", "Pi runtime license texts differ or are missing");
  }
  return materials;
}

// Declarations are generated after the material snapshot, so verify their
// canonical bindings separately instead of creating a circular tree digest.
export async function verifyPi110Declarations({ root, manifest }) {
  const read = async name => JSON.parse((await regularBytes(path.join(root, name))).toString("utf8"));
  const stack = validateStackManifest(await read("stack-manifest.json"));
  const ledger = validateArtifactLedger(await read("transitive-artifact-ledger.json"));
  if (stack.runtime.pi.version !== runtimeInputForContract(manifest.runtimeContract) || stack.privateRuntimeDigest !== manifest.distributionId
    || stack.sourceCommit !== manifest.sourceCommit || ledger.sourceCommit !== stack.sourceCommit
    || ledger.ledgerDigest !== stack.transitiveLedgerSha256) fail("PI110_DECLARATION_BINDING_INVALID", "Pi declarations differ from the private stack");
  if (canonicalJson(await read("sbom.spdx.json")) !== canonicalJson(createSpdxSbom({ stackManifest: stack, ledger }))
    || (await regularBytes(path.join(root, "THIRD_PARTY_NOTICES.txt"))).toString("utf8") !== renderThirdPartyNotices({ stackManifest: stack, ledger })) {
    fail("PI110_DECLARATION_DRIFT", "Pi SBOM or notices differ from the acquired dependency ledger");
  }
  const runtime = await read("runtime-sbom.spdx.json");
  const comment = `sourceCommit=${stack.sourceCommit}; stackId=${stack.stackId}; privateRuntime=${manifest.distributionId}; embeddedNode=${stack.runtime.node.version}; no protected acceptance evidence is inherited`;
  if (runtime.spdxVersion !== "SPDX-2.3" || runtime.annotations?.[0]?.comment !== comment
    || !Array.isArray(runtime.packages)) fail("PI110_DECLARATION_BINDING_INVALID", "Pi runtime declaration identity differs");
  for (const artifact of ledger.artifacts) {
    const item = runtime.packages.find(x => x.name === artifact.name && x.versionInfo === artifact.version);
    const checksums = item?.checksums ?? [];
    if (!item || item.licenseDeclared !== artifact.license || item.licenseConcluded !== artifact.license
      || item.downloadLocation !== artifact.tarballUrl
      || !checksums.some(x => x.algorithm === "SHA256" && x.checksumValue === artifact.sha256.slice(7))
      || !checksums.some(x => x.algorithm === "SHA512" && x.checksumValue === Buffer.from(artifact.integrity.slice(7), "base64").toString("hex"))) {
      fail("PI110_DECLARATION_DRIFT", `Pi runtime declaration differs: ${artifact.name}`);
    }
  }
  const tools = await read("pi/vendor-tools/toolchain.json");
  for (const tool of [...tools.tools, { name: "node", version: EMBEDDED_NODE_VERSION, sha256: EMBEDDED_NODE_ARCHIVE_SHA256 }]) {
    const item = runtime.packages.find(x => x.name === tool.name && x.versionInfo === tool.version);
    if (!item?.checksums?.some(x => x.algorithm === "SHA256" && x.checksumValue === tool.sha256.slice(7))) {
      fail("PI110_DECLARATION_DRIFT", `Pi runtime non-npm declaration differs: ${tool.name}`);
    }
  }
  return { artifacts: ledger.artifacts.length, nonNpm: tools.tools.length + 1 };
}

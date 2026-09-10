import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { parseOmpArgs } from "../packages/control-service/cli-parser.mjs";
import {
  DIRECT_AGENT_CAPABILITY_CEILING,
  DIRECT_AGENT_OVERLAYS,
  DIRECT_AGENT_VERSION,
  LEGACY_HARNESS_VERSION,
  productBoundaryForVersion,
} from "../packages/direct-agent/product-contract.mjs";
import { PREVIEW_VERSION } from "../packages/release-stack/contracts.mjs";

async function json(relative) {
  return JSON.parse(await fs.readFile(new URL(`../${relative}`, import.meta.url), "utf8"));
}

test("M12 is the current guarded coding product and M11 remains retired foundation", async () => {
  const packageManifest = await json("package.json");
  const daily = await json("presets/daily.json");
  const writer = await json("overlays/writer.json");
  assert.equal(packageManifest.version, DIRECT_AGENT_VERSION);
  assert.equal(PREVIEW_VERSION, DIRECT_AGENT_VERSION);
  assert.equal(LEGACY_HARNESS_VERSION, "0.2.0-preview.1");
  assert.deepEqual(productBoundaryForVersion(DIRECT_AGENT_VERSION).capabilityCeiling, DIRECT_AGENT_CAPABILITY_CEILING);
  assert.equal(productBoundaryForVersion(DIRECT_AGENT_VERSION).currentProductContract, true);
  assert.equal(productBoundaryForVersion(DIRECT_AGENT_VERSION).currentReleaseAuthority, false);
  assert.equal(productBoundaryForVersion(DIRECT_AGENT_VERSION).publicationDecision, "HOLD_PUBLICATION");
  assert.equal(productBoundaryForVersion(LEGACY_HARNESS_VERSION).currentReleaseAuthority, false);
  assert.equal(productBoundaryForVersion(LEGACY_HARNESS_VERSION).product, "INTERNAL_DISTRIBUTION_FOUNDATION");
  assert.throws(() => productBoundaryForVersion("0.4.0-preview.1"), { code: "OMP_PREVIEW_VERSION_UNSUPPORTED" });
  assert.ok(daily.overlays.includes("writer"));
  assert.equal(writer.available, true);
  assert.ok(writer.capabilityIds.includes("guarded-project-coding"));
  assert.deepEqual(DIRECT_AGENT_OVERLAYS.enabled, ["web", "orchestration-readonly", "ui-terminal", "writer"]);
});

test("M12 release grammar is exact and does not revive an unversioned release channel", () => {
  const context = { env: {}, homedir: () => "/tmp/omp-home" };
  const current = parseOmpArgs(["stack", "install", "--release", DIRECT_AGENT_VERSION], context);
  assert.equal(current.options.release, DIRECT_AGENT_VERSION);
  assert.equal(current.options.payload, "thin");
  assert.throws(() => parseOmpArgs(["stack", "install", "--release", "latest"], context));
  assert.throws(() => parseOmpArgs(["stack", "install", "--release", "0.4.0-preview.1"], context));
});

test("public documentation leads with omp and explicitly withholds the obsolete M11 release", async () => {
  const [readme, status, adr, installer] = await Promise.all([
    fs.readFile(new URL("../README.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../docs/STATUS.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../docs/decisions/ADR-0013-direct-terminal-coding-agent.md", import.meta.url), "utf8"),
    fs.readFile(new URL("../distribution/install.sh", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /\n\s*omp\s*\n/u);
  assert.match(readme, /0\.2\.0-preview\.1.*HOLD_PUBLICATION/su);
  assert.doesNotMatch(readme, /releases\/download\/v0\.2\.0-preview\.1/u);
  assert.match(status, /GUARDED_PROJECT_CODING/u);
  assert.match(adr, /Pi remains the sole TUI, session and model runtime/u);
  assert.match(installer, /VERSION='0\.3\.0-preview\.1'/u);
});

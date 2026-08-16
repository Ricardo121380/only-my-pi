import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePackageSpec,
  validatePackageEntrySource,
  validateSri,
} from "../scripts/lib/package-source.mjs";
import { auditPackageGovernance, loadGovernance } from "../scripts/package-doctor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fullSha = "0123456789abcdef0123456789abcdef01234567";
const validSri = "sha512-6yJoJ2nXsvnXAaEzr1iQlpUMqOFnDX+rMYVRXE/uV6OVmeB1AxFr9jm0H8N+1jr7Q0WebjtVSNE6dTOwaBGurA==";

test("package sources accept exact canonical npm semver", () => {
  assert.deepEqual(parsePackageSpec("npm:pi-example@1.2.3"), {
    type: "npm",
    name: "pi-example",
    version: "1.2.3",
    normalized: "npm:pi-example@1.2.3",
  });
  assert.equal(parsePackageSpec("npm:@scope/pi-example@1.2.3-beta.1").version, "1.2.3-beta.1");
});

test("package sources reject npm tags, ranges, aliases, and non-canonical versions", () => {
  for (const spec of [
    "npm:pi-example@latest",
    "npm:pi-example@^1.2.3",
    "npm:pi-example@~1.2.3",
    "npm:pi-example@1.2",
    "npm:pi-example@v1.2.3",
    "npm:pi-example@1.2.3+local",
    "npm:Pi-Example@1.2.3",
    "pi-example@1.2.3",
  ]) {
    assert.throws(() => parsePackageSpec(spec), TypeError, spec);
  }
});

test("git package sources require an explicit safe URL and full lowercase commit SHA", () => {
  assert.equal(
    parsePackageSpec(`git+https://github.com/example/pi-package.git#${fullSha}`).commit,
    fullSha,
  );
  assert.equal(
    parsePackageSpec(`git+ssh://git@github.com/example/pi-package.git#${fullSha}`).protocol,
    "git+ssh",
  );

  for (const spec of [
    "git+https://github.com/example/pi-package.git#main",
    "git+https://github.com/example/pi-package.git#0123456",
    `git+https://user:secret@github.com/example/pi-package.git#${fullSha}`,
    `git://github.com/example/pi-package.git#${fullSha}`,
    `github:example/pi-package#${fullSha}`,
    `git+https://github.com/example/pi-package.git?ref=main#${fullSha}`,
  ]) {
    assert.throws(() => parsePackageSpec(spec), TypeError, spec);
  }
});

test("promoted npm entries require one canonical sha512 SRI", () => {
  assert.equal(validateSri(validSri), validSri);
  assert.equal(
    validatePackageEntrySource({
      id: "example",
      spec: "npm:pi-example@1.2.3",
      installed: true,
      audit: { integrity: validSri },
    }).integrity,
    validSri,
  );
  assert.throws(
    () => validatePackageEntrySource({ id: "example", spec: "npm:pi-example@1.2.3", installed: true }),
    /requires sha512 SRI/,
  );
  assert.throws(
    () => validateSri("sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    /exactly one sha512/,
  );
  assert.throws(
    () => validatePackageEntrySource({
      id: "example",
      spec: "npm:pi-example@1.2.3",
      installed: true,
      integrity: validSri,
      audit: { integrity: "sha512-AAAAAAAA" },
    }),
    /conflicting integrity/,
  );
});

test("candidate npm entries may omit SRI but recorded SRI is still validated", () => {
  assert.equal(
    validatePackageEntrySource({ id: "candidate", spec: "npm:pi-candidate@0.1.0" }, { promoted: false }).integrity,
    undefined,
  );
  assert.throws(
    () => validatePackageEntrySource({
      id: "candidate",
      spec: "npm:pi-candidate@0.1.0",
      audit: { integrity: "not-sri" },
    }, { promoted: false }),
    /integrity/,
  );
});

test("production package inventory has exact sources and SRI for every promotion", () => {
  const governance = loadGovernance(root);
  for (const entry of governance.inventory.packages) {
    const source = validatePackageEntrySource(entry, { promoted: true });
    assert.equal(source.type, "npm");
    assert.match(source.integrity, /^sha512-/);
  }
  const result = auditPackageGovernance(governance);
  assert.equal(result.errors, 0, JSON.stringify(result.findings, null, 2));
  assert.equal(result.scope, "static-declarations-only");
  assert.equal(result.runtimeEvidence, "not-evaluated");
});

test("every promoted package has an exact disabled lifecycle audit", () => {
  const packages = loadGovernance(root).inventory.packages;
  const expectedScripts = new Map([
    [
      "permission-modes",
      [{
        name: "postinstall",
        commandSha256: "sha256:2339ab6db8e67f0e2c8616f1fb3c57c972942ba15776090acd4fbefce4f33338",
        necessity: "not-required",
      }],
    ],
    [
      "memory",
      [{
        name: "postinstall",
        commandSha256: "sha256:9fb2978bb4dfeb2719e77a68d657788c06408485f81390b06d29dcb33176994f",
        necessity: "not-required",
      }],
    ],
  ]);

  for (const entry of packages) {
    assert.deepEqual(Object.keys(entry.audit.lifecycle).sort(), ["execution", "scripts"], entry.id);
    assert.equal(entry.audit.lifecycle.execution, "disabled", entry.id);
    assert.equal(entry.audit.lifecycleScripts, undefined, entry.id);
    assert.deepEqual(entry.audit.lifecycle.scripts, expectedScripts.get(entry.id) ?? [], entry.id);
    for (const script of entry.audit.lifecycle.scripts) {
      assert.deepEqual(Object.keys(script).sort(), ["commandSha256", "name", "necessity"], `${entry.id}/${script.name}`);
    }
  }
});

test("required lifecycle scripts remain unavailable without an outer sandbox executor", () => {
  const governance = structuredClone(loadGovernance(root));
  governance.inventory.packages[0].audit.lifecycle.scripts = [{
    name: "postinstall",
    commandSha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    necessity: "required",
  }];

  const result = auditPackageGovernance(governance);
  const finding = result.findings.find((entry) => entry.code === "lifecycle-sandbox-unavailable");
  assert.deepEqual(finding, {
    severity: "error",
    code: "lifecycle-sandbox-unavailable",
    message: "Promoted package plan-mode requires lifecycle script postinstall, but no outer sandbox executor is configured.",
    packageId: "plan-mode",
  });
});

test("package topology keeps Pi as a peer and direct tooling dependencies exact", () => {
  const governance = loadGovernance(root);
  const manifest = governance.packageManifest;
  assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.match(manifest.devDependencies["@earendil-works/pi-coding-agent"], /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.dependencies["@earendil-works/pi-coding-agent"], undefined);
  for (const dependency of ["ajv", "ajv-formats", "semver", "ssri"]) {
    assert.match(manifest.dependencies[dependency], /^\d+\.\d+\.\d+$/);
  }
  assert.ok(fs.existsSync(path.join(root, "package-lock.json")));
});

test("first-party inventory covers manifest resources, contract seeds, and non-default Labs", () => {
  const governance = loadGovernance(root);
  const resources = governance.resources.resources;
  const byId = new Map(resources.map((resource) => [resource.id, resource]));

  for (const id of [
    "session-ledger",
    "context-doctor",
    "skills-root",
    "prompts-root",
    "themes-root",
    "only-my-pi-dark-theme-contract",
    "omp-theme-service",
    "omp-status-service",
    "inspect-mode",
    "scout-agent",
    "single-agent-safe-workflow",
    "research-synthesis-recipe",
  ]) {
    assert.ok(byId.has(id), id);
  }
  assert.equal(byId.get("inspect-mode").lifecycle, "stable");
  assert.equal(byId.get("inspect-mode").defaultLoaded, false);
  assert.equal(byId.get("inspect-mode").packaged, true);
  for (const id of ["scout-agent", "single-agent-safe-workflow"]) {
    assert.equal(byId.get(id).lifecycle, "planned");
    assert.equal(byId.get(id).defaultLoaded, false);
    assert.equal(byId.get(id).packaged, true);
  }
  assert.equal(byId.get("research-synthesis-recipe").lifecycle, "stable");
  assert.equal(byId.get("research-synthesis-recipe").defaultLoaded, false);
  assert.equal(byId.get("research-synthesis-recipe").packaged, true);
  assert.equal(resources.filter((resource) => resource.id === "scout-agent").length, 1);
  assert.ok(fs.existsSync(path.join(root, "agents", "scout.json")));
  assert.ok(fs.existsSync(path.join(root, "agents", "generated", "omp-scout.md")));

  for (const resource of resources.filter((entry) => entry.lifecycle === "labs")) {
    assert.equal(resource.defaultLoaded, false);
    assert.equal(resource.packaged, false);
  }
});

test("permission package records conditional Bash isolation without whole-session overclaim", () => {
  const permission = loadGovernance(root).inventory.packages.find((entry) => entry.id === "permission-modes");
  assert.ok(permission.risk.includes("conditional-bash-sandbox"));
  assert.ok(permission.risk.includes("degraded-prompt-fallback"));
  assert.match(permission.notes, /@anthropic-ai\/sandbox-runtime/);
  assert.match(permission.notes, /never infer file, Web, MCP, Provider, extension, or whole-session isolation/i);
});

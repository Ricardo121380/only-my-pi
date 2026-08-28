import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");

function text(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function json(relativePath) {
  return JSON.parse(text(relativePath));
}

test("source dossier pins every implementation reference to an identity and license boundary", () => {
  const dossier = text("docs/research/2026-08-18-subagents-source-dossiers.md");
  for (const required of [
    "pi-subagents@0.57.0",
    "aa2d3e8ed9aacf161b03354c65a93f58c977af47152ad23f698b360f65e6018b",
    "9e25af0a6c8f2657a721f425bf5408798abfaaffb4495a56a0c7d2959669b882",
    "pi-subagents@0.45.2",
    "7836c0f5ef642a00ae0572c910dec7a56216c74d",
    "@moonshot-ai/kimi-code@0.36.1",
    "13d86f8b7bb2443a3b8222e7d94deb0a66429f8e",
    "99f6f02fecdb7dff40c3fbc9470f5907c29f74ca",
    "f1e05aa766b729788e9c53892cfa0dd940aa36e1",
    "98338ff37aea6627777b9978963ab727f51e4f40",
    "d4b415f8abc0ba242eaa4795b4c190d7a8dbc8d1",
    "65c35977bd564e23c0e9cf124b3e3e3b9308e9e8",
    "ede5247893a50297a47c9aa5038e6ab28312ff50",
    "7c4ba2219166700becb68d6db35989ebcaa52f69",
    "Clean-room concept adoption only",
    "Reference only; no Kimi runtime or package dependency",
  ]) assert.ok(dossier.includes(required), `missing provenance pin: ${required}`);
  assert.ok((dossier.match(/\| MIT \|/gu) ?? []).length >= 5);
  assert.ok((dossier.match(/\| Apache-2\.0 \|/gu) ?? []).length >= 3);
});

test("runtime dependencies contain no referenced harness or second scheduler package", () => {
  const packageManifest = json("package.json");
  const dependencies = Object.keys(packageManifest.dependencies ?? {});
  const forbidden = ["kimi", "claude", "cline", "opencode", "openhands", "goose", "deepseek-harness", "pi-dynamic-workflows"];
  for (const name of dependencies) {
    assert.equal(forbidden.some((fragment) => name.toLowerCase().includes(fragment)), false, name);
  }
  assert.equal(packageManifest.license, "MIT");
  assert.equal(packageManifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
});

test("the sole physical backend inventory pin matches the audited dossier byte identity", () => {
  const inventory = json("inventory/packages.lock.json");
  const backend = inventory.packages.find((entry) => entry.id === "subagents");
  assert.equal(backend.spec, "npm:pi-subagents@0.57.0");
  assert.equal(backend.audit.integrity, "sha512-CvsOBp61dZU+HV3kHdfFc+iBuO9DOI5nvTiGrSaFVpH7XK5/22QbBAdjcrhOjcSzA5Ev3l0Qr/JC1I8VLES9Bw==");
  assert.deepEqual(backend.owners, ["subagents"]);
  const source = text("packages/subagents/adapters/pi-subagents-rpc-v1/compiler.mjs");
  assert.equal(source.includes("@moonshot-ai"), false);
  assert.equal(source.includes("deepseek-harness"), false);
  assert.equal(source.includes("pi-dynamic-workflows"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { compilePublishedSettings, compileUninstalledSettings } from "../packages/bootstrap/settings-merge.mjs";

const generationA = {
  packages: ["./only-my-pi/generations/a/npm/plan-mode"],
  extensions: ["./only-my-pi/generations/a/resources/session-ledger/index.ts"],
  skills: [],
  prompts: [],
  themes: [],
};

const metadata = {
  profileId: "coding",
  generationId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  graphDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  providerSelection: { providerId: "deepseek", modelId: "deepseek-v4-pro", status: "CONFIGURED_UNVERIFIED" },
  initialMode: { id: "coding", status: "PENDING_M3_RESOLUTION" },
};

test("published settings preserve unknown fields and user-managed resources", () => {
  const existing = {
    customField: { untouched: true },
    packages: ["npm:user-package@1.0.0"],
    extensions: ["/user/extension.ts"],
    skills: ["/user/skills"],
    prompts: [],
    themes: ["/user/theme.json"],
  };
  const result = compilePublishedSettings(existing, generationA, metadata);
  assert.deepEqual(result.customField, { untouched: true });
  assert.deepEqual(result.packages, ["npm:user-package@1.0.0", generationA.packages[0]]);
  assert.deepEqual(result.extensions, ["/user/extension.ts", generationA.extensions[0]]);
  assert.equal(result.onlyMyPi.providerSelection.status, "CONFIGURED_UNVERIFIED");
});

test("second publish is idempotent and replaces only prior managed values", () => {
  const first = compilePublishedSettings({}, generationA, metadata);
  const second = compilePublishedSettings(first, generationA, metadata);
  assert.deepEqual(second, first);

  const generationB = { ...generationA, packages: ["./only-my-pi/generations/b/npm/plan-mode"] };
  const generationId = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const upgraded = compilePublishedSettings(second, generationB, { ...metadata, generationId, graphDigest: generationId });
  assert.deepEqual(upgraded.packages, generationB.packages);
  assert.equal(JSON.stringify(upgraded).includes("generations/a/npm"), false);
});

test("uninstall removes only recorded values and owned metadata", () => {
  const installed = compilePublishedSettings({ packages: ["npm:user@1.0.0"], unknown: 42 }, generationA, metadata);
  const uninstalled = compileUninstalledSettings(installed);
  assert.deepEqual(uninstalled.packages, ["npm:user@1.0.0"]);
  assert.equal(uninstalled.unknown, 42);
  assert.equal(Object.hasOwn(uninstalled, "onlyMyPi"), false);
});

test("malformed ownership metadata fails closed", () => {
  assert.throws(() => compilePublishedSettings({ onlyMyPi: { formatVersion: 99 } }, generationA, metadata), /malformed or unsupported/);
  assert.throws(() => compilePublishedSettings({ packages: {} }, generationA, metadata), /must be an array/);
});

test("provider and mode metadata cannot claim verification or smuggle unknown fields", () => {
  assert.throws(
    () => compilePublishedSettings({}, generationA, {
      ...metadata,
      providerSelection: { ...metadata.providerSelection, status: "VERIFIED" },
    }),
    { code: "OWNED_METADATA_INVALID" },
  );
  assert.throws(
    () => compilePublishedSettings({}, generationA, {
      ...metadata,
      providerSelection: { ...metadata.providerSelection, apiKey: "forbidden" },
    }),
    { code: "OWNED_METADATA_INVALID" },
  );
  assert.throws(
    () => compilePublishedSettings({}, generationA, {
      ...metadata,
      initialMode: { id: "coding", status: "ACTIVE" },
    }),
    { code: "OWNED_METADATA_INVALID" },
  );
});

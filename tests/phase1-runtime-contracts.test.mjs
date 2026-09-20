import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import { finalizeStackManifest, validateReleaseIndex, piRuntimeContract } from "../packages/release-stack/contracts.mjs";

const read = async (file) => JSON.parse(await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8"));

test("candidate identity is opt-in and legacy defaults remain unchanged", () => {
  assert.equal(piRuntimeContract().version, "0.84.3");
  assert.equal(piRuntimeContract("0.85.1").version, "0.85.1");
  for (const version of ["latest", "0.85.2", "toString", null]) {
    assert.throws(() => piRuntimeContract(version), { code: "STACK_PI_IDENTITY_INVALID" });
  }
});

test("both Pi contracts validate, but cross-version SRI does not", async () => {
  const manifest = await read("contracts/release/stack-manifest.example.json");
  const schema = await read("schemas/stack-manifest-v1.schema.json");
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const version of ["0.84.3", "0.85.1"]) {
    const candidate = structuredClone(manifest);
    Object.assign(candidate.runtime.pi, piRuntimeContract(version));
    const finalized = finalizeStackManifest(candidate);
    assert.equal(validate(finalized), true, JSON.stringify(validate.errors));
    candidate.runtime.pi.integrity = piRuntimeContract(version === "0.84.3" ? "0.85.1" : "0.84.3").integrity;
    assert.throws(() => finalizeStackManifest(candidate), { code: "STACK_PI_IDENTITY_INVALID" });
    assert.equal(validate(candidate), false);
  }
});

test("release indexes accept only explicitly known Pi versions", async () => {
  const index = await read("contracts/release/release-index.example.json");
  for (const piVersion of ["0.84.3", "0.85.1"]) {
    assert.equal(validateReleaseIndex({ ...index, supportedStack: { ...index.supportedStack, piVersion } }).supportedStack.piVersion, piVersion);
  }
  assert.throws(() => validateReleaseIndex({ ...index, supportedStack: { ...index.supportedStack, piVersion: "0.85.2" } }), { code: "RELEASE_STACK_TUPLE_INVALID" });
});

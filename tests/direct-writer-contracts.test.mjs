import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateDirectWriter } from "../packages/direct-agent/contracts.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const patch = { relativePath: "runs/example/artifacts/writer.patch", byteLength: 12, digest };
const base = { stage: "PREPARING", application: "NOT_STARTED", verification: "NOT_RUN", patchDigest: null, patch: null, receiptDigest: null, failureCode: null, updatedAt: "2026-09-20T00:00:00.000Z" };

test("writer patch identity and reference must appear together", () => {
  assert.doesNotThrow(() => validateDirectWriter(base));
  assert.doesNotThrow(() => validateDirectWriter({ ...base, stage: "PATCH_CAPTURED", patchDigest: digest, patch }));
  for (const state of [{ ...base, patchDigest: digest }, { ...base, patch }]) {
    assert.throws(() => validateDirectWriter(state), { code: "RUN_DIRECT_WRITER_INVALID" });
  }
});

test("applied and verified states require an auditable patch reference", () => {
  for (const state of [
    { ...base, stage: "APPLICATION_UNKNOWN", application: "UNKNOWN" },
    { ...base, stage: "APPLIED_PENDING_VERIFICATION", application: "APPLIED", verification: "PENDING" },
    { ...base, stage: "VERIFIED", application: "APPLIED", verification: "PASS", receiptDigest: digest },
  ]) {
    assert.throws(() => validateDirectWriter(state), { code: "RUN_DIRECT_WRITER_INVALID" });
    assert.doesNotThrow(() => validateDirectWriter({ ...state, patchDigest: digest, patch }));
  }
});

test("schema and runtime agree on absent patch references", async () => {
  const schema = JSON.parse(await fs.readFile(new URL("../schemas/run-record-v1.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile({ ...schema.properties.directWriter, $defs: schema.$defs });
  for (const state of [base, { ...base, patchDigest: digest }, { ...base, patch },
    { ...base, stage: "VERIFIED", application: "APPLIED", verification: "PASS", receiptDigest: digest },
    { ...base, stage: "VERIFIED", application: "APPLIED", verification: "PASS", receiptDigest: digest, patchDigest: digest, patch }]) {
    let valid = true;
    try { validateDirectWriter(state); } catch { valid = false; }
    assert.equal(validate(state), valid, JSON.stringify(state));
  }
});

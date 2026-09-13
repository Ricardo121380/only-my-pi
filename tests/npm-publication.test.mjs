import assert from "node:assert/strict";
import test from "node:test";
import { awaitPublishedVersion } from "../scripts/lib/npm-publication.mjs";

const expected = { name: "only-my-pi", version: "0.4.0-preview.1", integrity: "sha512-candidate" };
const visible = { name: expected.name, version: expected.version, dist: { integrity: expected.integrity,
  attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } } } };

test("registry visibility and provenance may lag without another upload", async () => {
  const responses = [null, { ...visible, dist: { integrity: expected.integrity } }, visible];
  const waits = [];
  assert.equal(await awaitPublishedVersion({ ...expected, inspect: async () => responses.shift(),
    delays: [0, 1, 2], wait: async (ms) => waits.push(ms) }), visible);
  assert.deepEqual(waits, [1, 2]);
  assert.equal(responses.length, 0);
});

test("an immutable byte mismatch stops immediately without retry", async () => {
  let reads = 0;
  await assert.rejects(awaitPublishedVersion({ ...expected, inspect: async () => {
    reads++; return { ...visible, dist: { integrity: "sha512-other" } };
  }, wait: async () => assert.fail("must not wait after a mismatch") }), /different bytes/);
  assert.equal(reads, 1);
});

test("missing publication and missing provenance terminate at the read bound", async () => {
  for (const value of [null, { ...visible, dist: { integrity: expected.integrity } }]) {
    let reads = 0;
    await assert.rejects(awaitPublishedVersion({ ...expected, inspect: async () => { reads++; return value; },
      delays: [0, 1, 2], wait: async () => {} }), /inspect the submission receipt/);
    assert.equal(reads, 3);
  }
});

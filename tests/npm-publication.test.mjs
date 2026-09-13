import assert from "node:assert/strict";
import test from "node:test";
import { awaitPublishedTag, awaitPublishedVersion } from "../scripts/lib/npm-publication.mjs";

test("tag confirmation retries stale metadata without repeating mutations", async () => {
  const responses = [{ "dist-tags": { latest: "0.0.0-bootstrap.0" } }, { "dist-tags": { latest: "0.4.0-preview.1" } }];
  const waits = [];
  await awaitPublishedTag({ name: "only-my-pi", tag: "latest", version: "0.4.0-preview.1",
    inspect: async () => responses.shift(), delays: [0, 1], wait: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [1]);
  assert.equal(responses.length, 0);
});

test("tag confirmation stops at its read bound and preserves actionable failure", async () => {
  let reads = 0;
  await assert.rejects(awaitPublishedTag({ name: "only-my-pi", tag: "latest", version: "0.4.0-preview.1",
    inspect: async () => { reads++; return {}; }, delays: [0, 1], wait: async () => {} }), /preserve the receipt/);
  assert.equal(reads, 2);
});

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

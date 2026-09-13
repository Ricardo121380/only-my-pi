import assert from "node:assert/strict";
import test from "node:test";
import { selectReleaseByTag } from "../scripts/lib/github-release.mjs";

test("release recovery finds drafts and published releases by exact tag", () => {
  for (const draft of [true, false]) {
    const release = { id: 1, tag_name: "v0.4.0-preview.1", draft };
    assert.equal(selectReleaseByTag([{ tag_name: "v0.3.0-preview.1" }, release], release.tag_name), release);
  }
  assert.equal(selectReleaseByTag([], "v0.4.0-preview.1"), null);
});

test("ambiguous drafts stop recovery instead of creating or overwriting releases", () => {
  assert.throws(() => selectReleaseByTag([{ tag_name: "v1", draft: true }, { tag_name: "v1", draft: true }], "v1"), /Multiple releases/);
});

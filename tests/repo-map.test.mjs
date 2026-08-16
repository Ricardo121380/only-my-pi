import assert from "node:assert/strict";
import test from "node:test";

import { createRepoMap, rankSymbols } from "../packages/repo-map/index.mjs";

test("repo-map ranks symbols deterministically and stays bounded", async () => {
  const symbols = rankSymbols([
    { path: "z.ts", name: "z", score: 1, references: 2 },
    { path: "a.ts", name: "a", score: 2, references: 1 },
    { path: "a.ts", name: "b", score: 2, references: 1 },
  ]);
  assert.deepEqual(symbols.map((symbol) => symbol.name), ["a", "b", "z"]);
  const map = await createRepoMap({ maxBytes: 40, indexer: async () => symbols }).build({ files: ["a.ts", "z.ts"] });
  assert.equal(map.truncated, true);
  assert.ok(map.bytes <= 40);
  assert.match(map.digest, /^sha256:/);
});

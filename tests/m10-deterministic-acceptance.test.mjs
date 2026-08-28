import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { M10_DETERMINISTIC_CHECKS, runM10AcceptanceCheck } from "../scripts/m10-deterministic-acceptance.mjs";

test("M10 deterministic acceptance uses shell false and preserves ambient HOME without repurposing it", async () => {
  const child = new EventEmitter();
  const check = M10_DETERMINISTIC_CHECKS[0];
  const resultPromise = runM10AcceptanceCheck(check, {
    env: { PATH: "/usr/bin:/bin", HOME: "/sensitive/home", TMPDIR: "/tmp" },
    spawnImpl(command, args, options) {
      assert.equal(command, check.command);
      assert.deepEqual(args, check.args);
      assert.equal(options.shell, false);
      assert.equal(options.env.HOME, "/sensitive/home");
      assert.equal(options.env.CI, "1");
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  });
  assert.deepEqual(await resultPromise, { id: check.id, status: "PASS" });
});

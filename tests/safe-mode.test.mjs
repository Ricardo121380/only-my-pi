import assert from "node:assert/strict";
import test from "node:test";
import { buildSafeArgs, SAFE_FLAGS, validateForwardedArgs } from "../scripts/safe-mode.mjs";

test("safe mode fixes discovery, session, trust, and tool flags", () => {
  const args = buildSafeArgs(["--provider", "openai", "--model", "gpt-5", "inspect this repo"]);
  assert.deepEqual(args.slice(0, SAFE_FLAGS.length), SAFE_FLAGS);
  assert.deepEqual(args.slice(SAFE_FLAGS.length), ["--provider", "openai", "--model", "gpt-5", "inspect this repo"]);
});

test("safe mode rejects flags that could widen the capability surface", () => {
  assert.throws(() => validateForwardedArgs(["--tools", "bash"]), /not allowed/);
  assert.throws(() => validateForwardedArgs(["-e", "unsafe.ts"]), /not allowed/);
  assert.throws(() => validateForwardedArgs(["--api-key", "secret"]), /not allowed/);
  assert.throws(() => validateForwardedArgs(["--mode", "rpc"]), /not allowed/);
  assert.throws(() => validateForwardedArgs(["@secret.env"]), /@file expansion is not allowed/);
  assert.throws(() => validateForwardedArgs(["--provider"]), /requires a value/);
});

test("wrapper separator turns flag-shaped text into one safe prompt", () => {
  assert.deepEqual(validateForwardedArgs(["--", "--tools", "is prompt text"]), ["Task:\n--tools is prompt text"]);
});

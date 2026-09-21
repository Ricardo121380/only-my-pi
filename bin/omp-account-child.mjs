#!/usr/bin/env node
import { loadDistribution } from "../packages/distribution/runtime.mjs";
import { runAccountChild } from "../packages/host/account-child.mjs";

try {
  const stack = await loadDistribution();
  if (!stack) throw new Error("CONTROLLED_STACK_REQUIRED");
  process.exitCode = await runAccountChild({ stack, configRoot: process.env.OMP_HOST_ACCOUNT_CONFIG_ROOT, accountId: process.env.OMP_HOST_ACCOUNT_ID, argv: process.argv.slice(2) });
} catch {
  // Never print provider exceptions, CLI diagnostics, or credential paths.
  process.stderr.write("OMP_CHILD_ACCOUNT_EXECUTION_FAILED\n");
  process.exitCode = 1;
}

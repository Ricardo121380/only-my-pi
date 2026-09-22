import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDistribution } from "../../packages/distribution/runtime.mjs";
import { resolveDirectExtensionSet } from "../../packages/direct-agent/launcher.mjs";
import { prepareDirectSourceStack } from "./direct-source-stack.mjs";

// An explicit candidate must validate its complete manifest and embedded Node.
// Never substitute source files or patch the candidate under acceptance.
export async function prepareDirectTestRuntime(root, config, { fullStack, headless }) {
  if (process.env.OMP_TEST_STACK_PACKAGE) {
    const stack = await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE });
    if (!stack) throw new Error("explicit candidate distribution is missing");
    const { extensions } = await resolveDirectExtensionSet({ stack, configRoot: config, headless });
    return { node: stack.nodePath, packageRoot: stack.ompPackageRoot,
      sdk: path.join(stack.root, "pi/dist/index.js"), extensions };
  }
  return { node: process.execPath, packageRoot: fileURLToPath(new URL("../../", import.meta.url)),
    sdk: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    extensions: fullStack ? await prepareDirectSourceStack(root, config) : [] };
}

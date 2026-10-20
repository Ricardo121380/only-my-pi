import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDirectConfigRoot } from "./launcher.mjs";
import { SessionAdmissions } from "./session-admission.mjs";
import { createDirectRpcRuntime } from "./tui-runtime.mjs";
import { createRpcRuntimeView } from "./rpc-runtime-view.mjs";
import { exitFailedDirectRuntime } from "./fatal-exit.mjs";

// Private candidate entry. The public RPC runner disposes the admitted runtime
// on EOF/signals. Unconfirmed teardown retains ownership, never native fallback.
try {
  const [sdkFile, ...args] = process.argv.slice(2);
  if (!path.isAbsolute(sdkFile ?? "")) throw new Error();
  const sdk = await import(pathToFileURL(sdkFile).href);
  if (sdk.parseArgs(args).offline) process.env.PI_OFFLINE = "1";
  const configRoot = resolveDirectConfigRoot();
  const admissions = new SessionAdmissions(configRoot, { loadSdk: async () => sdk });
  let runtime;
  ({ runtime } = await createDirectRpcRuntime({ sdk, args, configRoot, admissions,
    onFatal: () => exitFailedDirectRuntime({ getRuntime: () => runtime,
      report: () => process.stderr.write("SESSION_LIFECYCLE_UNCONFIRMED: stopped; session ownership requires reconciliation.\n") }) }));
  await sdk.runRpcMode(createRpcRuntimeView(runtime));
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.code ?? "") ? error.code : "DIRECT_RPC_START_FAILED";
  process.stdout.write(JSON.stringify({ type: "extension_error", code }) + "\n");
  process.exitCode = 1;
}

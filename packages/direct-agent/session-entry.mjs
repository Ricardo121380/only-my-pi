import path from "node:path";
import { pathToFileURL } from "node:url";
import { SessionAdmissions } from "./session-admission.mjs";
import { resolveDirectConfigRoot } from "./launcher.mjs";
import { selectResumeSession } from "./session-picker.mjs";
import { createDirectPrintRuntime } from "./tui-runtime.mjs";

// Arguments are constructed by the controlled launcher, including all audited
// extension paths/tools. This entry never reconstructs or drops those options.
let admissions, runtime;
try {
  const [sdkFile, ...args] = process.argv.slice(2);
  if (!path.isAbsolute(sdkFile ?? "")) throw new Error();
  const sdk = await import(pathToFileURL(sdkFile).href);
  if (sdk.parseArgs(args).offline) process.env.PI_OFFLINE = "1";
  const configRoot = resolveDirectConfigRoot();
  admissions = new SessionAdmissions(configRoot, { loadSdk: async () => sdk });
  const prepared = await createDirectPrintRuntime({ args, sdk, admissions, configRoot,
    selectResume: (loaders) => selectResumeSession({ sdk, sdkFile, ...loaders }) });
  if (!prepared.cancelled) {
    runtime = prepared.runtime;
    process.exitCode = await sdk.runPrintMode(runtime, prepared.options);
  }
} catch (error) {
  process.stderr.write(`${/^[A-Z_]+$/.test(error.code ?? "") ? error.code : "DIRECT_SESSION_START_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  // A hard exit skips this: retain the durable lease for reconciliation, never
  // release it from an exit callback while tool descendants may still exist.
  await runtime?.dispose();
  await admissions?.close();
}

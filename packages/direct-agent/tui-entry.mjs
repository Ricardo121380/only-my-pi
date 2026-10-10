import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDirectConfigRoot } from "./launcher.mjs";
import { SessionAdmissions } from "./session-admission.mjs";
import { selectResumeSession, confirmStartupProjectTrust, confirmStartupSessionCwd } from "./session-picker.mjs";
import { createDirectTuiRuntime } from "./tui-runtime.mjs";
import { exitFailedDirectRuntime } from "./fatal-exit.mjs";

// Private candidate entry. No fallback to native main on admission failure.
let ui, runtime;
try {
  const [sdkFile, ...args] = process.argv.slice(2);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Object.assign(new Error(), { code: "TUI_TTY_REQUIRED" });
  if (!path.isAbsolute(sdkFile ?? "")) throw new Error();
  const sdk = await import(pathToFileURL(sdkFile).href);
  // ModelRuntime captures this process-wide policy when it is constructed.
  // Match Pi main before any services/catalogs are initialized. This entry is
  // a dedicated child process; no parent or persistent setting is changed.
  if (sdk.parseArgs(args).offline) process.env.PI_OFFLINE = "1";
  const configRoot = resolveDirectConfigRoot();
  const admissions = new SessionAdmissions(configRoot, { loadSdk: async () => sdk });
  const started = await createDirectTuiRuntime({ sdk, args, configRoot, admissions,
    onFatal: () => exitFailedDirectRuntime({ getRuntime: () => runtime, stop: () => ui?.stop(),
      report: () => process.stderr.write("SESSION_LIFECYCLE_UNCONFIRMED: stopped; session ownership requires reconciliation.\n") }),
    confirmSessionCwd: (target) => confirmStartupSessionCwd({ sdk, sdkFile, ...target }),
    confirmProjectTrust: (cwd) => confirmStartupProjectTrust({ sdk, sdkFile, cwd }),
    selectResume: (loaders) => selectResumeSession({ sdk, sdkFile, ...loaders }) });
  if (started.cancelled) await admissions.close();
  else {
    runtime = started.runtime;
    ui = new sdk.InteractiveMode(runtime, started.options);
    await ui.run();
  }
} catch (error) {
  // An admitted runtime can perform its checked teardown. Partial initialization
  // and unconfirmed teardown retain durable locks for reconciliation.
  const report = () => process.stderr.write(`${/^[A-Z_]+$/.test(error.code ?? "") ? error.code : "DIRECT_TUI_START_FAILED"}\n`);
  if (runtime) await exitFailedDirectRuntime({ getRuntime: () => runtime, stop: () => ui?.stop(), report });
  report();
  process.exitCode = 1;
}

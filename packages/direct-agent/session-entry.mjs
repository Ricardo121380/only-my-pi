import path from "node:path";
import { pathToFileURL } from "node:url";
import { SessionAdmissions } from "./session-admission.mjs";
import { resolveDirectConfigRoot } from "./launcher.mjs";
import { prepareHeadlessSession } from "./session-selection.mjs";
import { selectResumeSession } from "./session-picker.mjs";
import { disableOmpCacheWarming } from "./cache-warming-policy.mjs";

// Arguments are constructed by the controlled launcher, including all audited
// extension paths/tools. This entry never reconstructs or drops those options.
let admissions;
try {
  const [sdkFile, ...args] = process.argv.slice(2);
  if (!path.isAbsolute(sdkFile ?? "")) throw new Error();
  const sdk = await import(pathToFileURL(sdkFile).href);
  const configRoot = resolveDirectConfigRoot();
  admissions = new SessionAdmissions(configRoot, { loadSdk: async () => sdk });
  const prepared = await prepareHeadlessSession({ args, sdk, admissions, configRoot,
    selectResume: (loaders) => selectResumeSession({ sdk, sdkFile, ...loaders }) });
  if (!prepared.cancelled) {
    const target = prepared.target;
    await sdk.main(prepared.args, { extensionFactories: [(pi) => {
      // Session ownership only: this must never bypass project coding ownership.
      pi.events.emit("only-my-pi:direct-session-owner:v1", {
        ownsSession: (ctx) => !admissions.closing
          && ["print", "json"].includes(ctx.mode)
          && ctx.sessionManager.getSessionId() === target.id
          && (target.file ? ctx.sessionManager.getSessionFile() === target.file
            : path.dirname(ctx.sessionManager.getSessionFile() ?? "") === target.sessionDir),
      });
      pi.on("session_before_switch", () => ({ cancel: true }));
      pi.on("session_before_fork", () => ({ cancel: true }));
    }, disableOmpCacheWarming] });
  }
} catch (error) {
  process.stderr.write(`${/^[A-Z_]+$/.test(error.code ?? "") ? error.code : "DIRECT_SESSION_START_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  // A hard exit skips this: retain the durable lease for reconciliation, never
  // release it from an exit callback while tool descendants may still exist.
  await admissions?.close();
}

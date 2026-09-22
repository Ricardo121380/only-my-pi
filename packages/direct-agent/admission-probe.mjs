// Private, explicit-session print probe. Not wired into the production launcher.
// Full CLI selection, interactive lifecycle and hard-exit cleanup remain gates.
import { SessionAdmissions, createResumeAdmissionExtension } from "./session-admission.mjs";
import { resolveDirectConfigRoot } from "./launcher.mjs";

const admissions = new SessionAdmissions(resolveDirectConfigRoot());
try {
  const [sessionFile, model, message] = process.argv.slice(2);
  if (!sessionFile || !model || !message || process.argv.length !== 5)
    throw Object.assign(new Error(), { code: "ADMISSION_PROBE_ARGUMENTS_INVALID" });
  const lease = await admissions.admit(sessionFile);
  // Import and invoke Pi only after acquiring ownership, in the same process.
  const { main } = await import("@earendil-works/pi-coding-agent");
  await main(["--offline", "--no-extensions", "--print", "--session", lease.file,
    "--model", model, message], { extensionFactories: [createResumeAdmissionExtension(admissions), (pi) => {
      pi.on("tool_call", () => ({ block: true, reason: "ADMISSION_PROBE_READ_ONLY" }));
    }] });
} catch (error) {
  process.stderr.write(`${error.code ?? "ADMISSION_PROBE_FAILED"}\n`);
  process.exitCode = 1;
} finally { await admissions.close(); }

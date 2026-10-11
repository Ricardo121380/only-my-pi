import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ownershipError } from "../host/ownership.mjs";
import { readSessionSnapshot } from "./session-history.mjs";

const selectionValues = new Set(["--session", "--session-id", "--session-dir", "--fork"]);

export function resolveLocalPath(value, cwd) {
  const expanded = value === "~" ? os.homedir()
    : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2))
    : value.startsWith("file://") ? fileURLToPath(value) : value;
  return path.resolve(cwd, expanded);
}

// Inspect only selection options. All model/tool/extension arguments remain
// byte-for-byte unchanged and are still parsed by Pi's original main function.
export function inspectSessionSelection(args) {
  const values = new Map(), rest = [];
  let recent = false, resume = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") { rest.push(...args.slice(i)); break; }
    if (selectionValues.has(arg)) {
      if (values.has(arg) || typeof args[i + 1] !== "string" || args[i + 1].length === 0 || args[i + 1].startsWith("-"))
        throw ownershipError("OMP_AGENT_OPTION_INVALID");
      values.set(arg, args[++i]);
    } else if (arg === "--continue" || arg === "-c") {
      if (recent) throw ownershipError("OMP_AGENT_OPTION_INVALID");
      recent = true;
    } else if (arg === "--resume" || arg === "-r") {
      if (resume) throw ownershipError("OMP_AGENT_OPTION_INVALID");
      resume = true;
    } else { rest.push(arg); }
  }
  if ([values.has("--session"), recent, resume, values.has("--fork")].filter(Boolean).length > 1
    || (values.has("--session-id") && (values.has("--session") || recent || resume)))
    throw ownershipError("OMP_AGENT_OPTION_INVALID");
  return { session: values.get("--session"), fork: values.get("--fork"), id: values.get("--session-id"), sessionDir: values.get("--session-dir"), recent, resume, rest };
}

export async function prepareHeadlessSession({ args, sdk, admissions, configRoot, cwd = process.cwd(), env = process.env, selectResume }) {
  const selection = inspectSessionSelection(args);
  const settings = sdk.SettingsManager.create(cwd, configRoot);
  // Match the pinned CLI's flag > environment > settings > default precedence.
  // The controlled distribution brands Pi as "omp"; raw SDK uses "pi".
  // Do not let an unrelated ambient OMP variable redirect an unbranded runtime.
  const environmentDir = env.ONLY_MY_PI_DISTRIBUTION_VERSION ? env.OMP_CODING_AGENT_SESSION_DIR : env.PI_CODING_AGENT_SESSION_DIR;
  const configured = selection.sessionDir ?? (environmentDir || undefined)
    ?? (settings.getSessionDir() || undefined);
  const sessionDir = configured !== undefined ? resolveLocalPath(configured, cwd)
    : path.join(configRoot, "sessions", `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
  const sourceSelection = selection.fork ?? selection.session;
  let file;
  if (selection.resume) {
    if (!selectResume) throw ownershipError("SESSION_PICKER_UNAVAILABLE");
    file = await selectResume({
      currentSessions: (onProgress) => sdk.SessionManager.list(cwd, sessionDir, onProgress),
      allSessions: (onProgress) => sdk.SessionManager.listAll(configured !== undefined ? sessionDir : undefined, onProgress),
    });
    if (file === null) return { cancelled: true };
    if (typeof file !== "string" || !path.isAbsolute(file)) throw ownershipError("SESSION_TARGET_INVALID");
  } else if (sourceSelection && (sourceSelection.includes("/") || sourceSelection.includes("\\") || sourceSelection.endsWith(".jsonl"))) {
    file = resolveLocalPath(sourceSelection, cwd);
  } else if (sourceSelection || selection.id || selection.recent) {
    const local = await sdk.SessionManager.list(cwd, sessionDir);
    if (selection.recent) {
      const candidates = await Promise.all(local.map(async (entry) => ({ file: entry.path, mtime: (await fs.stat(entry.path)).mtimeMs })));
      candidates.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
      file = candidates[0]?.file;
    } else {
      const target = sourceSelection ?? selection.id;
      const exact = local.filter((entry) => entry.id === target);
      const matches = exact.length ? exact : sourceSelection ? local.filter((entry) => entry.id.startsWith(target)) : [];
      if (matches.length > 1) throw ownershipError("SESSION_ID_AMBIGUOUS");
      file = matches[0]?.path;
      if (!file && sourceSelection) {
        // Cross-project ID lookup in native Pi prompts to fork. Never turn that
        // into an implicit same-file resume in a noninteractive OMP request.
        const all = await sdk.SessionManager.listAll(configured !== undefined ? sessionDir : undefined);
        if (selection.fork) {
          const exactGlobal = all.filter((entry) => entry.id === target);
          const matchesGlobal = exactGlobal.length ? exactGlobal : all.filter((entry) => entry.id.startsWith(target));
          if (matchesGlobal.length > 1) throw ownershipError("SESSION_ID_AMBIGUOUS");
          file = matchesGlobal[0]?.path;
        }
        if (!selection.fork && all.some((entry) => entry.id === target || entry.id.startsWith(target)))
          throw ownershipError("SESSION_CROSS_PROJECT_FORK_REQUIRED");
        if (!file) throw ownershipError("SESSION_NOT_FOUND");
      }
    }
  }
  if (file) await readSessionSnapshot(file, sdk);
  let targetArgs, target, sessionManager;
  if (selection.fork) {
    sessionManager = await admissions.create(cwd, sessionDir, { sourceFile: file,
      ...(selection.id ? { id: selection.id } : {}) });
    target = { id: sessionManager.getSessionId(), file: sessionManager.getSessionFile(), sessionDir };
    targetArgs = ["--session", target.file, "--session-dir", sessionDir];
  } else if (file) {
    const lease = await admissions.admit(file);
    target = { id: lease.id, file: lease.file };
    targetArgs = ["--session", lease.file];
    // Native --session without an explicit/configured directory derives it from
    // the history path; retain that behavior for future compatibility.
    if (configured !== undefined || selection.recent || selection.id) {
      target.sessionDir = sessionDir;
      targetArgs.push("--session-dir", sessionDir);
    }
  } else {
    const manager = await admissions.create(cwd, sessionDir, selection.id ? { id: selection.id } : {});
    sessionManager = manager;
    target = { id: manager.getSessionId(), sessionDir };
    targetArgs = ["--session-id", target.id, "--session-dir", sessionDir];
  }
  // Insert selection before a possible -- separator, not after prompt text.
  return { target, sessionManager, args: [...targetArgs, ...selection.rest] };
}

import fs from "node:fs";
import path from "node:path";

import { createDailyConfigService } from "../../daily-config/index.mjs";
import { createSessionRuntimeComposer } from "../runtime/session-composer.mjs";
import {
  executeM8LiveMain,
  executeM8LiveResume,
  m8ProtectedConfiguration,
  m8ProtectedGoalPlannerPolicy,
  m8ProtectedToolCallLimit,
  m8ProtectedTurnLimit,
} from "./m8-live-acceptance-extension.mjs";

export const M9_LIVE_REQUEST_ENV = "OMP_M9_LIVE_ACCEPTANCE_REQUEST";
export const M9_LIVE_RECORD_TYPE = "omp_m9_live_acceptance_record_v1";
export const M9_LIVE_ERROR_TYPE = "omp_m9_live_acceptance_error_v1";

const MAX_REQUEST_BYTES = 64 * 1024;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const EXPECTED_REQUEST_KEYS = Object.freeze([
  "candidateAuditDigest",
  "candidateContractDigest",
  "candidateInstallationRoot",
  "configRoot",
  "formatVersion",
  "model",
  "phase",
  "repositoryRoot",
  "runNonce",
  "sourceCommit",
  "webAuthorized",
]);
const CANDIDATE = Object.freeze({
  piVersion: "0.84.3",
  subagentsVersion: "0.57.0",
  webAccessVersion: "0.25.0",
});

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return plain(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) fail("M9_LIVE_REQUEST_INVALID", `${label} is invalid`);
  const real = fs.realpathSync(value);
  const stat = fs.lstatSync(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("M9_LIVE_REQUEST_INVALID", `${label} must be a real directory`);
  return real;
}

function packageBinding(installationRoot, packageName, expectedVersion) {
  const root = fs.realpathSync(path.join(installationRoot, "node_modules", ...packageName.split("/")));
  if (!contained(installationRoot, root)) fail("M9_LIVE_PACKAGE_ESCAPE", `${packageName} escaped the candidate installation`);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("M9_LIVE_PACKAGE_INVALID", `${packageName} root is unsafe`);
  const manifestPath = path.join(root, "package.json");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail("M9_LIVE_PACKAGE_INVALID", `${packageName} manifest is unsafe`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== packageName || manifest.version !== expectedVersion) fail("M9_LIVE_PACKAGE_DRIFT", `${packageName} identity drifted`);
  return Object.freeze({ root, manifest: Object.freeze(manifest) });
}

function readRequest() {
  const requestPath = process.env[M9_LIVE_REQUEST_ENV];
  if (typeof requestPath !== "string" || !path.isAbsolute(requestPath)) fail("M9_LIVE_REQUEST_UNAVAILABLE", "M9 live request path is unavailable");
  const stat = fs.lstatSync(requestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) fail("M9_LIVE_REQUEST_INVALID", "M9 live request must be a bounded regular file");
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  if (!exactKeys(request, EXPECTED_REQUEST_KEYS)
    || request.formatVersion !== 1
    || !["main", "resume"].includes(request.phase)
    || !SOURCE_COMMIT.test(request.sourceCommit ?? "")
    || !SAFE_ID.test(request.runNonce ?? "")
    || request.webAuthorized !== true
    || !SHA256.test(request.candidateAuditDigest ?? "")
    || !SHA256.test(request.candidateContractDigest ?? "")
    || !plain(request.model)
    || JSON.stringify(Object.keys(request.model).sort()) !== JSON.stringify(["id", "provider"])) {
    fail("M9_LIVE_REQUEST_INVALID", "M9 live request shape is invalid");
  }
  request.repositoryRoot = realDirectory(request.repositoryRoot, "repositoryRoot");
  request.configRoot = realDirectory(request.configRoot, "configRoot");
  request.candidateInstallationRoot = realDirectory(request.candidateInstallationRoot, "candidateInstallationRoot");
  if (process.env.PI_CODING_AGENT_DIR !== request.configRoot) fail("M9_LIVE_CONFIG_DRIFT", "Pi config root differs from the acceptance request");
  return Object.freeze(request);
}

function publicCode(cause) {
  return /^[A-Z][A-Z0-9_]{1,127}$/u.test(cause?.code ?? "") ? cause.code : "M9_LIVE_ACCEPTANCE_FAILED";
}

export default function m9LiveAcceptanceExtension(pi) {
  let started = false;
  pi.on("session_start", async (_event, ctx) => {
    if (started) return;
    started = true;
    let composer;
    try {
      const request = readRequest();
      if (ctx?.model?.provider !== request.model.provider || ctx?.model?.id !== request.model.id) {
        fail("M9_LIVE_MODEL_DRIFT", "active Pi model differs from the acceptance request");
      }
      const subagentsPackage = packageBinding(request.candidateInstallationRoot, "pi-subagents", CANDIDATE.subagentsVersion);
      const webPackage = packageBinding(request.candidateInstallationRoot, "pi-web-access", CANDIDATE.webAccessVersion);
      const dailyConfig = createDailyConfigService({ rootDir: request.repositoryRoot, configRoot: request.configRoot });
      const protectedDailyConfig = {
        async resolve(options) {
          return m8ProtectedConfiguration(await dailyConfig.resolve(options));
        },
      };
      composer = await createSessionRuntimeComposer({
        pi,
        rootDir: request.repositoryRoot,
        configRoot: request.configRoot,
        getContext: () => ctx,
        dependencies: {
          dailyConfig: protectedDailyConfig,
          subagentsPackage,
          webPackage,
          goalMakerTemplateSelector: () => "reviewer",
          goalPlannerResultPolicy: m8ProtectedGoalPlannerPolicy,
          goalWebEnabled: false,
          allowVerifiedReuseCompletion: true,
          goalExecutionBudgetDivisor: 1,
          toolCallLimitResolver: m8ProtectedToolCallLimit,
          turnLimitResolver: m8ProtectedTurnLimit,
        },
      });
      const result = request.phase === "main"
        ? await executeM8LiveMain(composer, request)
        : await executeM8LiveResume(composer, request);
      process.stdout.write(`${JSON.stringify({
        formatVersion: 1,
        type: M9_LIVE_RECORD_TYPE,
        phase: request.phase,
        status: "PASS",
        sourceCommit: request.sourceCommit,
        model: request.model,
        candidate: CANDIDATE,
        candidateAuditDigest: request.candidateAuditDigest,
        candidateContractDigest: request.candidateContractDigest,
        assertions: result.assertions,
        usage: result.usage,
      })}\n`);
    } catch (cause) {
      process.stdout.write(`${JSON.stringify({
        formatVersion: 1,
        type: M9_LIVE_ERROR_TYPE,
        status: "FAIL",
        code: publicCode(cause),
      })}\n`);
    } finally {
      await composer?.dispose?.().catch(() => {});
    }
  });
}

export { CANDIDATE as M9_LIVE_CANDIDATE };

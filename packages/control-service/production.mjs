import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { BootstrapService } from "../bootstrap/bootstrap-service.mjs";
import { ArtifactInstaller, createArtifactProcessRunner } from "../bootstrap/artifact-installer.mjs";
import { createUserCliInstaller } from "../bootstrap/user-cli-installer.mjs";
import { createNpmCommandRunner } from "../bootstrap/command-runner.mjs";
import { DoctorService } from "../bootstrap/doctor-service.mjs";
import { createNoModelSmokeRunner } from "../bootstrap/smoke-runner.mjs";
import { TransactionEngine } from "../bootstrap/transaction-engine.mjs";
import { createWorkflowControlService } from "./workflow-service.mjs";
import { createSwarmControlService } from "./swarm-service.mjs";
import { createThemeControlService } from "./theme-service.mjs";
import { createStatusService } from "./status-service.mjs";
import { createVersionService } from "./version-service.mjs";
import { createUltraRunControlService } from "./ultra-run-service.mjs";
import { ControlService } from "./service.mjs";
import { DailyConfigService } from "../daily-config/index.mjs";
import { ProjectGateService, createNodeExecAdapter } from "../project-gates/index.mjs";
import { RunManagementService, createRunRecordStore } from "../run-management/index.mjs";
import { loadSettings } from "../config-runtime/index.mjs";
import { createDirectAgentDoctor } from "../direct-agent/doctor.mjs";
import { loadDistribution } from "../distribution/runtime.mjs";
import { isPrivateStack } from "../release-stack/contracts.mjs";
import {
  createGitHubReleasePayloadSource,
  createLocalReleasePayloadSource,
  createShellProfileService,
  createStackHarnessAdapter,
  createStackLayout,
  createStackService,
  createStackTransactionEngine,
  createThinPayloadResolver,
} from "../release-stack/index.mjs";
import {
  createCandidateTargetResolver,
  createCrossRootTransactionEngine,
  createExternalMigrationPlanner,
  createFilesystemMigrationPlatform,
  createPiProcessAdmission,
  createUpstreamMigrationService,
} from "../upstream-migration/index.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

const DEFAULT_DEPENDENCIES = Object.freeze({
  ArtifactInstaller,
  BootstrapService,
  ControlService,
  DoctorService,
  DailyConfigService,
  ProjectGateService,
  RunManagementService,
  TransactionEngine,
  createNpmCommandRunner,
  createNoModelSmokeRunner,
  createArtifactProcessRunner,
  createUserCliInstaller,
  createExternalMigrationPlanner,
  createFilesystemMigrationPlatform,
  createCrossRootTransactionEngine,
  createCandidateTargetResolver,
  createPiProcessAdmission,
  createUpstreamMigrationService,
  createVersionService,
  createDirectAgentDoctor,
  createWorkflowControlService,
  createRunRecordStore,
  createNodeExecAdapter,
  createStatusService,
  createThemeControlService,
  createUltraRunControlService,
  createSwarmControlService,
  createGitHubReleasePayloadSource,
  createLocalReleasePayloadSource,
  createShellProfileService,
  createStackHarnessAdapter,
  createStackLayout,
  createStackService,
  createStackTransactionEngine,
  createThinPayloadResolver,
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertFunction(value, label) {
  if (typeof value !== "function") fail("INVALID_CLI_DEPENDENCY", `${label} must be a function`);
  return value;
}

function assertAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    fail("INVALID_CLI_PATH", `${label} must be an explicit absolute path`);
  }
  return path.resolve(value);
}

function dependenciesWithDefaults(overrides = {}) {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    fail("INVALID_CLI_DEPENDENCY", "dependencies must be an object");
  }
  const allowed = new Set(Object.keys(DEFAULT_DEPENDENCIES));
  for (const key of Object.keys(overrides)) {
    if (!allowed.has(key)) fail("INVALID_CLI_DEPENDENCY", `unknown CLI dependency: ${key}`);
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  for (const key of allowed) assertFunction(dependencies[key], key);
  return dependencies;
}

function inspectPublicPlatform() {
  const darwinMajor = process.platform === "darwin" ? Number.parseInt(os.release().split(".")[0], 10) : 0;
  return Object.freeze({
    os: process.platform,
    arch: process.arch,
    minimumMacOSSatisfied: process.platform === "darwin" && Number.isInteger(darwinMajor) && darwinMajor >= 23,
    rosetta: process.platform === "darwin" && process.arch !== "arm64",
  });
}

/**
 * Construct the complete production control plane for one already-parsed
 * config root. Constructors are injectable so tests never need to spawn npm,
 * Pi, access a Provider, or use the real Pi home.
 */
export function createProductionControlService({
  rootDir = DEFAULT_ROOT,
  configRoot,
  spawnImpl,
  confirm,
  dependencies,
} = {}) {
  const resolvedRoot = assertAbsolutePath(rootDir, "rootDir");
  const resolvedConfigRoot = assertAbsolutePath(configRoot, "configRoot");
  const wired = dependenciesWithDefaults(dependencies);
  const artifactProcessOptions = spawnImpl === undefined ? {} : { spawnImpl };
  const userCli = wired.createUserCliInstaller({
    cliRoot: path.join(os.homedir(), ".local", "share", "only-my-pi"),
    binPath: path.join(os.homedir(), ".local", "bin", "omp"),
  });
  const artifactInstaller = new wired.ArtifactInstaller({
    runCommand: wired.createArtifactProcessRunner(artifactProcessOptions),
    userCli,
  });
  const doctor = new wired.DoctorService({ rootDir: resolvedRoot });
  const runner = wired.createNpmCommandRunner({ configRoot: resolvedConfigRoot });
  const smokeOptions = spawnImpl === undefined ? {} : { spawnImpl };
  const smokeRunner = wired.createNoModelSmokeRunner(smokeOptions);
  const transactionEngine = new wired.TransactionEngine({
    rootDir: resolvedRoot,
    runner,
    smokeRunner,
    doctorService: doctor,
  });
  const candidateTarget = wired.createCandidateTargetResolver({ rootDir: resolvedRoot });
  const bootstrap = new wired.BootstrapService({
    rootDir: resolvedRoot,
    doctorService: doctor,
    transactionEngine,
    alternativeTargetResolver: (options) => candidateTarget.alignInstalled(options),
  });
  const workflows = wired.createWorkflowControlService({ rootDir: resolvedRoot });
  const swarms = wired.createSwarmControlService({ rootDir: resolvedRoot });
  const ultras = wired.createUltraRunControlService({ rootDir: resolvedRoot });
  const themes = wired.createThemeControlService({ rootDir: resolvedRoot });
  const statusService = wired.createStatusService();
  const stackLayout = wired.createStackLayout({ homeDir: os.homedir(), configRoot: resolvedConfigRoot });
  const versionService = wired.createVersionService({ rootDir: resolvedRoot, configRoot: resolvedConfigRoot, userCli, stackLayout });
  const directDoctor = wired.createDirectAgentDoctor({
    rootDir: resolvedRoot,
    configRoot: resolvedConfigRoot,
    stackRoot: stackLayout.currentStack,
  });
  const migrationPlanner = wired.createExternalMigrationPlanner({
    configRoot: resolvedConfigRoot,
    piPackageRoot: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
    piBinPath: "/opt/homebrew/bin/pi",
    bootstrap,
  });
  const processAdmission = wired.createPiProcessAdmission({
    piPackageRoot: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
    piBinPath: "/opt/homebrew/bin/pi",
  });
  const migrationPlatform = wired.createFilesystemMigrationPlatform({
    rootDir: resolvedRoot,
    configRoot: resolvedConfigRoot,
    piPackageRoot: "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
    piBinPath: "/opt/homebrew/bin/pi",
    planner: migrationPlanner,
    candidateTarget,
    userCli,
    doctor,
    smokeRunner,
    bootstrapTransaction: transactionEngine,
    runCommand: wired.createArtifactProcessRunner({ ...artifactProcessOptions, maxOutputBytes: 8 * 1024 * 1024 }),
  });
  const upstreamEngine = wired.createCrossRootTransactionEngine({
    configRoot: resolvedConfigRoot,
    platform: migrationPlatform,
    processAdmission,
  });
  const upstreamMigration = wired.createUpstreamMigrationService({
    rootDir: resolvedRoot,
    configRoot: resolvedConfigRoot,
    planner: migrationPlanner,
    candidateTarget,
    processAdmission,
    engine: upstreamEngine,
  });
  const stackHarness = wired.createStackHarnessAdapter({ rootDir: resolvedRoot, configRoot: resolvedConfigRoot, spawnImpl });
  const stackProcessAdmission = wired.createPiProcessAdmission({
    piPackageRoot: path.join(stackLayout.currentStack, "pi"),
    piBinPath: stackLayout.piShim,
  });
  const stackSmoke = wired.createNoModelSmokeRunner({ ...smokeOptions, piCommand: stackLayout.piShim });
  const shellProfile = wired.createShellProfileService({ homeDir: os.homedir() });
  const stackEngine = wired.createStackTransactionEngine({
    layout: stackLayout,
    processAdmission: stackProcessAdmission,
    harness: stackHarness,
    shellProfile,
    doctor: async ({ context }) => {
      if (isPrivateStack(context.stack)) {
        const runtime = await loadDistribution({ packageRoot: path.join(context.activeStackPath, "only-my-pi/package"), nodePath: path.join(context.activeStackPath, "node/bin/node") });
        return { ok: runtime?.stackId === context.stack.stackId, status: "PRIVATE_STACK_VERIFIED" };
      }
      const result = await bootstrap.doctor({ configRoot: resolvedConfigRoot });
      return { ok: result?.ok === true, status: result?.status ?? "FAIL" };
    },
    smoke: async ({ context }) => {
      if (isPrivateStack(context.stack)) {
        const { stdout } = await promisify(execFile)(path.join(context.activeStackPath, "node/bin/node"), [path.join(context.activeStackPath, "pi/dist/bundle/cli.js"), "--version"],
          { env: { PATH: "/usr/bin:/bin", HOME: context.paths.root }, timeout: 20_000, maxBuffer: 64 * 1024 });
        return { ok: stdout.trim() === context.stack.runtime.pi.version, status: "PRIVATE_PI_SMOKE" };
      }
      const settings = await loadSettings(resolvedConfigRoot);
      const result = await stackSmoke({ configRoot: resolvedConfigRoot, settings: settings.settings });
      return { ok: result?.status === "PASS" || result?.ok === true, status: result?.status ?? "FAIL" };
    },
  });
  const thinResolver = wired.createThinPayloadResolver(spawnImpl === undefined ? {} : { spawnImpl });
  const stackService = wired.createStackService({
    layout: stackLayout,
    localSource: wired.createLocalReleasePayloadSource({ cacheRoot: stackLayout.releaseCache, thinResolver }),
    releaseSource: wired.createGitHubReleasePayloadSource({ cacheRoot: stackLayout.releaseCache, thinResolver }),
    engine: stackEngine,
    shellProfile,
    platformInspector: async () => inspectPublicPlatform(),
  });
  const dailyConfig = new wired.DailyConfigService({ rootDir: resolvedRoot, configRoot: resolvedConfigRoot });
  const projectGates = new wired.ProjectGateService({
    configRoot: resolvedConfigRoot,
    getContext: () => ({ cwd: process.cwd(), isProjectTrusted: () => true, sessionManager: { getSessionId: () => "explicit-cli-validation" } }),
    exec: wired.createNodeExecAdapter({ ...(spawnImpl === undefined ? {} : { spawnImpl }) }),
  });
  const runRecordStore = wired.createRunRecordStore({ managedRoot: path.join(resolvedConfigRoot, "only-my-pi") });
  const runManagement = new wired.RunManagementService({ recordStore: runRecordStore });
  return new wired.ControlService({
    artifactInstaller,
    userCli,
    bootstrap,
    doctor,
    confirm,
    rootDir: resolvedRoot,
    configRoot: resolvedConfigRoot,
    workflows,
    swarms,
    ultras,
    themes,
    dailyConfig,
    projectGates,
    runManagement,
    statusService,
    versionService,
    directDoctor,
    upstreamMigration,
    stackService,
  });
}

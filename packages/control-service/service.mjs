import { loadGovernance } from "../../scripts/package-doctor.mjs";
import { inspectReleaseGates } from "../../scripts/release-gates.mjs";

export const OMP_USAGE = `only-my-pi control CLI

Usage:
  omp bootstrap [--profile <id>] [--mode <id>] [--provider <id>] [--model <id>] [--scope global|project] [--config-root <absolute>] [--dry-run|--apply] [--yes] [--json]
  omp install --artifact <absolute-tarball> [--profile <id>] [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp doctor [--static|--live] [--config-root <absolute>] [--json]
  omp status [--config-root <absolute>] [--json]
  omp version [--config-root <absolute>] [--json]
  omp upstream plan --bundle <absolute> [--config-root <absolute>] [--json]
  omp upstream apply --bundle <absolute> --apply --yes [--terminate-pi] [--config-root <absolute>] [--json]
  omp upstream status [transaction-id] [--config-root <absolute>] [--json]
  omp upstream rollback <transaction-id> --yes [--terminate-pi] [--config-root <absolute>] [--json]
  omp update [--artifact <absolute-tarball> [--profile <id>]] [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp rollback [snapshot-id] [--yes] [--config-root <absolute>] [--json]
  omp uninstall [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp safe [--config-root <absolute>] [--json]
  omp profile [list|show <id>|diff <from> <to>] [--config-root <absolute>] [--json]
  omp profiles [list|show <id>|plan <preset>|apply <preset>] [--yes] [--config-root <absolute>] [--json]
  omp models validate [--project <absolute>] [--config-root <absolute>] [--json]
  omp gate validate [--project <absolute>] [--config-root <absolute>] [--json]
  omp runs [list|show <run-id>|gc --plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp tools|packages|context|verify [--config-root <absolute>] [--json]
  omp mode [list|show|use|reset|doctor|diff|scaffold] [mode-id] [--profile <id>] [--resolved] [--config-root <absolute>] [--json]
  omp workflow [list|show|run|status|cancel|resume] [workflow-or-run-id] [--input-file <absolute>] [--apply --yes] [--config-root <absolute>] [--json]
  omp swarm [list|show|validate|plan|run|status|cancel|resume] [recipe-or-run-id] [--input-file <absolute>] [--yes] [--config-root <absolute>] [--json]
  omp swarm batch [list|show|validate|plan|run|status|cancel|resume] [batch-or-run-id] [--input-file <absolute>] [--yes] [--config-root <absolute>] [--json]
  omp swarm goal [list|show|validate|plan|run|status] [goal-or-run-id] [--input-file <absolute>] [--yes] [--config-root <absolute>] [--json]
  omp ultra [list|show|validate|plan|run] [strategy-id] [--input-file <absolute>] [--yes] [--config-root <absolute>] [--json]
  omp theme [list|show|preview|use|reset|doctor] [theme-id] [--apply --yes] [--config-root <absolute>] [--json]

Mutation is never implicit. bootstrap, install, update, and uninstall default to a zero-write plan.
Provider/model flags save metadata only and remain CONFIGURED_UNVERIFIED.`;

function confirmationRequired(command, plan) {
  return {
    ok: false,
    status: "CONFIRMATION_REQUIRED",
    command,
    mutation: true,
    plan,
  };
}

async function approve(request, plan, confirm) {
  if (request.options.yes) return true;
  if (typeof confirm !== "function") return false;
  return (await confirm({ command: request.command, plan })) === true;
}

export class ControlService {
  constructor({ bootstrap, doctor, confirm, artifactInstaller, userCli, upstreamMigration, modes, workflows, swarms, ultras, themes, dailyConfig, projectGates, runManagement, statusService, versionService, rootDir, configRoot } = {}) {
    if (!bootstrap || !doctor) throw new TypeError("bootstrap and doctor services are required");
    this.bootstrap = bootstrap;
    this.doctor = doctor;
    this.confirm = confirm;
    this.artifactInstaller = artifactInstaller;
    this.userCli = userCli;
    this.upstreamMigration = upstreamMigration;
    this.modes = modes;
    this.workflows = workflows;
    this.swarms = swarms;
    this.ultras = ultras;
    this.themes = themes;
    this.dailyConfig = dailyConfig;
    this.projectGates = projectGates;
    this.runManagement = runManagement;
    this.statusService = statusService;
    this.versionService = versionService;
    this.rootDir = rootDir;
    this.configRoot = configRoot;
  }

  async dispatch(request) {
    if (request.mutation === true && request.command !== "upstream" && this.upstreamMigration?.recoverPending) {
      await this.upstreamMigration.recoverPending();
    }
    switch (request.command) {
      case "help":
        return { ok: true, status: "HELP", mutation: false, text: OMP_USAGE };
      case "bootstrap": {
        const plan = await this.bootstrap.planBootstrap(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyBootstrap({ ...request.options, plan });
      }
      case "install": {
        if (!this.artifactInstaller) return { ok: false, status: "ARTIFACT_INSTALLER_UNAVAILABLE", code: "ARTIFACT_INSTALLER_UNAVAILABLE", mutation: false };
        const plan = await this.artifactInstaller.plan({ ...request.options, operation: "install" });
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.artifactInstaller.apply({ ...request.options, operation: "install", plan });
      }
      case "update": {
        if (request.options.artifact) {
          if (!this.artifactInstaller) return { ok: false, status: "ARTIFACT_INSTALLER_UNAVAILABLE", code: "ARTIFACT_INSTALLER_UNAVAILABLE", mutation: false };
          const plan = await this.artifactInstaller.plan({ ...request.options, operation: "update" });
          if (!request.options.apply) return plan;
          if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
          return this.artifactInstaller.apply({ ...request.options, operation: "update", plan });
        }
        const plan = await this.bootstrap.planUpdate(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyUpdate({ ...request.options, plan });
      }
      case "uninstall": {
        const plan = await this.bootstrap.planUninstall(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        const result = await this.bootstrap.applyUninstall({ ...request.options, plan });
        if (result?.ok === true && this.userCli?.deactivate) return { ...result, cli: await this.userCli.deactivate() };
        return result;
      }
      case "rollback": {
        const plan = await this.bootstrap.planRollback(request.options);
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        const result = await this.bootstrap.rollback({ ...request.options, plan });
        const match = /^before-([0-9a-f-]{36})$/u.exec(plan.snapshotId ?? "");
        if (result?.ok === true && match && this.userCli?.restoreTransaction) {
          return { ...result, cli: await this.userCli.restoreTransaction(match[1]) };
        }
        return result;
      }
      case "doctor":
        return request.options.live ? this.doctor.live(request.options) : this.bootstrap.doctor(request.options);
      case "status": {
        const base = await this.bootstrap.status(request.options);
        if (!this.statusService || typeof this.statusService.snapshot !== "function") return base;
        const harnessStatus = await this.statusService.snapshot({
          headless: true,
          profile: base?.profile ?? base?.profileId ?? null,
          mode: base?.mode ?? null,
          model: base?.model ?? base?.providerSelection ?? null,
          context: base?.context ?? null,
          git: base?.git ?? null,
          permission: base?.permission ?? null,
          swarm: base?.swarm ?? null,
          theme: base?.theme ?? null,
        });
        return { ...base, harnessStatus };
      }
      case "version":
        return this.versionService?.inspect?.() ?? { ok: false, status: "VERSION_SERVICE_UNAVAILABLE", mutation: false };
      case "upstream": {
        if (!this.upstreamMigration) return { ok: false, status: "UPSTREAM_MIGRATION_UNAVAILABLE", mutation: false };
        if (request.options.subcommand === "plan") return this.upstreamMigration.plan(request.options);
        if (request.options.subcommand === "apply") {
          const plan = await this.upstreamMigration.plan(request.options);
          return this.upstreamMigration.apply({ ...request.options, plan });
        }
        if (request.options.subcommand === "status") return this.upstreamMigration.status(request.options.transactionId);
        return this.upstreamMigration.rollback(request.options);
      }
      case "safe":
        return this.bootstrap.safe(request.options);
      case "profile": {
        const profiles = this.bootstrap.profiles ?? this.bootstrap.profileService;
        if (!profiles) {
          return {
            ok: false,
            status: "PROFILE_SERVICE_UNAVAILABLE",
            mutation: false,
            code: "PROFILE_SERVICE_UNAVAILABLE",
            next: "run omp doctor and reinstall the promoted generation",
          };
        }
        if (request.options.subcommand === "list") {
          return { ok: true, status: "PROFILE_LIST", mutation: false, profiles: profiles.list() };
        }
        if (request.options.subcommand === "show") {
          return { ok: true, status: "PROFILE_SHOW", mutation: false, profile: profiles.resolve(request.options.profileId) };
        }
        return {
          ok: true,
          status: "PROFILE_DIFF",
          mutation: false,
          diff: profiles.diff(request.options.profileId, request.options.toProfileId),
        };
      }
      case "profiles": {
        if (!this.dailyConfig) return { ok: false, status: "DAILY_CONFIG_UNAVAILABLE", code: "DAILY_CONFIG_UNAVAILABLE", mutation: false };
        const options = request.options ?? {};
        if (options.subcommand === "list") return this.dailyConfig.list();
        if (options.subcommand === "show") return this.dailyConfig.show(options.presetId);
        const selected = await this.dailyConfig.show(options.presetId);
        if (selected.ok === false) return selected;
        if (selected.status !== "PRESET_SHOW" || typeof selected.item?.profileId !== "string") {
          return { ok: false, status: "PRESET_REQUIRED", code: "PRESET_REQUIRED", mutation: false, id: options.presetId };
        }
        const plan = await this.bootstrap.planBootstrap({
          configRoot: options.configRoot,
          profile: selected.item.profileId,
          scope: "global",
        });
        const profilePlan = {
          ...plan,
          status: plan.status === "NO_CHANGES" ? "NO_CHANGES" : "PROFILE_APPLY_PLAN",
          preset: selected.item,
          restartRequired: plan.status !== "NO_CHANGES",
        };
        if (options.subcommand === "plan") return profilePlan;
        if (!(await approve(request, profilePlan, this.confirm))) return confirmationRequired(request.command, profilePlan);
        const result = await this.bootstrap.applyBootstrap({ ...options, plan });
        return { ...result, preset: selected.item, restartRequired: result.status !== "NO_CHANGES" };
      }
      case "models": {
        if (!this.dailyConfig) return { ok: false, status: "DAILY_CONFIG_UNAVAILABLE", code: "DAILY_CONFIG_UNAVAILABLE", mutation: false };
        try {
          const configuration = await this.dailyConfig.resolve({
            projectRoot: request.options?.projectRoot ?? null,
            // CLI validation may parse an explicitly named project document,
            // but this is not Pi runtime trust and cannot activate it.
            projectTrusted: request.options?.projectRoot !== null,
          });
          return {
            ok: true,
            status: "MODEL_CONFIGURATION_VALID_STATIC",
            mutation: false,
            runtimeAuthValidation: "UNAVAILABLE_OUTSIDE_PI_SESSION",
            projectTrust: request.options?.projectRoot ? "EXPLICIT_PATH_VALIDATION_ONLY" : "NOT_REQUESTED",
            configuration,
          };
        } catch (cause) {
          return { ok: false, status: "MODEL_CONFIGURATION_INVALID", code: cause?.code ?? "MODEL_CONFIGURATION_INVALID", mutation: false, message: cause?.message };
        }
      }
      case "gate": {
        if (!this.projectGates || typeof this.projectGates.plan !== "function") return { ok: false, status: "PROJECT_GATE_UNAVAILABLE", code: "PROJECT_GATE_UNAVAILABLE", mutation: false };
        try {
          const plan = await this.projectGates.plan(null, { projectRoot: request.options?.projectRoot ?? process.cwd(), requireTrust: false });
          return { ...plan, status: "PROJECT_GATE_VALID", explicitPathValidation: true };
        } catch (cause) {
          return { ok: false, status: "PROJECT_GATE_INVALID", code: cause?.code ?? "PROJECT_GATE_INVALID", message: cause?.message, mutation: false };
        }
      }
      case "runs": {
        if (!this.runManagement) return { ok: false, status: "RUN_MANAGEMENT_UNAVAILABLE", code: "RUN_MANAGEMENT_UNAVAILABLE", mutation: false };
        const options = request.options ?? {};
        if (options.subcommand === "list") return this.runManagement.list();
        if (options.subcommand === "show") return this.runManagement.show(options.runId);
        const plan = await this.runManagement.gcPlan();
        if (!options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.runManagement.gcApply(plan);
      }
      case "tools":
        return {
          ok: true,
          status: "TOOLS",
          mutation: false,
          active: null,
          available: ["read", "grep", "find", "ls", "edit", "write", "bash", "web"],
          enforcement: { state: "unknown", reason: "CLI has no live Pi session" },
        };
      case "packages": {
        if (!this.rootDir) {
          return { ok: false, status: "PACKAGES_UNAVAILABLE", mutation: false, code: "PACKAGES_UNAVAILABLE" };
        }
        const governance = loadGovernance(this.rootDir);
        const selected = request.options.profileId && this.bootstrap.profiles
          ? new Set((this.bootstrap.profiles.resolve(request.options.profileId)?.packages ?? []).map((entry) => entry.id))
          : null;
        const packages = [...(governance.inventory.packages ?? []), ...(governance.inventory.candidates ?? [])]
          .filter((entry) => selected === null || selected.has(entry.id))
          .map((entry) => ({
            id: entry.id,
            spec: entry.spec,
            mode: entry.mode ?? "promoted",
            installed: entry.installed === true,
            scope: entry.scope ?? null,
          }))
          .sort((left, right) => left.id.localeCompare(right.id));
        return { ok: true, status: "PACKAGES", mutation: false, packages };
      }
      case "context":
        return {
          ok: false,
          status: "CONTEXT_UNAVAILABLE",
          mutation: false,
          code: "CONTEXT_UNAVAILABLE",
          reason: "CLI has no parent Pi session context; use /omp context inside Pi",
        };
      case "verify": {
        const inspection = inspectReleaseGates([]);
        return { ok: true, status: "VERIFY_INSPECTOR", mutation: false, executable: false, ...inspection };
      }
      case "mode": {
        const modeService = this.modes ?? await this.#createDefaultModeService();
        if (!modeService || typeof modeService.dispatch !== "function") {
          return {
            ok: false,
            status: "MODE_REGISTRY_UNAVAILABLE",
            mutation: false,
            code: "MODE_REGISTRY_UNAVAILABLE",
            message: "Mode Registry is not available in this installation.",
            next: "run omp doctor and reinstall the promoted generation",
          };
        }
        return modeService.dispatch(request.options);
      }
      case "workflow": {
        if (!this.workflows || typeof this.workflows.dispatch !== "function") {
          return { ok: false, status: "WORKFLOW_REGISTRY_UNAVAILABLE", mutation: false, code: "WORKFLOW_REGISTRY_UNAVAILABLE", next: "run omp doctor:modes and reinstall the promoted generation" };
        }
        const options = request.options ?? {};
        if (options.subcommand === "resume") return this.workflows.dispatch(options);
        if (options.subcommand !== "run" || options.apply !== true) return this.workflows.dispatch(options);
        const plan = await this.workflows.dispatch({ ...options, apply: false, yes: false });
        if (plan?.ok === false) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.workflows.dispatch({
          ...options,
          apply: true,
          yes: true,
          inputFile: null,
          runId: plan.runId ?? options.runId,
          input: plan.input,
          conditions: plan.executionEnvelope?.conditions ?? options.conditions,
          expectedPlanDigest: plan.plan?.planDigest ?? null,
          expectedExecutionDigest: plan.executionEnvelope?.executionEnvelopeDigest ?? null,
        });
      }
      case "swarm": {
        if (!this.swarms || typeof this.swarms.dispatch !== "function") {
          return { ok: false, status: "SWARM_SERVICE_UNAVAILABLE", mutation: false, code: "SWARM_SERVICE_UNAVAILABLE", next: "run omp doctor and reinstall the promoted generation" };
        }
        const options = request.options ?? {};
        const operation = options.subcommand === "batch" ? options.batchSubcommand : options.subcommand === "goal" ? options.goalSubcommand : options.subcommand;
        if (operation === "resume") return this.swarms.dispatch(options);
        if (operation !== "run") return this.swarms.dispatch(options);
        const plan = await this.swarms.dispatch(options.subcommand === "batch"
          ? { ...options, batchSubcommand: "plan", yes: false }
          : options.subcommand === "goal"
            ? { ...options, goalSubcommand: "plan", yes: false }
            : { ...options, subcommand: "plan", yes: false });
        if (plan?.ok === false) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.swarms.dispatch({
          ...options,
          ...(options.subcommand === "batch" ? { batchSubcommand: "run" } : options.subcommand === "goal" ? { goalSubcommand: "run" } : { subcommand: "run" }),
          yes: true,
          inputFile: null,
          runId: plan.runId ?? options.runId,
          input: plan.input,
          conditions: plan.executionEnvelope?.conditions ?? options.conditions,
          expectedPlanDigest: plan.plan?.planDigest ?? null,
          expectedExecutionDigest: plan.executionEnvelope?.executionEnvelopeDigest ?? null,
          expectedAuthorizationDigest: plan.authorization?.authorizationDigest ?? null,
        });
      }
      case "ultra": {
        if (!this.ultras || typeof this.ultras.dispatch !== "function") return { ok: false, status: "ULTRA_RUN_SERVICE_UNAVAILABLE", mutation: false, code: "ULTRA_RUN_SERVICE_UNAVAILABLE" };
        const options = request.options ?? {};
        if (options.subcommand !== "run") return this.ultras.dispatch(options);
        const plan = await this.ultras.dispatch({ ...options, subcommand: "plan", yes: false });
        if (plan?.ok === false) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.ultras.dispatch({
          ...options,
          subcommand: "run",
          yes: true,
          inputFile: null,
          input: plan.request,
          expectedPlanDigest: plan.plan?.planDigest ?? null,
          expectedAuthorizationDigest: plan.authorization?.authorizationDigest ?? null,
        });
      }
      case "theme": {
        if (!this.themes || typeof this.themes.dispatch !== "function") {
          return {
            ok: false,
            status: "THEME_SERVICE_UNAVAILABLE",
            mutation: false,
            code: "THEME_SERVICE_UNAVAILABLE",
            next: "run omp doctor and reinstall the promoted generation",
          };
        }
        const options = request.options ?? {};
        if (!options.apply) return this.themes.dispatch(options);
        const plan = await this.themes.dispatch({ ...options, apply: false });
        if (plan?.ok === false) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.themes.dispatch({ ...options, apply: true });
      }
      default:
        throw Object.assign(new Error(`unsupported control command: ${request.command}`), { code: "UNSUPPORTED_COMMAND" });
    }
  }

  async #createDefaultModeService() {
    if (this.#defaultModeService !== undefined) return this.#defaultModeService;
    if (!this.rootDir) {
      this.#defaultModeService = null;
      return this.#defaultModeService;
    }
    try {
      const module = await import("./mode-service.mjs");
      this.#defaultModeService = module.createModeControlService({
        rootDir: this.rootDir,
        configRoot: this.configRoot,
      });
    } catch {
      this.#defaultModeService = null;
    }
    return this.#defaultModeService;
  }

  #defaultModeService;
}

export function createControlService(options) {
  return new ControlService(options);
}

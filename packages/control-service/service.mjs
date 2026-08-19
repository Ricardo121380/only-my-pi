import { loadGovernance } from "../../scripts/package-doctor.mjs";
import { inspectReleaseGates } from "../../scripts/release-gates.mjs";

export const OMP_USAGE = `only-my-pi control CLI

Usage:
  omp bootstrap [--profile <id>] [--mode <id>] [--provider <id>] [--model <id>] [--scope global|project] [--config-root <absolute>] [--dry-run|--apply] [--yes] [--json]
  omp doctor [--static|--live] [--config-root <absolute>] [--json]
  omp status [--config-root <absolute>] [--json]
  omp update [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp rollback [snapshot-id] [--yes] [--config-root <absolute>] [--json]
  omp uninstall [--plan|--apply] [--yes] [--config-root <absolute>] [--json]
  omp safe [--config-root <absolute>] [--json]
  omp profile [list|show <id>|diff <from> <to>] [--config-root <absolute>] [--json]
  omp tools|packages|context|verify [--config-root <absolute>] [--json]
  omp mode [list|show|use|reset|doctor|diff|scaffold] [mode-id] [--profile <id>] [--resolved] [--config-root <absolute>] [--json]
  omp workflow [list|show|run|status|cancel|resume] [workflow-or-run-id] [--input-file <absolute>] [--apply --yes] [--config-root <absolute>] [--json]
  omp swarm [list|show|validate|plan|run|status|cancel|resume] [recipe-or-run-id] [--input-file <absolute>] [--yes] [--config-root <absolute>] [--json]
  omp swarm batch [list|show|validate|plan|run|status|cancel|resume] [batch-or-run-id] [--input-file <absolute>] [--yes] [--config-root <absolute>] [--json]
  omp theme [list|show|preview|use|reset|doctor] [theme-id] [--apply --yes] [--config-root <absolute>] [--json]

Mutation is never implicit. bootstrap, update, and uninstall default to a zero-write plan.
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
  constructor({ bootstrap, doctor, confirm, modes, workflows, swarms, themes, statusService, rootDir, configRoot } = {}) {
    if (!bootstrap || !doctor) throw new TypeError("bootstrap and doctor services are required");
    this.bootstrap = bootstrap;
    this.doctor = doctor;
    this.confirm = confirm;
    this.modes = modes;
    this.workflows = workflows;
    this.swarms = swarms;
    this.themes = themes;
    this.statusService = statusService;
    this.rootDir = rootDir;
    this.configRoot = configRoot;
  }

  async dispatch(request) {
    switch (request.command) {
      case "help":
        return { ok: true, status: "HELP", mutation: false, text: OMP_USAGE };
      case "bootstrap": {
        const plan = await this.bootstrap.planBootstrap(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyBootstrap({ ...request.options, plan });
      }
      case "update": {
        const plan = await this.bootstrap.planUpdate(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyUpdate({ ...request.options, plan });
      }
      case "uninstall": {
        const plan = await this.bootstrap.planUninstall(request.options);
        if (!request.options.apply) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.applyUninstall({ ...request.options, plan });
      }
      case "rollback": {
        const plan = await this.bootstrap.planRollback(request.options);
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.bootstrap.rollback({ ...request.options, plan });
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
        const operation = options.subcommand === "batch" ? options.batchSubcommand : options.subcommand;
        if (operation === "resume") return this.swarms.dispatch(options);
        if (operation !== "run") return this.swarms.dispatch(options);
        const plan = await this.swarms.dispatch(options.subcommand === "batch"
          ? { ...options, batchSubcommand: "plan", yes: false }
          : { ...options, subcommand: "plan", yes: false });
        if (plan?.ok === false) return plan;
        if (!(await approve(request, plan, this.confirm))) return confirmationRequired(request.command, plan);
        return this.swarms.dispatch({
          ...options,
          ...(options.subcommand === "batch" ? { batchSubcommand: "run" } : { subcommand: "run" }),
          yes: true,
          runId: plan.runId ?? options.runId,
          input: plan.input,
          conditions: plan.executionEnvelope?.conditions ?? options.conditions,
          expectedPlanDigest: plan.plan?.planDigest ?? null,
          expectedExecutionDigest: plan.executionEnvelope?.executionEnvelopeDigest ?? null,
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

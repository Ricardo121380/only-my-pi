import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createModeControlService } from "../../packages/control-service/mode-service.mjs";
import { validateModeReceipt } from "../../packages/mode-registry/index.mjs";
import { buildContextSnapshot, formatSnapshot } from "../context-doctor/metrics.mjs";

const TOKEN = /^[A-Za-z0-9:_./-]+$/u;
const ROOT_COMMANDS = new Set(["", "help", "run", "runs", "agent", "status", "doctor", "profile", "mode", "workflow", "tools", "packages", "context", "verify", "safe", "swarm", "theme", "overlays", "models", "gate"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseOmpCommand(input = "") {
  if (typeof input !== "string" || input.length > 2048 || /[\0\r\n]/u.test(input)) fail("INVALID_COMMAND", "command text is bounded and single-line");
  const trimmed = input.trim();
  if (trimmed === "") return { command: "help", args: [] };
  const args = trimmed.split(/\s+/u);
  if (args.some((token) => !TOKEN.test(token))) fail("INVALID_COMMAND", "quoted or shell-shaped arguments are not accepted");
  const command = args.shift();
  if (!ROOT_COMMANDS.has(command)) fail("UNKNOWN_COMMAND", `unknown /omp command: ${command}`);
  return { command: command || "help", args };
}

function bounded(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).replace(/[\0\r\n\t]+/gu, " ").slice(0, 768);
}

function asText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return bounded(result, "unavailable");
  const lines = [`status: ${bounded(result.status, "UNKNOWN")}`];
  if (result.code) lines.push(`code: ${bounded(result.code)}`);
  if (result.message) lines.push(`message: ${bounded(result.message)}`);
  if (result.modeId) lines.push(`mode: ${bounded(result.modeId)}`);
  if (result.themeId) lines.push(`theme: ${bounded(result.themeId)}`);
  if (result.presetId) lines.push(`preset: ${bounded(result.presetId)}`);
  if (Array.isArray(result.hardOverlays)) lines.push(`hardOverlays: ${result.hardOverlays.map((entry) => bounded(entry)).join(", ") || "none"}`);
  if (Array.isArray(result.softOverlays)) lines.push(`softOverlays: ${result.softOverlays.map((entry) => bounded(entry)).join(", ") || "none"}`);
  if (result.piThemeName) lines.push(`piTheme: ${bounded(result.piThemeName)}`);
  if (result.count !== undefined) lines.push(`count: ${bounded(result.count)}`);
  if (result.next) lines.push(`next: ${bounded(result.next)}`);
  if (result.reason) lines.push(`reason: ${bounded(result.reason)}`);
  if (Array.isArray(result.modes)) lines.push(`modes: ${result.modes.map((entry) => bounded(entry.id ?? entry)).join(", ") || "none"}`);
  if (result.executionState) lines.push(`executionState: ${bounded(result.executionState)}`);
  if (result.harnessStatus?.status) lines.push(`harnessStatus: ${bounded(result.harnessStatus.status)}`);
  if (result.harnessStatus?.provenance) lines.push(`provenance: ${bounded(result.harnessStatus.provenance)}`);
  if (result.preview?.ansi) lines.push(`preview: ${bounded(result.preview.ansi, 512)}`);
  return lines.join("\n");
}

function notify(ctx, value, level = "info") {
  if (typeof ctx?.ui?.notify === "function") ctx.ui.notify(asText(value), level);
}

function wizardLines(value, label, { maximum = 64, allowDot = true } = {}) {
  const lines = String(value ?? "").split(/\r?\n/gu).map((entry) => entry.trim()).filter(Boolean);
  if (lines.length > maximum) fail("WIZARD_INPUT_INVALID", `${label} exceeds ${maximum} entries`);
  for (const entry of lines) {
    if (entry.length > 1024 || entry.includes("\0")) fail("WIZARD_INPUT_INVALID", `${label} contains an invalid entry`);
    if (label === "scope" && !(allowDot && entry === ".")) {
      if (path.isAbsolute(entry) || entry.includes("\\") || path.posix.normalize(entry) !== entry || entry.split("/").some((segment) => !segment || segment === "." || segment === "..")) fail("WIZARD_SCOPE_INVALID", `scope path must be repository-relative: ${entry}`);
    }
  }
  return lines;
}

function wizardItemId(value, index) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48);
  return `${normalized || "item"}-${index + 1}`;
}

async function readRootJson(rootDir, relative) {
  try {
    return JSON.parse(await fs.readFile(path.join(rootDir, relative), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function profileSummary(document) {
  if (!document || typeof document !== "object") return null;
  return {
    id: document.id,
    description: document.description ?? "",
    packages: Array.isArray(document.packageIds) ? [...document.packageIds].sort() : [],
    capabilities: Array.isArray(document.capabilityIds) ? [...document.capabilityIds].sort() : [],
  };
}

function latestModeReceipt(entries) {
  if (!Array.isArray(entries)) return { status: "MODE_RECEIPT_UNAVAILABLE", code: "SESSION_ENTRIES_UNAVAILABLE" };
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== "only-my-pi-mode") continue;
    const candidate = entry.data?.receipt;
    if (!candidate) return { status: "MODE_RECEIPT_IGNORED", code: "MODE_RECEIPT_MISSING" };
    return { status: "CANDIDATE", candidate };
  }
  return { status: "NO_MODE_RECEIPT" };
}

/**
 * Re-resolve the last persisted mode receipt against the current registry.
 * A receipt never supplies prompt text or policy; it only proves which
 * resolved hash was previously active.  Any malformed, missing, or drifted
 * receipt is retained as evidence and fails closed without injecting a
 * prompt.
 */
export async function restoreModeReceipt({ registry, entries, profile } = {}) {
  const located = latestModeReceipt(entries);
  if (located.status !== "CANDIDATE") return located;
  const validation = validateModeReceipt(located.candidate);
  if (!validation.valid) {
    return {
      status: "MODE_RECEIPT_IGNORED",
      code: "INVALID_MODE_RECEIPT",
      errors: validation.errors.slice(0, 4),
    };
  }
  if (!registry || typeof registry.resolve !== "function") {
    return { status: "MODE_RECEIPT_UNAVAILABLE", code: "MODE_REGISTRY_UNAVAILABLE", receipt: located.candidate };
  }
  let target;
  try {
    target = await registry.resolve(located.candidate.modeId, { refresh: true, profile });
  } catch (cause) {
    return {
      status: "MODE_RECEIPT_UNAVAILABLE",
      code: cause?.code ?? "MODE_RESOLUTION_FAILED",
      receipt: located.candidate,
    };
  }
  if (target.hash !== located.candidate.hash || target.sourceHash !== located.candidate.sourceHash) {
    return {
      status: "STALE_MODE_SNAPSHOT",
      code: "STALE_MODE_SNAPSHOT",
      modeId: located.candidate.modeId,
      receipt: located.candidate,
      current: { modeId: target.modeId, hash: target.hash, sourceHash: target.sourceHash },
    };
  }
  return {
    status: "MODE_RESTORED",
    modeId: target.modeId,
    hash: target.hash,
    sourceHash: target.sourceHash,
    target,
  };
}

/**
 * Runtime command adapter shared by the Pi extension and deterministic tests.
 * It never invokes a shell and treats missing live services as an explicit
 * unavailable state rather than guessing a permission or sandbox state.
 */
export function createOmpRuntime({ rootDir, configRoot, registry, modeService, agentService, workflowService, swarmService, batchService, ultraService, subagentsOrchestration, goalController, ultraRouter, configurationProvider, projectGateService, webAuthorizer, runManagement, themeService, dailyConfigService, statusService, sessionDriver, snapshotProvider, profile, onModeRestored, onModeStale, getModeRestoreStatus } = {}) {
  const derivedRoot = rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const derivedConfigRoot = configRoot ?? process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  let modes = modeService;
  let agents = agentService;
  let workflows = workflowService;
  let swarms = swarmService;
  let ultras = ultraService;
  let themes = themeService;
  let dailyConfig = dailyConfigService;
  let statuses = statusService;
  const getModes = async () => {
    if (!modes) modes = createModeControlService({ rootDir: derivedRoot, configRoot: derivedConfigRoot, registry, sessionDriver });
    return modes;
  };
  const getAgents = async () => {
    if (!agents) {
      const module = await import("../../packages/control-service/agent-service.mjs");
      agents = module.createAgentControlService({ rootDir: derivedRoot, orchestration: subagentsOrchestration, configurationProvider });
    }
    return agents;
  };
  const getWorkflows = async () => {
    if (!workflows) {
      // Keep the M3 packaged runtime dependency-closed: workflow support is an
      // M4 surface and must not be imported during the minimal extension's
      // startup path.  The dynamic import also makes a missing optional
      // workflow bundle an explicit command-time UNAVAILABLE result.
      const module = await import("../../packages/control-service/workflow-service.mjs");
      workflows = module.createWorkflowControlService({ rootDir: derivedRoot, orchestration: subagentsOrchestration });
    }
    return workflows;
  };
  const getSwarms = async () => {
    if (!swarms) {
      // Swarm is an optional M5 surface.  Keep it out of minimal startup and
      // only load the adapter/control bundle when the user invokes /omp swarm.
      const module = await import("../../packages/control-service/swarm-service.mjs");
      swarms = module.createSwarmControlService({ rootDir: derivedRoot, orchestration: subagentsOrchestration, batchService, goalController });
    }
    return swarms;
  };
  const getUltras = async () => {
    if (!ultras) {
      const module = await import("../../packages/control-service/ultra-run-service.mjs");
      ultras = module.createUltraRunControlService({ rootDir: derivedRoot, router: ultraRouter });
    }
    return ultras;
  };
  const getThemes = async () => {
    if (!themes) {
      const module = await import("../../packages/control-service/theme-service.mjs");
      themes = module.createThemeControlService({ rootDir: derivedRoot });
    }
    return themes;
  };
  const getStatuses = async () => {
    if (!statuses) {
      const module = await import("../../packages/control-service/status-service.mjs");
      statuses = module.createStatusService();
    }
    return statuses;
  };
  const getDailyConfig = async () => {
    if (!dailyConfig) {
      if (!derivedConfigRoot) fail("DAILY_CONFIG_UNAVAILABLE", "Pi config root is unavailable");
      const module = await import("../../packages/daily-config/index.mjs");
      dailyConfig = module.createDailyConfigService({ rootDir: derivedRoot, configRoot: derivedConfigRoot });
    }
    return dailyConfig;
  };
  const authorizeWeb = async ({ runId, roles, objectiveDigest, label, ctx }) => {
    if (!webAuthorizer || typeof configurationProvider !== "function") fail("PUBLIC_WEB_AUTHORIZATION_UNAVAILABLE", "public Web authorization service is unavailable");
    const configuration = await configurationProvider();
    const providerIds = [...new Set(roles.map((role) => configuration.models?.roles?.[role]?.model).filter((value) => value && value !== "inherit"))];
    const webPlan = await webAuthorizer.plan({ runId, roles, objectiveDigest, budget: configuration.budget, providerIds });
    const approved = typeof ctx?.ui?.confirm === "function"
      ? await ctx.ui.confirm(`Authorize public Web for ${label}?`, `${webPlan.roles.join(", ")} may send the bounded task to public internet providers. Browser cookies are disabled and private/reserved destinations are blocked.\nBudget: ${JSON.stringify(webPlan.budget)}`)
      : false;
    if (!approved) return null;
    await webAuthorizer.grant(webPlan);
    return webPlan;
  };
  const backgroundRuns = new Map();
  const gateAdmission = async (plan, ctx) => {
    const gateIds = [...new Set((plan?.nodes ?? []).filter((node) => node.kind === "gate").map((node) => node.gateId))];
    if (gateIds.length === 0) return { gateIds, plan: null, needsGrant: false };
    if (!projectGateService) fail("PROJECT_GATE_UNAVAILABLE", "Workflow requires project gates but the gate service is unavailable");
    const gatePlan = await projectGateService.plan(gateIds);
    const status = projectGateService.status();
    return { gateIds, plan: gatePlan, needsGrant: status.bindingDigest !== gatePlan.binding.bindingDigest };
  };
  const runBackground = (runId, label, operation, ctx) => {
    if (backgroundRuns.has(runId)) fail("RUN_ALREADY_ACTIVE", `run is already active: ${runId}`);
    const promise = Promise.resolve().then(operation);
    backgroundRuns.set(runId, promise);
    if (ctx?.mode === "tui") ctx.ui.setStatus("only-my-pi-run", `${label} ${runId}`);
    void promise.then(
      (result) => notify(ctx, result, result?.ok === false ? "warning" : "info"),
      (cause) => notify(ctx, { status: "RUN_BACKGROUND_FAILED", code: cause?.code ?? "RUN_BACKGROUND_FAILED", message: cause?.message }, "warning"),
    ).finally(() => {
      backgroundRuns.delete(runId);
      if (ctx?.mode === "tui" && backgroundRuns.size === 0) ctx.ui.setStatus("only-my-pi-run", undefined);
    });
    return { ok: true, status: "RUN_STARTED_BACKGROUND", mutation: true, runId, label, next: `/omp runs show ${runId}` };
  };
  const runWizard = async (ctx) => {
    if (ctx?.mode !== "tui" || typeof ctx?.ui?.select !== "function" || typeof ctx?.ui?.editor !== "function" || typeof ctx?.ui?.confirm !== "function") {
      return { ok: false, status: "RUN_WIZARD_UNAVAILABLE", code: "TUI_REQUIRED", mutation: false };
    }
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return { ok: false, status: "RUN_WIZARD_UNAVAILABLE", code: "SESSION_IDLE_REQUIRED", mutation: false };
    const type = await ctx.ui.select("Choose only-my-pi execution type", ["Agent", "BatchSwarm", "Workflow", "SwarmGoal", "Ultra"]);
    if (!type) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
    const task = await ctx.ui.editor("Task objective (required)");
    if (!task?.trim()) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
    if (Buffer.byteLength(task, "utf8") > 64 * 1024) fail("WIZARD_INPUT_INVALID", "task exceeds 64 KiB");
    const scopeText = await ctx.ui.editor("Repository-relative scope (one path per line)", ".");
    if (scopeText === undefined) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
    const scope = wizardLines(scopeText, "scope");
    const acceptanceText = await ctx.ui.editor("Acceptance criteria (one item per line)", "Return evidence, gaps, and a clear verdict.");
    if (acceptanceText === undefined) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
    const acceptance = wizardLines(acceptanceText, "acceptance");
    const input = Object.freeze({ task: task.trim(), scope, acceptance });
    const execution = await ctx.ui.select("Execution", ["Foreground", "Background (current Pi session)"]);
    if (!execution) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };

    let target;
    let planned;
    let runOperation;
    let webRoles = [];
    let objectiveDigest;
    if (type === "Agent") {
      const service = await getAgents();
      const listed = await service.dispatch({ subcommand: "list" });
      const choices = listed.agents.map((entry) => entry.id);
      target = await ctx.ui.select("Choose Agent role", choices);
      if (!target) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
      planned = await service.dispatch({ subcommand: "plan", agentId: target, input });
      if (planned.ok === false) return planned;
      if (planned.authority.web) webRoles = [target];
      objectiveDigest = planned.executionEnvelope.runInputDigest;
      runOperation = () => service.dispatch({ subcommand: "run", agentId: target, runId: planned.runId, input: planned.input, yes: true, expectedPlanDigest: planned.plan.planDigest, expectedExecutionDigest: planned.executionEnvelope.executionEnvelopeDigest, signal: ctx.signal });
    } else if (type === "BatchSwarm") {
      const service = await getSwarms();
      const listed = await service.dispatch({ subcommand: "batch", batchSubcommand: "list" });
      target = await ctx.ui.select("Choose BatchSwarm", listed.batches.map((entry) => entry.id));
      if (!target) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
      const batchInput = { ...input, artifacts: { items: (scope.length ? scope : ["."]).map((item, index) => ({ itemId: wizardItemId(item, index), path: item, objective: input.task })) } };
      planned = await service.dispatch({ subcommand: "batch", batchSubcommand: "plan", batchId: target, input: batchInput });
      if (planned.ok === false) return planned;
      objectiveDigest = planned.executionEnvelope.runInputDigest;
      runOperation = () => service.dispatch({ subcommand: "batch", batchSubcommand: "run", batchId: target, runId: planned.runId, input: planned.input, yes: true, expectedPlanDigest: planned.plan.planDigest, expectedExecutionDigest: planned.executionEnvelope.executionEnvelopeDigest, signal: ctx.signal });
    } else if (type === "Workflow") {
      const service = await getWorkflows();
      const listed = await service.dispatch({ subcommand: "list" });
      const choices = listed.workflows.filter((entry) => entry.manifest?.mutationScope === "none").map((entry) => entry.id);
      target = await ctx.ui.select("Choose read-only Workflow", choices);
      if (!target) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
      planned = await service.dispatch({ subcommand: "run", workflowId: target, input, conditions: ["profile-resolved", "mode-resolved", "session-idle"], apply: false, yes: false });
      if (planned.ok === false) return planned;
      webRoles = [...new Set((planned.plan.nodes ?? []).filter((node) => node.kind === "agent" && ["researcher", "source-verifier"].includes(node.agentTemplateRef)).map((node) => node.agentTemplateRef))];
      objectiveDigest = planned.executionEnvelope.runInputDigest;
      runOperation = () => service.dispatch({ subcommand: "run", workflowId: target, runId: planned.runId, input: planned.input, conditions: planned.executionEnvelope.conditions, apply: true, yes: true, expectedPlanDigest: planned.plan.planDigest, expectedExecutionDigest: planned.executionEnvelope.executionEnvelopeDigest, signal: ctx.signal });
    } else if (type === "SwarmGoal") {
      const service = await getSwarms();
      const listed = await service.dispatch({ subcommand: "goal", goalSubcommand: "list" });
      target = await ctx.ui.select("Choose SwarmGoal", listed.goals.map((entry) => entry.id));
      if (!target) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
      planned = await service.dispatch({ subcommand: "goal", goalSubcommand: "plan", goalId: target, input });
      if (planned.ok === false) return planned;
      webRoles = planned.authority?.web ? planned.authority.webRoles : [];
      objectiveDigest = planned.authorization.inputDigest;
      runOperation = () => service.dispatch({ subcommand: "goal", goalSubcommand: "run", goalId: target, runId: planned.runId, input: planned.input, yes: true, expectedPlanDigest: planned.plan.planDigest, expectedAuthorizationDigest: planned.authorization.authorizationDigest, approveRevisionExpansion: async (_revision, _proposal, assessment) => ctx.ui.confirm("Approve expanded SwarmGoal revision?", JSON.stringify(assessment.expansions)), signal: ctx.signal });
    } else {
      const service = await getUltras();
      const listed = await service.dispatch({ subcommand: "list" });
      target = await ctx.ui.select("Choose Ultra strategy", listed.strategies.map((entry) => entry.id));
      if (!target) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
      const effort = await ctx.ui.select("Ultra task shape", ["Focused Agent", "Structured Workflow", "Dynamic SwarmGoal"]);
      if (!effort) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
      const complexity = effort === "Focused Agent" ? 10 : effort === "Structured Workflow" ? 60 : 90;
      const requestId = `ultra-${crypto.randomUUID()}`;
      const taskDigest = `sha256:${crypto.createHash("sha256").update(input.task).digest("hex")}`;
      const requestDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
      const ultraRequest = { id: requestId, taskDigest, complexity, itemCount: Math.max(1, scope.length), homogeneous: false, dynamicGoal: effort === "Dynamic SwarmGoal", mutation: "none", risk: effort === "Dynamic SwarmGoal" ? "high" : "low", origin: { kind: "human", requestDigest }, ...(effort === "Structured Workflow" ? { preferredWorkflow: "source-review-v2" } : {}), ...(effort === "Dynamic SwarmGoal" ? { preferredGoal: "research-release-goal" } : {}) };
      planned = await service.dispatch({ subcommand: "plan", strategyId: target, input: ultraRequest });
      if (planned.ok === false) return planned;
      if (planned.plan.route === "swarm-goal") webRoles = ["researcher", "source-verifier"];
      objectiveDigest = taskDigest;
      runOperation = () => service.dispatch({ subcommand: "run", strategyId: target, input: planned.request, routeInput: input, yes: true, expectedPlanDigest: planned.plan.planDigest, expectedAuthorizationDigest: planned.authorization?.authorizationDigest ?? null, signal: ctx.signal });
    }

    const gate = await gateAdmission(planned.plan, ctx);
    const configuration = typeof configurationProvider === "function" ? await configurationProvider() : null;
    let webPlan = null;
    if (webRoles.length > 0) {
      if (!webAuthorizer || !configuration) fail("PUBLIC_WEB_AUTHORIZATION_UNAVAILABLE", "public Web authorization service is unavailable");
      webPlan = await webAuthorizer.plan({ runId: planned.runId ?? planned.request?.id, roles: webRoles, objectiveDigest, budget: configuration.budget, providerIds: [...new Set(webRoles.map((role) => configuration.models?.roles?.[role]?.model).filter((value) => value && value !== "inherit"))] });
    }
    const runId = planned.runId ?? planned.request?.id;
    const planDigest = planned.plan?.planDigest;
    const summary = [
      `type=${type} target=${target} runId=${runId}`,
      `plan=${planDigest}`,
      configuration ? `preset=${configuration.preset.id} budget=${JSON.stringify(configuration.budget)}` : "configuration=unavailable",
      webPlan ? `web=${webPlan.status} roles=${webPlan.roles.join(",")} cookies=false` : "web=disabled",
      gate.gateIds.length ? `gates=${gate.gateIds.join(",")} warning=${gate.plan.warning}` : "gates=none",
      `execution=${execution}`,
    ].join("\n");
    const approved = await ctx.ui.confirm("Run this exact only-my-pi plan?", summary);
    if (!approved) return { ok: true, status: "RUN_WIZARD_CANCELLED", mutation: false };
    if (webPlan) await webAuthorizer.grant(webPlan);
    if (gate.needsGrant) await projectGateService.grant(gate.plan);
    if (execution.startsWith("Background")) return runBackground(runId, `${type}:${target}`, runOperation, ctx);
    return runOperation();
  };

  const restoreSession = async (entries) => {
    let liveRegistry = registry;
    try {
      const service = await getModes();
      if (!liveRegistry && typeof service?.getRegistry === "function") liveRegistry = await service.getRegistry();
    } catch (cause) {
      return { status: "MODE_RECEIPT_UNAVAILABLE", code: cause?.code ?? "MODE_REGISTRY_UNAVAILABLE" };
    }
    const result = await restoreModeReceipt({ registry: liveRegistry, entries, profile });
    if (result.status === "MODE_RESTORED" && typeof onModeRestored === "function") {
      await onModeRestored(result.target, result);
    } else if (result.status === "STALE_MODE_SNAPSHOT" && typeof onModeStale === "function") {
      await onModeStale(result);
    }
    return result;
  };

  return {
    restoreSession,
    async execute(input, ctx = {}) {
      const parsed = typeof input === "string" ? parseOmpCommand(input) : input;
      const command = parsed.command;
      const args = parsed.args ?? [];
      if (command === "help") {
        return {
          ok: true,
          status: "HELP",
          text: "/omp run|runs|agent|workflow|swarm|ultra|gate|status|doctor|profile|overlays|models|mode|theme|tools|packages|context|verify|safe|help",
        };
      }
      if (command === "run") {
        if (args.length > 0) {
          const result = { ok: false, status: "RUN_WIZARD_INVALID", code: "RUN_WIZARD_ACCEPTS_NO_ARGUMENTS", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const result = await runWizard(ctx);
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "mode") {
        const subcommand = args[0] ?? "list";
        const modeId = args[1] ?? null;
        const result = await (await getModes()).dispatch({
          subcommand,
          modeId,
          configRoot,
          resolved: args.includes("--resolved"),
        });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "agent") {
        const subcommand = args[0] ?? "list";
        const identifier = args[1] && !args[1].startsWith("--") ? args[1] : null;
        if (!["list", "show", "plan", "run", "status", "cancel", "resume"].includes(subcommand)) {
          const result = { ok: false, status: "AGENT_COMMAND_INVALID", code: "INVALID_AGENT_COMMAND", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const service = await getAgents();
        const lifecycle = ["status", "cancel", "resume"].includes(subcommand);
        let input = {};
        if (["plan", "run", "resume"].includes(subcommand)) {
          if (ctx?.mode !== "tui" || typeof ctx?.ui?.editor !== "function") {
            const result = { ok: false, status: "AGENT_INPUT_UNAVAILABLE", code: "TUI_TASK_EDITOR_REQUIRED", mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
          const task = await ctx.ui.editor(subcommand === "resume" ? "Original Agent task" : `Task for ${identifier ?? "Agent"}`);
          if (task === undefined || !task.trim()) return { ok: true, status: "AGENT_RUN_CANCELLED", mutation: false };
          input = { task: task.trim() };
        }
        const request = { subcommand, agentId: lifecycle ? null : identifier, runId: lifecycle ? identifier : null, input, signal: ctx?.signal };
        if (subcommand !== "run") {
          const result = await service.dispatch(request);
          notify(ctx, result, result.ok === false ? "warning" : "info");
          return result;
        }
        const plan = await service.dispatch({ ...request, subcommand: "plan" });
        if (plan.ok === false) { notify(ctx, plan, "warning"); return plan; }
        let webPlan = null;
        if (plan.authority?.web === true) {
          if (!webAuthorizer || typeof configurationProvider !== "function") {
            const result = { ok: false, status: "PUBLIC_WEB_AUTHORIZATION_UNAVAILABLE", code: "PUBLIC_WEB_AUTHORIZATION_UNAVAILABLE", mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
          try {
            const configuration = await configurationProvider();
            webPlan = await webAuthorizer.plan({
              runId: plan.runId,
              roles: [identifier],
              objectiveDigest: plan.executionEnvelope.runInputDigest,
              budget: configuration.budget,
              providerIds: [plan.configuration?.models?.roles?.[identifier]?.model].filter((value) => value && value !== "inherit"),
            });
          } catch (cause) {
            const result = { ok: false, status: "PUBLIC_WEB_POLICY_BLOCKED", code: cause?.code ?? "PUBLIC_WEB_POLICY_BLOCKED", message: cause?.message, mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
        }
        const approved = typeof ctx?.ui?.confirm === "function"
          ? await ctx.ui.confirm(`Run read-only Agent ${identifier}?`, `${webPlan ? `${webPlan.status}: public internet, cookies disabled, SSRF guarded.\n` : ""}Model/tool/budget plan: ${plan.plan.planDigest}`)
          : false;
        if (!approved) return { ok: true, status: "AGENT_RUN_CANCELLED", mutation: false };
        if (webPlan) await webAuthorizer.grant(webPlan);
        const result = await service.dispatch({
          ...request,
          yes: true,
          runId: plan.runId,
          input: plan.input,
          expectedPlanDigest: plan.plan.planDigest,
          expectedExecutionDigest: plan.executionEnvelope.executionEnvelopeDigest,
        });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "gate") {
        if (!projectGateService) {
          const result = { ok: false, status: "PROJECT_GATE_UNAVAILABLE", code: "PROJECT_GATE_UNAVAILABLE", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const subcommand = args[0] ?? "trust";
        if (subcommand === "trust") {
          const operation = args[1] ?? "create";
          if (operation === "status") { const result = projectGateService.status(); notify(ctx, result); return result; }
          if (operation === "reset") { const result = projectGateService.reset(); notify(ctx, result); return result; }
          if (operation !== "create" || args.length > 1) {
            const result = { ok: false, status: "PROJECT_GATE_COMMAND_INVALID", code: "INVALID_PROJECT_GATE_COMMAND", mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
          let plan;
          try { plan = await projectGateService.plan(); }
          catch (cause) { const result = { ok: false, status: "PROJECT_GATE_PLAN_BLOCKED", code: cause?.code ?? "PROJECT_GATE_PLAN_BLOCKED", message: cause?.message, mutation: false }; notify(ctx, result, "warning"); return result; }
          const approved = typeof ctx?.ui?.confirm === "function"
            ? await ctx.ui.confirm("Authorize project gates for this Pi session?", `${plan.binding.gateIds.join(", ")}\n${plan.warning}`)
            : false;
          if (!approved) return { ok: true, status: "PROJECT_GATE_TRUST_CANCELLED", mutation: false };
          const result = await projectGateService.grant(plan);
          notify(ctx, result);
          return result;
        }
        if (subcommand === "plan") {
          try { const result = await projectGateService.plan(args.slice(1).length ? args.slice(1) : null); notify(ctx, result); return result; }
          catch (cause) { const result = { ok: false, status: "PROJECT_GATE_PLAN_BLOCKED", code: cause?.code ?? "PROJECT_GATE_PLAN_BLOCKED", message: cause?.message, mutation: false }; notify(ctx, result, "warning"); return result; }
        }
        if (subcommand === "run" && args[1]) {
          try { const result = await projectGateService.run(args[1], { signal: ctx?.signal }); notify(ctx, result, result.status === "PASS" ? "info" : "warning"); return result; }
          catch (cause) { const result = { ok: false, status: "PROJECT_GATE_RUN_BLOCKED", code: cause?.code ?? "PROJECT_GATE_RUN_BLOCKED", message: cause?.message, mutation: false }; notify(ctx, result, "warning"); return result; }
        }
        const result = { ok: false, status: "PROJECT_GATE_COMMAND_INVALID", code: "INVALID_PROJECT_GATE_COMMAND", mutation: false };
        notify(ctx, result, "warning");
        return result;
      }
      if (command === "runs") {
        if (!runManagement) {
          const result = { ok: false, status: "RUN_MANAGEMENT_UNAVAILABLE", code: "RUN_MANAGEMENT_UNAVAILABLE", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const subcommand = args[0] ?? "list";
        const id = args[1] ?? null;
        try {
          if (subcommand === "list" && args.length === 0) { const result = await runManagement.list(); notify(ctx, result); return result; }
          if (subcommand === "show" && id && args.length === 2) { const result = await runManagement.show(id); notify(ctx, result); return result; }
          if (subcommand === "cancel" && id && args.length === 2) { const result = await runManagement.cancel(id); notify(ctx, result, result.ok === false ? "warning" : "info"); return result; }
          if (subcommand === "resume" && id && args.length === 2) { const result = await runManagement.resume(id); notify(ctx, result, result.ok === false ? "warning" : "info"); return result; }
          if (subcommand === "gc" && args.length === 1) {
            const plan = await runManagement.gcPlan();
            if (plan.candidates.length === 0) { notify(ctx, plan); return plan; }
            const approved = typeof ctx?.ui?.confirm === "function"
              ? await ctx.ui.confirm("Delete expired raw run data?", `${plan.candidates.length} terminal run(s). Receipts, digests, plans, and journals are retained.`)
              : false;
            if (!approved) return plan;
            const result = await runManagement.gcApply(plan);
            notify(ctx, result);
            return result;
          }
        } catch (cause) {
          const result = { ok: false, status: "RUN_MANAGEMENT_BLOCKED", code: cause?.code ?? "RUN_MANAGEMENT_BLOCKED", message: cause?.message, mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const result = { ok: false, status: "RUN_COMMAND_INVALID", code: "INVALID_RUN_COMMAND", mutation: false };
        notify(ctx, result, "warning");
        return result;
      }
      if (command === "workflow") {
        const subcommand = args[0] ?? "list";
        const identifier = args[1] ?? null;
        const inputFileIndex = args.indexOf("--input-file");
        const inputFile = inputFileIndex >= 0 ? args[inputFileIndex + 1] : null;
        const approved = args.includes("--apply") && args.includes("--yes");
        const service = await getWorkflows();
        const request = {
          subcommand,
          workflowId: ["status", "cancel", "resume"].includes(subcommand) ? null : identifier,
          runId: ["status", "cancel", "resume"].includes(subcommand) ? identifier : null,
          inputFile,
          ...(inputFile ? {} : { input: {} }),
          conditions: ["profile-resolved", "mode-resolved", "session-idle"],
        };
        let result;
        if (subcommand === "run" && approved) {
          const plan = await service.dispatch({ ...request, apply: false, yes: false });
          result = plan?.ok === false
            ? plan
            : await (async () => {
              if (plan.plan?.policy?.egress?.web && plan.plan.policy.egress.web !== "deny") {
                const roles = [...new Set((plan.plan.nodes ?? []).filter((node) => node.kind === "agent" && ["researcher", "source-verifier"].includes(node.agentTemplateRef)).map((node) => node.agentTemplateRef))];
                if (!await authorizeWeb({ runId: plan.runId, roles, objectiveDigest: plan.executionEnvelope?.runInputDigest, label: `Workflow ${plan.workflowId ?? identifier}`, ctx })) return { ok: true, status: "PUBLIC_WEB_RUN_CANCELLED", mutation: false };
              }
              return service.dispatch({
              ...request,
              apply: true,
              yes: true,
              inputFile: null,
              runId: plan.runId ?? request.runId,
              input: plan.input,
              conditions: plan.executionEnvelope?.conditions ?? request.conditions,
              expectedPlanDigest: plan.plan?.planDigest ?? null,
              expectedExecutionDigest: plan.executionEnvelope?.executionEnvelopeDigest ?? null,
              });
            })();
        } else {
          result = await service.dispatch({ ...request, apply: false, yes: false });
        }
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "swarm") {
        const subcommand = args[0] ?? "list";
        const batch = subcommand === "batch";
        const goal = subcommand === "goal";
        const operation = batch || goal ? (args[1] ?? "list") : subcommand;
        const identifier = batch || goal ? (args[2] ?? null) : (args[1] ?? null);
        const inputFileIndex = args.indexOf("--input-file");
        const inputFile = inputFileIndex >= 0 ? args[inputFileIndex + 1] : null;
        const service = await getSwarms();
        const request = {
          subcommand: batch ? "batch" : goal ? "goal" : subcommand,
          ...(batch ? { batchSubcommand: operation } : {}),
          ...(goal ? { goalSubcommand: operation } : {}),
          recipeId: batch || goal || ["status", "cancel", "resume"].includes(operation) ? null : identifier,
          ...(batch ? { batchId: !["status", "cancel", "resume"].includes(operation) ? identifier : null } : {}),
          ...(goal ? { goalId: operation === "status" ? null : identifier } : {}),
          runId: ["status", "cancel", "resume"].includes(operation) ? identifier : null,
          inputFile,
          ...(inputFile ? {} : { input: {} }),
        };
        const approved = args.includes("--yes");
        let result;
        if (operation === "run" && approved) {
          const plan = await service.dispatch(batch
            ? { ...request, batchSubcommand: "plan", yes: false }
            : goal
              ? { ...request, goalSubcommand: "plan", yes: false }
              : { ...request, subcommand: "plan", yes: false });
          result = plan?.ok === false
            ? plan
            : await (async () => {
              const web = goal ? plan.authority?.web === true : Boolean(plan.plan?.policy?.egress?.web && plan.plan.policy.egress.web !== "deny");
              if (web) {
                const roles = goal ? plan.authority.webRoles : [...new Set(plan.plan.nodes.filter((node) => node.kind === "agent" && ["researcher", "source-verifier"].includes(node.agentTemplateRef)).map((node) => node.agentTemplateRef))];
                if (!await authorizeWeb({ runId: plan.runId, roles, objectiveDigest: plan.authorization?.inputDigest ?? plan.executionEnvelope?.runInputDigest, label: goal ? `SwarmGoal ${identifier}` : `Swarm ${identifier}`, ctx })) return { ok: true, status: "PUBLIC_WEB_RUN_CANCELLED", mutation: false };
              }
              return service.dispatch({
              ...request,
              ...(batch ? { batchSubcommand: "run" } : goal ? { goalSubcommand: "run" } : { subcommand: "run" }),
              yes: true,
              inputFile: null,
              runId: plan.runId ?? request.runId,
              input: plan.input,
              conditions: plan.executionEnvelope?.conditions,
              expectedPlanDigest: plan.plan?.planDigest ?? null,
              expectedExecutionDigest: plan.executionEnvelope?.executionEnvelopeDigest ?? null,
              expectedAuthorizationDigest: plan.authorization?.authorizationDigest ?? null,
              ...(goal ? { approveRevisionExpansion: async (_revision, _proposal, assessment) => typeof ctx?.ui?.confirm === "function" && ctx.ui.confirm("Approve expanded SwarmGoal revision?", JSON.stringify(assessment.expansions)) } : {}),
              });
            })();
        } else {
          result = await service.dispatch({ ...request, yes: false });
        }
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "ultra") {
        const subcommand = args[0] ?? "list";
        const strategyId = args[1] && !args[1].startsWith("--") ? args[1] : null;
        const inputFileIndex = args.indexOf("--input-file");
        const inputFile = inputFileIndex >= 0 ? args[inputFileIndex + 1] : null;
        const service = await getUltras();
        const request = { subcommand, strategyId, inputFile, ...(inputFile ? {} : { input: {} }) };
        let result;
        if (subcommand === "run" && args.includes("--yes")) {
          const plan = await service.dispatch({ ...request, subcommand: "plan", yes: false });
          result = plan?.ok === false ? plan : await (async () => {
            if (plan.plan?.route === "swarm-goal") {
              if (!await authorizeWeb({ runId: plan.request.id, roles: ["researcher", "source-verifier"], objectiveDigest: plan.request.taskDigest, label: `Ultra ${strategyId}`, ctx })) return { ok: true, status: "PUBLIC_WEB_RUN_CANCELLED", mutation: false };
            }
            return service.dispatch({
            ...request,
            subcommand: "run",
            yes: true,
            inputFile: null,
            input: plan.request,
            expectedPlanDigest: plan.plan?.planDigest ?? null,
            expectedAuthorizationDigest: plan.authorization?.authorizationDigest ?? null,
            });
          })();
        } else result = await service.dispatch({ ...request, yes: false });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "theme") {
        const subcommand = args[0] ?? "list";
        const themeId = args[1] && !args[1].startsWith("--") ? args[1] : null;
        const apply = ["use", "reset"].includes(subcommand) && args.includes("--apply") && args.includes("--yes");
        const driver = {
          getAllThemes: () => (typeof ctx?.ui?.getAllThemes === "function" ? ctx.ui.getAllThemes() : []),
          setTheme: (name) => (typeof ctx?.ui?.setTheme === "function" ? ctx.ui.setTheme(name) : undefined),
        };
        const result = await (await getThemes()).dispatch({ subcommand, themeId, apply, themeDriver: driver });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "overlays") {
        const subcommand = args[0] ?? "show";
        if (!["show", "apply"].includes(subcommand) || args.length > (subcommand === "show" ? 1 : 2)) {
          const result = { ok: false, status: "OVERLAY_COMMAND_INVALID", code: "INVALID_OVERLAY_COMMAND", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const service = await getDailyConfig();
        if (subcommand === "apply") {
          const id = args[1];
          if (!id) {
            const result = { ok: false, status: "OVERLAY_COMMAND_INVALID", code: "PRESET_ID_REQUIRED", mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
          const selected = await service.show(id);
          const result = selected.ok === false
            ? selected
            : selected.status !== "PRESET_SHOW"
              ? { ok: false, status: "PRESET_REQUIRED", code: "PRESET_REQUIRED", mutation: false, id }
              : {
                  ok: false,
                  status: "RESTART_REQUIRED",
                  code: "HARD_OVERLAY_RESTART_REQUIRED",
                  mutation: false,
                  presetId: id,
                  next: `run omp profiles apply ${id}, review the transaction, then start a new Pi session`,
                };
          notify(ctx, result, result.ok === false ? "warning" : "info");
          return result;
        }
        const resolved = await service.resolve({
          projectRoot: ctx?.cwd ?? null,
          projectTrusted: typeof ctx?.isProjectTrusted === "function" && ctx.isProjectTrusted(),
        });
        const result = {
          ok: true,
          status: "OVERLAY_STATUS",
          mutation: false,
          presetId: resolved.preset.id,
          base: resolved.base,
          overlays: resolved.overlays,
          hardOverlays: resolved.hardOverlays,
          softOverlays: resolved.softOverlays,
          source: resolved.source,
        };
        notify(ctx, result);
        return result;
      }
      if (command === "models") {
        const subcommand = args[0] ?? "show";
        if (!["show", "validate", "edit", "reset"].includes(subcommand) || args.length > 1) {
          const result = { ok: false, status: "MODEL_COMMAND_INVALID", code: "INVALID_MODEL_COMMAND", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const service = await getDailyConfig();
        if (subcommand === "edit") {
          if (ctx?.mode !== "tui" || typeof ctx?.ui?.editor !== "function" || typeof ctx?.isIdle !== "function" || !ctx.isIdle()) {
            const result = { ok: false, status: "MODEL_EDIT_UNAVAILABLE", code: "TUI_IDLE_REQUIRED", mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
          const current = await service.readGlobal();
          const edited = await ctx.ui.editor("only-my-pi model and budget preferences (JSON)", JSON.stringify(current, null, 2));
          if (edited === undefined) return { ok: true, status: "MODEL_EDIT_CANCELLED", mutation: false };
          let document;
          try { document = JSON.parse(edited); } catch {
            const result = { ok: false, status: "MODEL_CONFIGURATION_INVALID", code: "PREFERENCES_FILE_INVALID", mutation: false, message: "edited preferences are not valid JSON" };
            notify(ctx, result, "warning");
            return result;
          }
          const result = await service.save(document);
          notify(ctx, result);
          return result;
        }
        if (subcommand === "reset") {
          if (ctx?.mode !== "tui" || typeof ctx?.ui?.confirm !== "function") {
            const result = { ok: false, status: "MODEL_RESET_UNAVAILABLE", code: "TUI_CONFIRMATION_REQUIRED", mutation: false };
            notify(ctx, result, "warning");
            return result;
          }
          const approved = await ctx.ui.confirm("Reset only-my-pi preferences?", "This removes only only-my-pi/preferences.json; Pi auth and models are untouched.");
          if (!approved) return { ok: true, status: "MODEL_RESET_CANCELLED", mutation: false };
          const result = await service.reset();
          notify(ctx, result);
          return result;
        }
        const resolved = await service.resolve({
          projectRoot: ctx?.cwd ?? null,
          projectTrusted: typeof ctx?.isProjectTrusted === "function" && ctx.isProjectTrusted(),
        });
        if (subcommand === "show") {
          const result = { ok: true, status: "MODEL_CONFIGURATION_SHOW", mutation: false, models: resolved.models, budget: resolved.budget, source: resolved.source };
          notify(ctx, result);
          return result;
        }
        const module = await import("../../packages/daily-config/index.mjs");
        const result = await module.validateResolvedModels(resolved, { modelRegistry: ctx?.modelRegistry, currentModel: ctx?.model ?? null });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "context") {
        const snapshot = typeof snapshotProvider === "function" ? snapshotProvider() : null;
        const result = snapshot
          ? { ok: true, status: "CONTEXT", snapshot, text: formatSnapshot(snapshot) }
          : { ok: false, status: "CONTEXT_UNAVAILABLE", next: "wait for the first context event" };
        notify(ctx, result.text ?? result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "profile") {
        const subcommand = args[0] ?? "list";
        if (subcommand === "list") {
          const profilesRoot = path.join(derivedRoot, "profiles");
          let names = [];
          try {
            names = (await fs.readdir(profilesRoot)).filter((name) => name.endsWith(".json")).sort();
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          const profiles = [];
          for (const name of names) {
            const document = await readRootJson(derivedRoot, `profiles/${name}`);
            const summary = profileSummary(document);
            if (summary) profiles.push(summary);
          }
          const result = { ok: true, status: "PROFILE_LIST", mutation: false, profiles };
          notify(ctx, result);
          return result;
        }
        const profileId = args[1];
        if (!/^[a-z][a-z0-9-]{0,63}$/u.test(profileId ?? "")) {
          const result = { ok: false, status: "PROFILE_UNAVAILABLE", code: "INVALID_PROFILE_ID", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const document = await readRootJson(derivedRoot, `profiles/${profileId}.json`);
        if (!document) {
          const result = { ok: false, status: "PROFILE_NOT_FOUND", code: "UNKNOWN_PROFILE", mutation: false, profileId };
          notify(ctx, result, "warning");
          return result;
        }
        if (subcommand === "show") {
          const result = { ok: true, status: "PROFILE_SHOW", mutation: false, profile: document };
          notify(ctx, result);
          return result;
        }
        if (subcommand === "diff") {
          const otherId = args[2];
          const other = await readRootJson(derivedRoot, `profiles/${otherId}.json`);
          if (!other) return { ok: false, status: "PROFILE_NOT_FOUND", code: "UNKNOWN_PROFILE", mutation: false, profileId: otherId };
          const changes = [];
          if (JSON.stringify(document.packageIds ?? []) !== JSON.stringify(other.packageIds ?? [])) changes.push({ path: "packageIds" });
          if (JSON.stringify(document.capabilityIds ?? []) !== JSON.stringify(other.capabilityIds ?? [])) changes.push({ path: "capabilityIds" });
          if (JSON.stringify(document.policy ?? {}) !== JSON.stringify(other.policy ?? {})) changes.push({ path: "policy" });
          const result = { ok: true, status: "PROFILE_DIFF", mutation: false, from: profileId, to: otherId, changes };
          notify(ctx, result);
          return result;
        }
        return { ok: false, status: "PROFILE_UNAVAILABLE", code: "INVALID_PROFILE_COMMAND", mutation: false };
      }
      if (command === "tools") {
        const active = typeof ctx?.pi?.getActiveTools === "function" ? [...ctx.pi.getActiveTools()].sort() : [];
        const all = typeof ctx?.pi?.getAllTools === "function" ? ctx.pi.getAllTools().map((tool) => tool.name ?? tool.id).filter(Boolean).sort() : [];
        const result = { ok: true, status: "TOOLS", mutation: false, active, available: all, enforcement: { state: "unknown", reason: "Pi public API does not expose the complete cross-surface policy" } };
        notify(ctx, result);
        return result;
      }
      if (command === "packages") {
        const inventory = await readRootJson(derivedRoot, "inventory/packages.lock.json");
        if (!inventory) {
          const result = { ok: false, status: "PACKAGES_UNAVAILABLE", code: "PACKAGES_UNAVAILABLE", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const packages = [...(inventory.packages ?? []), ...(inventory.candidates ?? [])]
          .map((entry) => ({ id: entry.id, spec: entry.spec, mode: entry.mode ?? "promoted", installed: entry.installed === true, scope: entry.scope ?? null }))
          .sort((left, right) => left.id.localeCompare(right.id));
        const result = { ok: true, status: "PACKAGES", mutation: false, packages };
        notify(ctx, result);
        return result;
      }
      if (command === "safe") {
        const result = {
          ok: true,
          status: "SAFE_START_GUIDANCE",
          mutation: false,
          command: ["pi", "--offline", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--tools", "read,grep,find,ls"],
          note: "This is launch guidance; true isolation still requires an OS/container boundary.",
        };
        notify(ctx, result);
        return result;
      }
      if (command === "verify") {
        const manifest = await readRootJson(derivedRoot, "verification/release-gates-v1.json");
        const result = manifest
          ? { ok: true, status: "VERIFY_INSPECTOR", mutation: false, executable: false, manifest: manifest.id ?? null, gateIds: (manifest.gates ?? []).map((gate) => gate.id), gateCount: (manifest.gates ?? []).length }
          : { ok: false, status: "VERIFY_UNAVAILABLE", code: "VERIFY_MANIFEST_UNAVAILABLE", mutation: false };
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "status") {
        const currentMode = typeof sessionDriver?.readMode === "function" ? await sessionDriver.readMode() : null;
        const base = {
          ok: true,
          status: "STATUS",
          mode: currentMode ? { modeId: currentMode.modeId ?? null, hash: currentMode.hash ?? null, sourceHash: currentMode.sourceHash ?? null } : null,
          modeRestoreStatus: typeof getModeRestoreStatus === "function" ? getModeRestoreStatus() : null,
          profile: null,
          executionState: "unknown",
          enforcement: "unknown",
          activeTools: typeof ctx?.pi?.getActiveTools === "function" ? [...ctx.pi.getActiveTools()].sort() : [],
          restartRequired: false,
        };
        const harnessStatus = await (await getStatuses()).snapshot({
          headless: ctx?.mode !== "tui",
          mode: currentMode,
          profile: profile ?? null,
          model: ctx?.model ?? null,
          context: typeof snapshotProvider === "function" ? snapshotProvider() : null,
          permission: { mode: typeof ctx?.pi?.getFlag === "function" ? ctx.pi.getFlag("perm") : null, state: "unknown" },
          theme: { id: ctx?.ui?.theme?.name ?? null },
          swarm: null,
        });
        const result = { ...base, harnessStatus };
        notify(ctx, result);
        return result;
      }
      if (command === "doctor") {
        const result = await (await getModes()).dispatch({ subcommand: "doctor", configRoot });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      const unavailable = {
        ok: false,
        status: "UNAVAILABLE",
        code: "MILESTONE_NOT_IMPLEMENTED",
        command,
        next: "use the corresponding omp CLI plan or wait for its owning milestone",
      };
      notify(ctx, unavailable, "warning");
      return unavailable;
    },
  };
}

/** @param {any} options */
export function createContextSnapshotProvider({ messages = [], pi, ctx, systemPromptCharacters, turnIndex, getState } = {}) {
  return () => buildContextSnapshot({
    messages: typeof getState === "function" ? (getState().messages ?? []) : messages,
    tools: typeof pi?.getAllTools === "function" ? pi.getAllTools() : [],
    activeTools: typeof pi?.getActiveTools === "function" ? pi.getActiveTools() : [],
    usage: typeof (typeof getState === "function" ? getState().ctx : ctx)?.getContextUsage === "function"
      ? (typeof getState === "function" ? getState().ctx : ctx).getContextUsage()
      : null,
    systemPromptCharacters: typeof getState === "function" ? getState().systemPromptCharacters : systemPromptCharacters,
    turnIndex: typeof getState === "function" ? getState().turnIndex : turnIndex,
  });
}

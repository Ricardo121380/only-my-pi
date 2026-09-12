import path from "node:path";

import {
  readLastInteractiveModel,
  saveLastInteractiveModel,
} from "../../packages/daily-config/index.mjs";
import {
  captureWorkspaceBaseline,
  createWorkspacePolicy,
} from "../../packages/direct-agent/workspace.mjs";
import { DIRECT_READ_ONLY_AGENTS } from "../../packages/direct-agent/orchestration.mjs";

export { DIRECT_READ_ONLY_AGENTS };

export const DIRECT_SESSION_STATES = Object.freeze({
  INSPECT: "INSPECT",
  PLANNING: "PLANNING",
  AWAITING_CODING_ACCESS: "AWAITING_CODING_ACCESS",
  CODING: "CODING",
});

export const INSPECTION_TOOL_NAMES = Object.freeze([
  "read",
  "grep",
  "find",
  "ls",
  "request_coding_access",
  "delegate_readonly_agent",
]);

export const CODING_TOOL_NAMES = Object.freeze([
  ...INSPECTION_TOOL_NAMES,
  "edit",
  "write",
  "bash",
  "delegate_managed_writer",
]);

export const MUTATION_TOOL_NAMES = Object.freeze(new Set(["edit", "write", "bash", "powershell"]));
export const CODING_AUTHORITY_TOOL_NAMES = Object.freeze(new Set(["delegate_managed_writer"]));

const RISK_FLAGS = new Set([
  "public-api",
  "dependency",
  "schema",
  "security",
  "concurrency",
  "migration",
  "deletion",
  "release",
]);
const ACCESS_OPTIONS = Object.freeze([
  "Approve plan and allow coding for this session",
  "Revise plan",
  "Deny",
]);
const MODEL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;
const PROJECT_LOCAL_SCOPE = Object.freeze(["**"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function text(value, label, maximum) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum || /[\0\r]/u.test(value)) {
    fail("CODING_ACCESS_REQUEST_INVALID", `${label} must be non-empty and at most ${maximum} characters`);
  }
  return value.trim();
}

function boundedStrings(value, label, { maximumItems, maximumLength, allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.length > maximumItems || (!allowEmpty && value.length === 0)) {
    fail("CODING_ACCESS_REQUEST_INVALID", `${label} must be a bounded array`);
  }
  return value.map((entry, index) => text(entry, `${label}[${index}]`, maximumLength));
}

function normalizeScope(value) {
  return boundedStrings(value, "scope", { maximumItems: 64, maximumLength: 512, allowEmpty: false }).map((entry) => {
    if (path.posix.isAbsolute(entry)
      || path.win32.isAbsolute(entry)
      || entry.includes("\\")
      || /(?:^|\/)\.\.(?:\/|$)/u.test(entry)) {
      fail("CODING_ACCESS_SCOPE_INVALID", `scope entry is not project-relative: ${entry}`);
    }
    return entry;
  });
}

function exactBooleanObject(value, label, keys) {
  if (value === undefined) return Object.fromEntries(keys.map((key) => [key, false]));
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("CODING_ACCESS_REQUEST_INVALID", `${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0 || keys.some((key) => typeof value[key] !== "boolean")) {
    fail("CODING_ACCESS_REQUEST_INVALID", `${label} must contain only boolean orchestration fields`);
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

export function normalizeCodingAccessRequest(input, { explicitPlan = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("CODING_ACCESS_REQUEST_INVALID", "coding access request must be an object");
  const allowedKeys = new Set(["taskSummary", "complexity", "scope", "riskFlags", "plan", "verification", "orchestration"]);
  const unknown = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) fail("CODING_ACCESS_REQUEST_INVALID", "coding access request contains unknown fields");
  if (!new Set(["simple", "complex"]).has(input.complexity)) fail("CODING_ACCESS_REQUEST_INVALID", "complexity must be simple or complex");
  const riskFlags = boundedStrings(input.riskFlags ?? [], "riskFlags", { maximumItems: RISK_FLAGS.size, maximumLength: 32 });
  if (new Set(riskFlags).size !== riskFlags.length || riskFlags.some((flag) => !RISK_FLAGS.has(flag))) {
    fail("CODING_ACCESS_REQUEST_INVALID", "riskFlags must be unique supported values");
  }
  if (input.complexity === "simple" && (riskFlags.length > 0 || explicitPlan)) {
    fail("COMPLEX_PLAN_REQUIRED", "explicit planning and high-risk changes require complexity=complex");
  }
  const planText = input.plan === undefined ? "" : text(input.plan, "plan", 16_384);
  if (input.complexity === "complex" && planText.length === 0) fail("COMPLEX_PLAN_REQUIRED", "complex coding access requires a complete plan");
  const orchestration = exactBooleanObject(input.orchestration, "orchestration", [
    "useReadOnlyScouts",
    "useManagedCloneWriter",
    "useFreshReviewer",
  ]);
  if (orchestration.useManagedCloneWriter && (input.complexity !== "complex" || !orchestration.useFreshReviewer)) {
    fail("MANAGED_WRITER_PLAN_REQUIRED", "managed-clone writing requires a complex plan and a fresh reviewer");
  }
  return Object.freeze({
    taskSummary: text(input.taskSummary, "taskSummary", 2_000),
    complexity: input.complexity,
    scope: Object.freeze(normalizeScope(input.scope)),
    riskFlags: Object.freeze(riskFlags),
    plan: planText,
    verification: Object.freeze(boundedStrings(input.verification ?? [], "verification", { maximumItems: 16, maximumLength: 500 })),
    orchestration: Object.freeze(orchestration),
  });
}

function modelReference(model) {
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string") return null;
  const reference = `${model.provider}/${model.id}`;
  return MODEL_REFERENCE.test(reference) ? reference : null;
}

export function orderSelectableModels({ scopedModels = [], availableModels = [], currentModel = null, lastModel = null } = {}) {
  const source = scopedModels.length > 0
    ? scopedModels.map((entry) => ({ model: entry.model, thinkingLevel: entry.thinkingLevel }))
    : availableModels.map((model) => ({ model, thinkingLevel: undefined }));
  const deduplicated = new Map();
  for (const entry of source) {
    const reference = modelReference(entry.model);
    if (reference && !deduplicated.has(reference)) deduplicated.set(reference, { ...entry, reference });
  }
  const currentReference = modelReference(currentModel);
  return [...deduplicated.values()].sort((left, right) => {
    const leftRank = left.reference === currentReference ? 0 : left.reference === lastModel ? 1 : 2;
    const rightRank = right.reference === currentReference ? 0 : right.reference === lastModel ? 1 : 2;
    return leftRank - rightRank || left.reference.localeCompare(right.reference);
  });
}

function accessSummary(request, cwd) {
  const risks = request.riskFlags.length > 0 ? request.riskFlags.join(", ") : "none";
  const verification = request.verification.length > 0 ? request.verification.join("; ") : "not specified";
  const orchestration = Object.entries(request.orchestration).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "main Agent only";
  const plan = request.complexity === "complex" ? `\n\nPlan:\n${request.plan}` : "";
  return [
    "Allow project-local coding for this OMP process?",
    `Project: ${cwd}`,
    `Task: ${request.taskSummary}`,
    `Complexity: ${request.complexity}`,
    `Scope: ${request.scope.join(", ")}`,
    `Risks: ${risks}`,
    `Verification: ${verification}`,
    `Orchestration: ${orchestration}`,
    plan,
  ].filter(Boolean).join("\n").slice(0, 24_000);
}

function toolResult(status, message, details = {}) {
  const metadata = { ...details, formatVersion: 1, status };
  const content = [{ type: "text", text: `${status}: ${message}` }];
  // Pi forwards content to the model; details are UI/session metadata only.
  if (Object.keys(details).length > 0) content.push({ type: "text", text: JSON.stringify(metadata) });
  return {
    content,
    details: metadata,
  };
}

export class DirectSessionController {
  constructor({ pi, configRoot, environment = process.env, now = () => new Date().toISOString(), captureBaseline = captureWorkspaceBaseline } = {}) {
    if (!pi || typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") throw new TypeError("DirectSessionController requires Pi tool controls");
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("DirectSessionController requires an absolute configRoot");
    this.pi = pi;
    this.configRoot = path.resolve(configRoot);
    this.environment = environment;
    this.now = now;
    this.state = DIRECT_SESSION_STATES.INSPECT;
    this.explicitPlan = false;
    this.context = null;
    this.headless = environment.ONLY_MY_PI_HEADLESS === "1";
    this.explicitModel = environment.ONLY_MY_PI_MODEL_EXPLICIT === "1";
    this.captureBaseline = captureBaseline;
    this.workspaceBaseline = null;
    this.workspacePolicy = createWorkspacePolicy();
    this.approvedScope = [];
    this.approvedRequest = null;
    this.orchestrator = null;
    this.unsafePermissionNotified = false;
  }

  isDirect() { return this.environment.ONLY_MY_PI_DIRECT === "1"; }
  hasCodingAccess() { return this.state === DIRECT_SESSION_STATES.CODING && !this.headless; }

  attachOrchestrator(orchestrator) {
    this.orchestrator = orchestrator && typeof orchestrator.delegateReadOnly === "function" ? orchestrator : null;
    return this.orchestrator !== null;
  }

  activeToolCeiling() {
    return this.hasCodingAccess() ? CODING_TOOL_NAMES : INSPECTION_TOOL_NAMES;
  }

  applyToolCeiling() {
    const configured = new Set(this.pi.getAllTools().map((tool) => tool.name));
    const active = this.activeToolCeiling().filter((name) => configured.has(name));
    if (this.headless) {
      const index = active.indexOf("request_coding_access");
      if (index !== -1) active.splice(index, 1);
    }
    this.pi.setActiveTools(active);
    return active;
  }

  currentPermissionMode(ctx = this.context) {
    let restored = null;
    try {
      const entries = ctx?.sessionManager?.getEntries?.() ?? [];
      for (const entry of entries) {
        if (entry?.type === "custom"
          && entry.customType === "perm-mode"
          && typeof entry.data?.mode === "string") restored = entry.data.mode.toLowerCase();
      }
    } catch {
      // pi-permission-modes also publishes the live mode through the process
      // environment, so an unreadable historical entry cannot widen OMP.
    }
    const live = typeof this.environment.PI_PERMISSION_MODE === "string"
      ? this.environment.PI_PERMISSION_MODE.toLowerCase()
      : null;
    return live ?? restored ?? "unknown";
  }

  enforcePermissionBoundary(ctx = this.context) {
    const mode = this.currentPermissionMode(ctx);
    if (mode !== "yolo") {
      this.unsafePermissionNotified = false;
      return { ok: true, mode };
    }
    this.explicitPlan = false;
    this.approvedRequest = null;
    this.approvedScope = [];
    this.state = DIRECT_SESSION_STATES.INSPECT;
    this.applyToolCeiling();
    this.updateUi(ctx);
    if (!this.unsafePermissionNotified && ctx?.mode === "tui") {
      ctx.ui.notify(
        "UNSUPPORTED_UNSAFE_OVERRIDE: /perm yolo cannot widen an OMP direct session. Coding access was revoked; use /perm build and request coding access again, or use raw pi for an explicitly unguarded session.",
        "warning",
      );
      this.unsafePermissionNotified = true;
    }
    return { ok: false, mode, code: "UNSUPPORTED_UNSAFE_OVERRIDE" };
  }

  updateUi(ctx = this.context) {
    if (!ctx || ctx.mode !== "tui") return;
    const display = {
      INSPECT: "Inspect",
      PLANNING: "Planning",
      AWAITING_CODING_ACCESS: "Awaiting approval",
      CODING: "Coding",
    }[this.state];
    const preview = this.environment.ONLY_MY_PI_DISTRIBUTION_VERSION;
    ctx.ui.setStatus("omp-direct", `OMP${preview ? ` ${preview} (Preview)` : ""} · ${display}`);
    ctx.ui.setWidget("omp-direct-help", ["Enter send · Esc cancel · Ctrl+D exit · /help help"], { placement: "belowEditor" });
    ctx.ui.setTitle(`only-my-pi · ${display}`);
  }

  transition(next, ctx = this.context) {
    this.state = next;
    this.applyToolCeiling();
    this.updateUi(ctx);
  }

  async availableModels(ctx) {
    const available = ctx.scopedModels.length > 0 ? [] : await Promise.resolve(ctx.modelRegistry.getAvailable());
    const last = await readLastInteractiveModel({ configRoot: this.configRoot });
    return {
      last,
      candidates: orderSelectableModels({
        scopedModels: [...ctx.scopedModels],
        availableModels: [...available],
        currentModel: ctx.model,
        lastModel: last?.model ?? null,
      }),
    };
  }

  async selectStartupModel(ctx) {
    const { last, candidates } = await this.availableModels(ctx);
    if (this.explicitModel) {
      if (!ctx.model) return { ok: false, status: "EXPLICIT_MODEL_UNAVAILABLE", message: "The explicitly selected model is unavailable." };
      if (!this.headless) await this.rememberModel(ctx.model);
      return { ok: true, status: "EXPLICIT_MODEL_SELECTED", model: modelReference(ctx.model) };
    }
    if (candidates.length === 0) return { ok: false, status: "NO_AUTHENTICATED_MODELS", message: "No authenticated model is available. Configure a Provider before starting OMP." };
    let selected;
    if (this.headless) {
      if (!last) return { ok: false, status: "HEADLESS_MODEL_REQUIRED", message: "No recent interactive model is recorded; pass --model provider/model." };
      selected = candidates.find((entry) => entry.reference === last.model);
      if (!selected) return { ok: false, status: "RECENT_MODEL_UNAVAILABLE", message: `The recent model ${last.model} is no longer available; pass --model provider/model.` };
    } else {
      const labels = candidates.map((entry) => `${entry.reference}${entry.model.reasoning ? " · thinking" : ""}`);
      const choice = await ctx.ui.select("Select an authenticated model (recent first)", labels);
      if (choice === undefined) return { ok: false, status: "MODEL_SELECTION_CANCELLED", message: "Model selection was cancelled." };
      selected = candidates[labels.indexOf(choice)];
    }
    const accepted = await this.pi.setModel(selected.model);
    if (!accepted) return { ok: false, status: "MODEL_AUTH_UNAVAILABLE", message: `Authentication is unavailable for ${selected.reference}.` };
    if (selected.thinkingLevel !== undefined) this.pi.setThinkingLevel(selected.thinkingLevel);
    if (!this.headless) await this.rememberModel(selected.model);
    return { ok: true, status: "MODEL_SELECTED", model: selected.reference };
  }

  async rememberModel(model) {
    const reference = modelReference(model);
    if (!reference || this.headless) return null;
    return saveLastInteractiveModel({ configRoot: this.configRoot, model: reference, selectedAt: this.now() });
  }

  async start(_event, ctx) {
    this.context = ctx;
    this.state = DIRECT_SESSION_STATES.INSPECT;
    this.explicitPlan = false;
    this.approvedRequest = null;
    this.approvedScope = [];
    this.applyToolCeiling();
    this.updateUi(ctx);
    this.enforcePermissionBoundary(ctx);
    try {
      if (typeof this.pi.exec === "function") {
        this.workspaceBaseline = await this.captureBaseline({
          cwd: ctx.cwd,
          runGit: async (cwd, args) => {
            const result = await this.pi.exec("git", args, { cwd });
            return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0 };
          },
        });
        this.workspacePolicy = createWorkspacePolicy({ baseline: this.workspaceBaseline });
      }
    } catch (error) {
      this.workspaceBaseline = { formatVersion: 1, status: "BASELINE_UNAVAILABLE", code: error?.code ?? "WORKSPACE_BASELINE_FAILED" };
      if (ctx.mode === "tui") ctx.ui.notify(`Workspace baseline unavailable: ${this.workspaceBaseline.code}. Coding access will remain bounded.`, "warning");
    }
    let selection;
    try {
      selection = await this.selectStartupModel(ctx);
    } catch (error) {
      selection = { ok: false, status: error?.code ?? "MODEL_SELECTION_FAILED", message: error instanceof Error ? error.message : String(error) };
    }
    if (!selection.ok) {
      const message = `${selection.status}: ${selection.message}`;
      if (ctx.mode === "tui") ctx.ui.notify(message, selection.status === "MODEL_SELECTION_CANCELLED" ? "info" : "error");
      else process.stderr.write(`${message}\n`);
      ctx.shutdown();
    }
    return selection;
  }

  shutdown(ctx = this.context) {
    if (ctx?.mode === "tui") {
      ctx.ui.setStatus("omp-direct", undefined);
      ctx.ui.setWidget("omp-direct-help", undefined);
    }
    this.state = DIRECT_SESSION_STATES.INSPECT;
    this.explicitPlan = false;
    this.approvedRequest = null;
    this.approvedScope = [];
    this.orchestrator = null;
    this.unsafePermissionNotified = false;
    this.context = null;
  }

  enterPlanning(args, ctx) {
    this.explicitPlan = true;
    this.transition(DIRECT_SESSION_STATES.PLANNING, ctx);
    const task = typeof args === "string" ? args.trim() : "";
    if (task) {
      this.pi.sendUserMessage(`Plan this task without modifying the project. Produce a complete implementation and verification plan, then call request_coding_access with complexity=complex:\n\n${task}`);
    } else {
      ctx.ui.notify("OMP Planning enabled. Describe the task; coding remains disabled until you approve a complete plan.", "info");
    }
  }

  accessCommand(args, ctx) {
    this.enforcePermissionBoundary(ctx);
    const command = typeof args === "string" ? args.trim() : "";
    if (command === "revoke") {
      this.explicitPlan = false;
      this.approvedRequest = null;
      this.approvedScope = [];
      this.transition(DIRECT_SESSION_STATES.INSPECT, ctx);
      ctx.ui.notify("Coding access revoked for this session.", "info");
      return;
    }
    if (command.length > 0) {
      ctx.ui.notify("Usage: /access or /access revoke", "warning");
      return;
    }
    ctx.ui.notify(`OMP access: ${this.state}. Project-local coding is ${this.hasCodingAccess() ? "enabled" : "disabled"}. Physical permission mode: ${this.currentPermissionMode(ctx)}.`, "info");
  }

  async requestCodingAccess(input, ctx) {
    if (this.headless || ctx.mode !== "tui" || !ctx.hasUI) {
      return toolResult("CODING_ACCESS_UI_REQUIRED", "Headless and non-interactive OMP sessions cannot obtain write access.");
    }
    const permission = this.enforcePermissionBoundary(ctx);
    if (!permission.ok) {
      return toolResult(permission.code, "Permission mode YOLO is incompatible with guarded OMP coding. Switch to /perm build, then request access again.");
    }
    if (this.hasCodingAccess()) return toolResult("CODING_ACCESS_ALREADY_GRANTED", "Project-local coding is already enabled for this process.");
    let request;
    try {
      request = normalizeCodingAccessRequest(input, { explicitPlan: this.explicitPlan });
    } catch (error) {
      return toolResult(error?.code ?? "CODING_ACCESS_REQUEST_INVALID", error instanceof Error ? error.message : String(error));
    }
    this.transition(DIRECT_SESSION_STATES.AWAITING_CODING_ACCESS, ctx);
    const choice = await ctx.ui.select(accessSummary(request, ctx.cwd), [...ACCESS_OPTIONS]);
    if (choice === ACCESS_OPTIONS[0]) {
      const afterApproval = this.enforcePermissionBoundary(ctx);
      if (!afterApproval.ok) {
        return toolResult(afterApproval.code, "Permission mode changed to YOLO while approval was pending; coding access was not granted.");
      }
      this.explicitPlan = false;
      this.approvedRequest = request;
      this.approvedScope = [...request.scope];
      // The request scope describes the current task and stays a hard boundary
      // for an isolated managed writer. The human approval itself is
      // process-local and project-wide so later ordinary local tasks do not
      // produce another approval prompt. Project containment, protected paths,
      // destructive Git checks, and the physical sandbox still apply.
      this.workspacePolicy = createWorkspacePolicy({ baseline: this.workspaceBaseline, scope: PROJECT_LOCAL_SCOPE });
      this.transition(DIRECT_SESSION_STATES.CODING, ctx);
      return toolResult("CODING_ACCESS_GRANTED", "Project-local edit, write, and sandboxed bash tools are enabled for this OMP process.", {
        scope: request.scope,
        complexity: request.complexity,
        riskFlags: request.riskFlags,
      });
    }
    if (choice === ACCESS_OPTIONS[1]) {
      this.transition(DIRECT_SESSION_STATES.PLANNING, ctx);
      ctx.ui.notify("Revise the plan in your next message. Coding access remains disabled.", "info");
      return toolResult("CODING_ACCESS_REVISION_REQUESTED", "The user requested a revised plan; do not modify the project.");
    }
    this.explicitPlan = false;
    this.approvedRequest = null;
    this.approvedScope = [];
    this.transition(DIRECT_SESSION_STATES.INSPECT, ctx);
    return toolResult("CODING_ACCESS_DENIED", "The user denied coding access; continue read-only or stop.");
  }

  beforeAgentStart(event) {
    const permission = this.enforcePermissionBoundary(this.context);
    // pi-permission-modes may recompute visibility for the same turn. OMP is
    // loaded last and reapplies its coarser session ceiling after that handler.
    this.applyToolCeiling();
    const state = this.state;
    const coding = this.hasCodingAccess();
    return {
      systemPrompt: `${event.systemPrompt}\n\n## only-my-pi Direct Coding Agent\nCurrent OMP state: ${state}. Physical permission mode: ${permission.mode}.\n- Inspect the project before proposing changes.\n- Before edit, write, bash, project gates, or a writer child, call request_coding_access as the only tool in that tool batch.\n- Classify a task as complex when it changes public APIs, dependencies, schemas, security, concurrency, migrations, deletion, releases, or multiple coordinated modules.\n- Complex and explicit /plan tasks require a complete plan before requesting access.\n- A coding grant is process-local and project-local; it never authorizes project-external paths, secrets, MCP, unrestricted network, destructive Git, publishing, deployment, or silent commits.\n- Preserve pre-existing working-tree changes and re-read files immediately before editing.\n- Use delegate_readonly_agent only for bounded independent exploration or fresh review; at most two children may run concurrently and no child may delegate again.\n- Use delegate_managed_writer only when the approved complex plan explicitly enables it. OMP permits one writer in an ordinary managed Git clone, captures its patch, requires a fresh read-only review, and applies only a conflict-free in-scope patch.\n- Keep simple tasks with the main Agent. After a managed patch is applied, run the approved verification again in the real current worktree.\n${permission.ok ? "" : "- YOLO was detected and OMP revoked coding access. Ask the user to switch to /perm build; do not attempt mutation.\n"}${coding ? "- Coding access is active for this process; ordinary project-local edits do not need another request. The approved task scope remains a hard boundary only for a managed-clone writer." : "- Coding access is not active. Remain read-only until request_coding_access returns CODING_ACCESS_GRANTED."}`,
    };
  }

  async delegateReadOnly(input, _ctx, signal) {
    if (!this.orchestrator) return toolResult("DIRECT_ORCHESTRATION_UNAVAILABLE", "The shared pi-subagents runtime is unavailable; continue with the main Agent.");
    if (!input || typeof input !== "object" || !DIRECT_READ_ONLY_AGENTS.includes(input.agent)) {
      return toolResult("DIRECT_AGENT_NOT_ALLOWED", "Select one registered read-only OMP role.");
    }
    try {
      const result = await this.orchestrator.delegateReadOnly({
        agent: input.agent,
        task: text(input.task, "task", 32_768),
        label: input.label === undefined ? undefined : text(input.label, "label", 128),
        signal,
      });
      return toolResult("DIRECT_CHILD_COMPLETED", "The read-only child completed.", result);
    } catch (error) {
      return toolResult(error?.code ?? "DIRECT_CHILD_FAILED", error instanceof Error ? error.message : String(error));
    }
  }

  async delegateManagedWriter(input, _ctx, signal) {
    if (!this.hasCodingAccess()) return toolResult("CODING_ACCESS_REQUIRED", "Managed writing requires the current process coding grant.");
    if (!this.orchestrator) return toolResult("DIRECT_ORCHESTRATION_UNAVAILABLE", "The shared pi-subagents runtime is unavailable; implement with the main Agent.");
    if (!this.approvedRequest?.orchestration?.useManagedCloneWriter) {
      return toolResult("MANAGED_WRITER_NOT_APPROVED", "The approved coding plan did not authorize a managed-clone writer.");
    }
    try {
      const scope = input?.scope === undefined ? this.approvedScope : normalizeScope(input.scope);
      const result = await this.orchestrator.delegateWriter({
        task: this.approvedRequest.taskSummary,
        plan: this.approvedRequest.plan,
        scope,
        verification: this.approvedRequest.verification,
        baseline: this.workspaceBaseline,
        approvedScope: this.approvedScope,
        signal,
      });
      return toolResult(
        result.status,
        result.status === "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION"
          ? "The reviewed patch was applied; verify it in the real worktree before reporting completion."
          : "The managed writer did not modify the real worktree.",
        result,
      );
    } catch (error) {
      return toolResult(error?.code ?? "DIRECT_WRITER_FAILED", error instanceof Error ? error.message : String(error));
    }
  }

  agentsCommand(ctx = this.context) {
    const snapshot = this.orchestrator?.snapshot?.();
    if (!snapshot) {
      ctx?.ui?.notify?.("Automatic child runtime is unavailable; the main Agent remains usable.", "warning");
      return;
    }
    const lines = [
      `Runtime owner: ${snapshot.physicalRuntimeOwner}`,
      `Children: ${snapshot.totalChildren}/${snapshot.maximumChildren}; concurrency ${snapshot.maximumConcurrency}`,
      `Writer used: ${snapshot.writerUsed ? "yes" : "no"}`,
      ...(snapshot.budget ? [
        `Child budget: ${snapshot.budget.status === "AVAILABLE" ? "available" : "stopped"}; main Agent usage is separate.`,
        `Reported tokens: ${snapshot.budget.used.tokens}/${snapshot.budget.limits.maxTotalTokens}; reported cost: $${snapshot.budget.used.costUsd.toFixed(6)}/$${snapshot.budget.limits.maxCostUsd}`,
        `Child tool calls: ${snapshot.budget.used.toolCalls}/${snapshot.budget.limits.maxTotalToolCalls}; returned result bytes: ${snapshot.budget.used.resultBytes}/${snapshot.budget.limits.maxTotalOutputBytes}`,
      ] : []),
      ...snapshot.children.map((entry) => `${entry.label}: ${entry.status}`),
    ];
    ctx?.ui?.notify?.(lines.join("\n"), "info");
  }

  blockToolCall(event) {
    this.enforcePermissionBoundary(this.context);
    if (CODING_AUTHORITY_TOOL_NAMES.has(event.toolName) && !this.hasCodingAccess()) {
      return { block: true, reason: "OMP_CODING_ACCESS_REQUIRED: managed writing is disabled until request_coding_access is approved." };
    }
    if (MUTATION_TOOL_NAMES.has(event.toolName) && !this.hasCodingAccess()) {
      return { block: true, reason: "OMP_CODING_ACCESS_REQUIRED: project mutation is disabled until this interactive process approves request_coding_access." };
    }
    if (MUTATION_TOOL_NAMES.has(event.toolName) && this.hasCodingAccess()) {
      let violation = null;
      if (event.toolName === "edit" || event.toolName === "write") {
        violation = this.workspacePolicy.inspectPath(event.input?.path, { cwd: this.context?.cwd });
      } else if (event.toolName === "bash") {
        violation = this.workspacePolicy.inspectCommand(event.input?.command);
      } else {
        violation = { code: "UNSUPPORTED_MUTATION_TOOL", reason: `${event.toolName} is not an OMP coding tool` };
      }
      if (violation) return { block: true, reason: `${violation.code}: ${violation.reason}` };
    }
    return undefined;
  }

  blockUserBash(event) {
    if (this.hasCodingAccess()) return undefined;
    return {
      result: {
        output: "OMP_CODING_ACCESS_REQUIRED: shell execution is disabled until coding access is approved.",
        exitCode: 126,
        cancelled: false,
        truncated: false,
      },
    };
  }

  inspectUserBash(event) {
    this.enforcePermissionBoundary(this.context);
    if (!this.hasCodingAccess()) return this.blockUserBash(event);
    const violation = this.workspacePolicy.inspectCommand(event?.command);
    if (!violation) return undefined;
    return {
      result: {
        output: `${violation.code}: ${violation.reason}`,
        exitCode: 126,
        cancelled: false,
        truncated: false,
      },
    };
  }
}

export function createDirectSessionController(options = {}) {
  return new DirectSessionController(options);
}

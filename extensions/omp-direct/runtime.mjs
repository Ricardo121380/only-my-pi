import path from "node:path";

import {
  readLastInteractiveModel,
  saveLastInteractiveModel,
} from "../../packages/daily-config/index.mjs";
import {
  captureWorkspaceBaseline,
  createWorkspacePolicy,
} from "../../packages/direct-agent/workspace.mjs";

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
]);

export const CODING_TOOL_NAMES = Object.freeze([
  ...INSPECTION_TOOL_NAMES,
  "edit",
  "write",
  "bash",
]);

export const MUTATION_TOOL_NAMES = Object.freeze(new Set(["edit", "write", "bash", "powershell"]));

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
  return Object.freeze({
    taskSummary: text(input.taskSummary, "taskSummary", 2_000),
    complexity: input.complexity,
    scope: Object.freeze(normalizeScope(input.scope)),
    riskFlags: Object.freeze(riskFlags),
    plan: planText,
    verification: Object.freeze(boundedStrings(input.verification ?? [], "verification", { maximumItems: 16, maximumLength: 500 })),
    orchestration: Object.freeze(exactBooleanObject(input.orchestration, "orchestration", [
      "useReadOnlyScouts",
      "useManagedCloneWriter",
      "useFreshReviewer",
    ])),
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
  return {
    content: [{ type: "text", text: `${status}: ${message}` }],
    details: { formatVersion: 1, status, ...details },
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
  }

  isDirect() { return this.environment.ONLY_MY_PI_DIRECT === "1"; }
  hasCodingAccess() { return this.state === DIRECT_SESSION_STATES.CODING && !this.headless; }

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

  updateUi(ctx = this.context) {
    if (!ctx || ctx.mode !== "tui") return;
    const display = {
      INSPECT: "Inspect",
      PLANNING: "Planning",
      AWAITING_CODING_ACCESS: "Awaiting approval",
      CODING: "Coding",
    }[this.state];
    ctx.ui.setStatus("omp-direct", `OMP · ${display}`);
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
    this.applyToolCeiling();
    this.updateUi(ctx);
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
    const command = typeof args === "string" ? args.trim() : "";
    if (command === "revoke") {
      this.explicitPlan = false;
      this.transition(DIRECT_SESSION_STATES.INSPECT, ctx);
      ctx.ui.notify("Coding access revoked for this session.", "info");
      return;
    }
    if (command.length > 0) {
      ctx.ui.notify("Usage: /access or /access revoke", "warning");
      return;
    }
    ctx.ui.notify(`OMP access: ${this.state}. Project-local coding is ${this.hasCodingAccess() ? "enabled" : "disabled"}.`, "info");
  }

  async requestCodingAccess(input, ctx) {
    if (this.headless || ctx.mode !== "tui" || !ctx.hasUI) {
      return toolResult("CODING_ACCESS_UI_REQUIRED", "Headless and non-interactive OMP sessions cannot obtain write access.");
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
      this.explicitPlan = false;
      this.approvedScope = [...request.scope];
      this.workspacePolicy = createWorkspacePolicy({ baseline: this.workspaceBaseline, scope: this.approvedScope });
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
    this.transition(DIRECT_SESSION_STATES.INSPECT, ctx);
    return toolResult("CODING_ACCESS_DENIED", "The user denied coding access; continue read-only or stop.");
  }

  beforeAgentStart(event) {
    const state = this.state;
    const coding = this.hasCodingAccess();
    return {
      systemPrompt: `${event.systemPrompt}\n\n## only-my-pi Direct Coding Agent\nCurrent OMP state: ${state}.\n- Inspect the project before proposing changes.\n- Before edit, write, bash, project gates, or a writer child, call request_coding_access as the only tool in that tool batch.\n- Classify a task as complex when it changes public APIs, dependencies, schemas, security, concurrency, migrations, deletion, releases, or multiple coordinated modules.\n- Complex and explicit /plan tasks require a complete plan before requesting access.\n- A coding grant is process-local and project-local; it never authorizes project-external paths, secrets, MCP, unrestricted network, destructive Git, publishing, deployment, or silent commits.\n- Preserve pre-existing working-tree changes and re-read files immediately before editing.\n${coding ? "- Coding access is active for this process; ordinary in-scope edits do not need another request." : "- Coding access is not active. Remain read-only until request_coding_access returns CODING_ACCESS_GRANTED."}`,
    };
  }

  blockToolCall(event) {
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

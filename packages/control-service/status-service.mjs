const HASH = /^sha256:[a-f0-9]{64}$/u;
const GIT_HASH = /^[a-f0-9]{7,64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const RUN_STATES = new Set(["planned", "admitted", "running", "stopping", "completed", "failed", "cancelled", "timed_out", "budget_exhausted", "interrupted"]);

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value, maximum = 128) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\0\r\n\t]/gu, " ").trim().slice(0, maximum);
  return normalized || null;
}
function id(value) { const candidate = text(value); return candidate && ID.test(candidate) ? candidate : null; }
function integer(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function percent(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 100) / 100 : null; }
function hash(value) { return typeof value === "string" && HASH.test(value) ? value : null; }

function mode(value) {
  if (!object(value)) return null;
  return {
    id: id(value.modeId ?? value.id),
    hash: hash(value.hash),
    sourceHash: hash(value.sourceHash),
    executionState: id(value.executionState),
    restoreStatus: id(value.restoreStatus),
    restartRequired: value.restartRequired === true,
  };
}
function profile(value) {
  if (typeof value === "string") return { id: id(value), capabilityCount: null, packageCount: null };
  if (!object(value)) return null;
  return {
    id: id(value.id ?? value.profileId),
    capabilityCount: integer(value.capabilityCount ?? value.capabilities?.length),
    packageCount: integer(value.packageCount ?? value.packages?.length),
  };
}
function model(value) {
  if (!object(value)) return null;
  return {
    providerId: id(value.providerId ?? value.provider),
    modelId: id(value.modelId ?? value.id),
    thinkingLevel: id(value.thinkingLevel ?? value.thinking),
    verification: ["VERIFIED", "CONFIGURED_UNVERIFIED", "NOT_CONFIGURED"].includes(value.verification) ? value.verification : "CONFIGURED_UNVERIFIED",
  };
}
function context(value) {
  if (!object(value)) return null;
  const usage = value.usage ?? value.providerEstimate ?? value;
  return {
    tokens: integer(usage.tokens ?? usage.inputTokens),
    contextWindow: integer(usage.contextWindow),
    percent: percent(usage.percent),
    messageCount: integer(value.messageCount ?? value.messages?.count),
    activeToolCount: integer(value.activeToolCount ?? value.tools?.active?.length),
  };
}
function git(value) {
  if (!object(value)) return null;
  return {
    branch: text(value.branch, 160),
    head: typeof value.head === "string" && GIT_HASH.test(value.head) ? value.head : null,
    dirty: typeof value.dirty === "boolean" ? value.dirty : null,
    ahead: integer(value.ahead),
    behind: integer(value.behind),
  };
}
function permission(value) {
  if (!object(value)) return null;
  const sandbox = object(value.bashSandbox) ? value.bashSandbox : {};
  return {
    mode: id(value.mode),
    state: id(value.state ?? value.executionState) ?? "unknown",
    approval: id(value.approval),
    bashSandbox: {
      state: ["active", "degraded", "unavailable", "unknown"].includes(sandbox.state) ? sandbox.state : "unknown",
      reason: text(sandbox.reason, 256),
    },
    wholeSessionSandbox: false,
  };
}
function swarm(value) {
  if (!object(value)) return null;
  const byState = {};
  for (const [state, count] of Object.entries(value.byState ?? {})) if (RUN_STATES.has(state) && integer(count) !== null) byState[state] = integer(count);
  return {
    active: integer(value.active ?? value.activeRuns),
    queued: integer(value.queued),
    byState,
    lastRunId: text(value.lastRunId, 128),
    liveRuntime: value.liveRuntime === true,
  };
}
function theme(value) {
  if (!object(value)) return null;
  return {
    id: id(value.id ?? value.themeId ?? value.name),
    mode: value.mode === "dark" || value.mode === "light" ? value.mode : null,
    safeDisabled: value.safeDisabled === true,
  };
}

export function buildStatusModel(input = {}) {
  return Object.freeze({
    formatVersion: 1,
    status: "HARNESS_STATUS",
    provenance: "injected-observations-only",
    headless: input.headless === true,
    mode: mode(input.mode),
    profile: profile(input.profile),
    model: model(input.model),
    context: context(input.context),
    git: git(input.git),
    permission: permission(input.permission),
    swarm: swarm(input.swarm),
    theme: theme(input.theme),
  });
}

export function formatStatusModel(model) {
  const parts = [];
  if (model?.profile?.id) parts.push(`profile:${model.profile.id}`);
  if (model?.mode?.id) parts.push(`mode:${model.mode.id}`);
  if (model?.model?.modelId) parts.push(`model:${model.model.modelId}`);
  if (model?.context?.percent !== null && model?.context?.percent !== undefined) parts.push(`ctx:${model.context.percent}%`);
  if (model?.git?.branch) parts.push(`git:${model.git.branch}${model.git.dirty ? "*" : ""}`);
  if (model?.permission?.state) parts.push(`perm:${model.permission.state}`);
  if ((model?.swarm?.active ?? 0) > 0) parts.push(`swarm:${model.swarm.active}`);
  if (model?.theme?.id) parts.push(`theme:${model.theme.id}`);
  return parts.join(" ").slice(0, 512) || "only-my-pi";
}

export class StatusService {
  constructor({ providers = {} } = {}) {
    if (!object(providers)) throw new TypeError("status providers must be an object");
    this.providers = providers;
  }
  async snapshot(overrides = {}) {
    const values = {};
    for (const key of ["mode", "profile", "model", "context", "git", "permission", "swarm", "theme", "headless"]) {
      if (Object.hasOwn(overrides, key)) values[key] = overrides[key];
      else if (typeof this.providers[key] === "function") values[key] = await this.providers[key]();
      else values[key] = this.providers[key];
    }
    return buildStatusModel(values);
  }
}

export function createStatusService(options = {}) { return new StatusService(options); }

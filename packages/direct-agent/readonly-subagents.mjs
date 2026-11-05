import { randomUUID } from "node:crypto";
import { requireDeepSeekModel } from "./model-policy.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const limits = Object.freeze({ maxChildren: 4, maxConcurrency: 2, maxDepth: 1 });
const events = { update: "prompt-template:subagent:update", response: "prompt-template:subagent:response", cancel: "prompt-template:subagent:cancel" };

// A bounded foreground consumer of the existing typed facade. pi-subagents
// remains the only owner of physical children; there is no second child pool.
export function installReadonlySubagents(pi, { controller, packageRoot, accountId, modelId, deepseekOnly }) {
  const children = [], active = new Map();
  let ready, closing = false, unconfirmed = false;
  const initialize = ctx => ready ??= (async () => {
    const [{ createAgentRegistry }, domain, { createAgentFacade }, { createPiSubagentsDelegationV1Backend }, { createPiEventTransport }] = await Promise.all([
      import("../agent-registry/index.mjs"), import("../subagents/domain/index.mjs"), import("../subagents/agent-facade.mjs"),
      import("../subagents/adapters/pi-subagents-delegation-v1/index.mjs"), import("../subagents/adapters/pi-event-transport.mjs"),
    ]);
    const entry = await createAgentRegistry({ rootDir: packageRoot }).resolve("explorer");
    const agentSpec = domain.createResolvedAgentSpec({ template: domain.agentTemplateFromRegistryEntry(entry), timeoutMs: 120000 });
    const transport = createPiEventTransport(pi);
    const facade = createAgentFacade({ backend: createPiSubagentsDelegationV1Backend({ transport, cwd: ctx.cwd, model: modelId, thinking: pi.getThinkingLevel(),
      backendVersion: "0.57.0", timeoutMs: 120000, maximumTurns: 8, maximumToolCalls: 12 }) });
    return { domain, agentSpec, facade, transport };
  })();
  const cancel = child => pi.events.emit(events.cancel, { requestId: child.id, ownerRunId: child.runId, nodeId: child.id });
  const unsubscribe = pi.events.on(events.update, value => {
    const child = active.get(value?.requestId);
    if (!child || value.ownerRunId !== child.runId || value.nodeId !== child.id) return;
    if (Number.isSafeInteger(value.toolCount) && value.toolCount >= 0) child.toolCount = value.toolCount;
    if (Number.isSafeInteger(value.tokens) && value.tokens >= 0) child.tokens = value.tokens;
  });
  const unsubscribeResponse = pi.events.on(events.response, value => {
    const child = active.get(value?.requestId);
    if (!child || value.ownerRunId !== child.runId || value.nodeId !== child.id) return;
    const counts = ["input", "output", "cacheRead", "cacheWrite"].map(key => value.usage?.[key]);
    if (counts.every(count => Number.isSafeInteger(count) && count >= 0) && Number.isSafeInteger(counts.reduce((n, count) => n + count, 0))) child.reportedTokens = counts.reduce((n, count) => n + count, 0);
  });
  pi.events.on("only-my-pi:host-interaction:v1", payload => payload.registerExecutionProbe?.(() => ({ active: active.size, unconfirmed })));
  pi.on("session_shutdown", async () => {
    closing = true;
    for (const child of active.values()) cancel(child);
    await Promise.allSettled([...active.values()].map(child => child.done));
    if (ready) {
      const runtime = await ready.catch(() => null);
      await runtime?.facade.agent.dispose(); runtime?.transport.dispose();
    }
    unsubscribe(); unsubscribeResponse();
  });
  controller.attachOrchestrator({
    snapshot: () => ({ maximumConcurrency: 2, maximumChildren: 4, totalChildren: children.length, writerUsed: false,
      budget: { status: unconfirmed ? "UNCONFIRMED" : "BOUNDED", limits, used: { tokens: children.some(c => c.tokens === null) ? null : children.reduce((n, c) => n + c.tokens, 0), toolCalls: children.some(c => c.toolCount === null) ? null : children.reduce((n, c) => n + c.toolCount, 0) } },
      children: children.map(({ label, agent, status, toolCount, tokens }) => ({ label, agent, status, toolCount, tokens, model: modelId, accountId })) }),
    async delegateReadOnly({ agent, task, label, signal }) {
      if (closing || signal?.aborted) fail("DIRECT_CHILD_CANCELLED");
      if (unconfirmed) fail("DIRECT_CHILD_RECONCILIATION_REQUIRED");
      if (agent !== "omp-explorer") fail("DIRECT_AGENT_NOT_ALLOWED");
      if (children.length >= limits.maxChildren || active.size >= limits.maxConcurrency) fail("DIRECT_CHILD_CAPACITY_REACHED");
      const ctx = controller.context;
      if (`${ctx?.model?.provider}/${ctx?.model?.id}` !== modelId) fail("CHILD_ACCOUNT_MODEL_MISMATCH");
      if (deepseekOnly) requireDeepSeekModel(modelId);
      const id = `child-${randomUUID()}`, runId = `session-${ctx.sessionManager.getSessionId()}`;
      const child = { id, runId, agent, label: label ?? "只读侦察", status: "running", toolCount: null, tokens: null };
      children.push(child); active.set(id, child);
      let dispatched = false;
      const onAbort = () => cancel(child);
      signal?.addEventListener("abort", onAbort, { once: true });
      child.done = (async () => {
        try {
          const { domain, agentSpec, facade } = await initialize(ctx);
          if (closing || signal?.aborted) fail("DIRECT_CHILD_CANCELLED");
          const assignment = domain.createTaskAssignment({ assignmentId: id, agentSpec, task,
            ownership: { writer: false, workspace: "shared-read-only", allowedPaths: [] }, context: { mode: "fresh", artifactRefs: [] },
            budget: { maxElapsedMs: 120000, maxOutputBytes: 65536 } });
          const handle = domain.createAgentRunHandle({ runId, nodeId: id, attemptId: id, assignment, agentSpec });
          dispatched = true;
          const { terminal } = await facade.agent.launch({ handle, assignment, agentSpec, model: modelId, thinking: pi.getThinkingLevel(), mode: "foreground" });
          if (!terminal.authoritative) fail("DIRECT_CHILD_TERMINATION_UNCONFIRMED");
          child.status = terminal.outcome; child.tokens = child.reportedTokens ?? null; child.toolCount = terminal.completion.usage.toolCalls;
          if (terminal.outcome !== "completed") fail(terminal.error?.code ?? "DIRECT_CHILD_CANCELLED");
          return { model: modelId, accountId, receiptId: terminal.receiptId, backendRunId: terminal.completion.upstreamRunId,
            exitCode: terminal.completion.exitCode, authoritative: true, result: terminal.result };
        } catch (error) {
          if (child.status === "running") { child.status = dispatched ? "unknown" : "failed"; unconfirmed ||= dispatched; if (dispatched) cancel(child); }
          throw error;
        } finally { signal?.removeEventListener("abort", onAbort); active.delete(id); }
      })();
      return child.done;
    },
  });
}

// Test-only trusted bootstrap. This file is excluded from distribution payloads.
import path from "node:path";
import { ModelRuntime, SettingsManager, SessionManager, createAgentSessionServices, createAgentSessionFromServices, createAgentSessionRuntime, runRpcMode } from "@earendil-works/pi-coding-agent";
import { DirectSessionController } from "../../extensions/omp-direct/runtime.mjs";
import { createHostInteraction } from "../../packages/host/interaction.mjs";
// Resolve the public pi-ai entry from the SDK's private dependency installation.
const aiEntry = new URL("../node_modules/@earendil-works/pi-ai/dist/index.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import(aiEntry.href);
const [cwd, agentDir, scenario] = process.argv.slice(2);
const capability = createHostInteraction();
const request = { taskSummary: "Write fixture", complexity: "simple", scope: ["proof.txt"], riskFlags: [], verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
const faux = fauxProvider({ provider: "omp-fixture", tokensPerSecond: 100000 });
faux.setResponses([
  fauxAssistantMessage(fauxToolCall("request_coding_access", request)),
  fauxAssistantMessage(fauxToolCall("write", { path: "proof.txt", content: "real SDK tool\n" })),
  fauxAssistantMessage("done"),
]);
const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false });
modelRuntime.registerNativeProvider(faux.provider);
await modelRuntime.refresh({ allowNetwork: false });
let controller;
const extension = (pi) => {
  controller = new DirectSessionController({ pi, configRoot: agentDir, hostInteraction: scenario === "ordinary" ? null : capability, environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1" } });
  pi.registerTool({ name: "request_coding_access", label: "Approve", description: "fixture approval", parameters: { type: "object", properties: {}, additionalProperties: true }, executionMode: "sequential",
    async execute(_id, input, signal, _update, ctx) {
      if (scenario !== "ordinary") capability.bind(ctx);
      return controller.requestCodingAccess(input, ctx, signal);
    } });
  pi.on("session_start", async (event, ctx) => { if (scenario !== "ordinary") capability.bind(ctx); await controller.start(event, ctx); });
  pi.on("before_agent_start", (event) => controller.beforeAgentStart(event));
  pi.on("tool_call", (event) => {
    if (event.toolName === "write" && scenario === "revoke") controller.accessCommand("revoke", controller.context);
    return controller.blockToolCall(event);
  });
  pi.on("session_shutdown", (_event, ctx) => { capability.invalidate(); controller.shutdown(ctx); });
};
const runtime = await createAgentSessionRuntime(async (options) => {
  const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [extension] } });
  const result = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager, model: faux.getModel(), thinkingLevel: "off", tools: ["read", "write", "request_coding_access"] });
  return { ...result, services, diagnostics: services.diagnostics };
}, { cwd, agentDir, sessionManager: SessionManager.create(cwd, path.join(agentDir, "sessions")) });
process.on("message", (message) => { if (message === "invalidate") { capability.invalidate(); controller.accessCommand("revoke", controller.context); process.send?.("invalidated"); } });
await runRpcMode(runtime);

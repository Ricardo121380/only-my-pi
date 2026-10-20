// Generate history using the independently installed old SDK, in caller-owned
// directories and against a loopback model. No user session/config is opened.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [sdkRoot, cwd, agentDir, sessionDir] = process.argv.slice(2);
const manifest = JSON.parse(await fs.readFile(path.join(sdkRoot, "package.json"), "utf8"));
if (manifest.version !== "0.85.1") throw new Error("LEGACY_SDK_VERSION_MISMATCH");
const sdk = await import(pathToFileURL(path.join(sdkRoot, "dist/index.js")));
sdk.initTheme(undefined, false);
const modelRuntime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
const manager = sdk.SessionManager.create(cwd, sessionDir);
const runtime = await sdk.createAgentSessionRuntime(async ({ sessionManager }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true } });
  const model = modelRuntime.getAvailableSnapshot().find(model => model.provider === "fixture" && model.id === "legacy");
  const result = await sdk.createAgentSessionFromServices({ services, sessionManager, model, tools: ["read"] });
  return { ...result, services, diagnostics: services.diagnostics };
}, { cwd, agentDir, sessionManager: manager });
await runtime.session.prompt("Read README.md; then answer LEGACY_MARKER.");
await runtime.dispose();
process.stdout.write(JSON.stringify({ version: manifest.version, sessionId: manager.getSessionId(), file: manager.getSessionFile(), node: process.version }) + "\n");

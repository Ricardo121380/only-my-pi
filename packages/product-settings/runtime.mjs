import path from "node:path";
import { ProductSettings, settingsError, taskSettingsSnapshot } from "./catalog.mjs";

export const settingsToolNames = snapshot => snapshot.resources.filter(r => r.enabled).flatMap(r => r.toolNames);
export const filterSettingsTools = (names, snapshot) => names.filter(name => !snapshot.resources.some(r => !r.enabled && r.toolNames.includes(name)));

// The public Pi loader owns skill discovery/validation. OMP selects explicit,
// digest-bound copies; it never replaces Pi's prompt or skill expansion engine.
export function productLoaderOptions({ sdk, configRoot, snapshot, getSnapshot = () => snapshot }) {
  const store = new ProductSettings(configRoot);
  return { noSkills: true, skillsOverride: () => sdk.loadSkills({ cwd: snapshot.projectPath, agentDir: configRoot,
    skillPaths: getSnapshot().resources.filter(r => r.kind === "skill" && r.enabled).map(r => store.skillPath(r)), includeDefaults: false }) };
}

export function installProductSettings(pi, { configRoot, snapshot, controller }) {
  const store = new ProductSettings(configRoot);
  const selected = name => snapshot.resources.find(resource => resource.toolNames.includes(name));
  if (controller) {
    controller.productTools = () => settingsToolNames(snapshot).filter(name => name === "context_snapshot");
    controller.productAdmitted = name => selected(name)?.enabled !== false;
  }
  pi.events.emit("only-my-pi:owned-product:v1", { admits: name => name === "context_snapshot" && selected(name)?.enabled === true });
  // First-party context diagnostics consume the same immutable parameters.
  pi.events.emit("only-my-pi:product-settings:v1", snapshot);
  pi.on("tool_call", async event => {
    const resource = selected(event.toolName);
    if (resource && (!resource.enabled || !await store.current(resource))) return { block: true, reason: "RESOURCE_DISABLED_OR_REVOKED" };
    if (event.toolName === "read" && typeof event.input?.path === "string") {
      const target = path.resolve(snapshot.projectPath, event.input.path);
      const skill = snapshot.resources.find(r => r.kind === "skill" && store.skillPath(r) === target);
      if (skill && (!skill.enabled || !await store.current(skill))) return { block: true, reason: "RESOURCE_DISABLED_OR_REVOKED" };
    }
  });
}

export async function confirmProductLoad({ services, session, configRoot, snapshot, taskId }) {
  const store = new ProductSettings(configRoot);
  try {
    if (services.diagnostics.some(d => d.type === "error") || services.resourceLoader.getExtensions().errors.length
      || services.resourceLoader.getSkills().diagnostics.some(d => d.type === "error" || d.type === "warning")) throw settingsError("RESOURCE_LOAD_FAILED", 409);
    const skills = services.resourceLoader.getSkills().skills;
    for (const resource of snapshot.resources.filter(r => r.kind === "skill" && r.enabled)) {
      if (!skills.some(skill => skill.filePath === store.skillPath(resource) && skill.name === resource.name)) throw settingsError("RESOURCE_LOAD_FAILED", 409);
    }
    const tools = new Set(session.getActiveToolNames());
    if (snapshot.resources.find(r => r.id === "context-doctor").enabled && !tools.has("context_snapshot")) throw settingsError("RESOURCE_LOAD_FAILED", 409);
    await store.recordLoad(snapshot, null, taskId ?? session.sessionId);
    return { revision: snapshot.revision, resourceRevision: snapshot.resourceRevision, resources: snapshot.resources, skills: skills.map(s => s.name), tools: [...tools] };
  } catch (error) { await store.recordLoad(snapshot, error, taskId); throw error; }
}

// Refresh only at the next logical Pi run. Prompts queued before agent_settled
// remain in the active run and retain its configuration and authorization.
export function refreshDirectSettings({ session, services, configRoot, getSnapshot, setSnapshot, publish, packageRoot }) {
  let active = false, broken = false;
  session.subscribe(event => { if (event.type === "agent_start") active = true; if (event.type === "agent_settled") active = false; });
  const prompt = session.prompt.bind(session);
  session.prompt = async (...args) => {
    if (broken) throw settingsError("RESOURCE_LOAD_FAILED", 409);
    if (!active) {
      const next = await taskSettingsSnapshot(configRoot, getSnapshot().projectPath, packageRoot);
      const changed = next.resourceRevision !== getSnapshot().resourceRevision;
      setSnapshot(next);
      if (changed) {
        try { await session.extensionRunner.createCommandContext().reload(); await confirmProductLoad({ session, services, configRoot, snapshot: next.settingsSnapshot }); }
        catch (error) { broken = true; await new ProductSettings(configRoot).recordLoad(next.settingsSnapshot, error); throw error; }
      }
      publish?.(next);
    }
    return prompt(...args);
  };
}

import { ownershipError } from "../process-runtime/ownership.mjs";
// Pi resolves configured packages before applying noExtensions/noSkills. Keep
// that earlier step empty too, without persisting changes to user settings.
export function withoutOptionalPackages(settings) {
  return new Proxy(settings, { get(target, key) {
    if (key === "getPackages") return () => [];
    if (["getSettings", "getGlobalSettings", "getProjectSettings"].includes(key))
      return () => ({ ...target[key](), packages: [] });
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

// Shared native Pi loadout for CLI and the controlled local Host.
export async function createMinimalSessionServices(sdk, options) {
  const services = await sdk.createAgentSessionServices({ ...options,
    settingsManager: withoutOptionalPackages(options.settingsManager),
    resourceLoaderOptions: { ...options.resourceLoaderOptions,
      noExtensions: true, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true, disabledBuiltinExtensions: ["mcp"] },
  });
  if (services.diagnostics.some(item => item.type === "error") || services.resourceLoader.getExtensions().errors.length)
    throw ownershipError("RESOURCE_LOAD_FAILED");
  return services;
}

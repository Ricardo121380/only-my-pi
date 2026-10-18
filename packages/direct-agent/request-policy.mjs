// OMP cannot infer that a disconnected request had no external effect.
// Apply only in memory; raw Pi/user settings retain their original ownership.
export function applyOmpRequestPolicy(settingsManager) {
  // Reload and the public retry toggle can replace transient overrides. Keep
  // the effective policy at the public read boundary on this owned instance.
  return new Proxy(settingsManager, { get(target, key) {
    if (key === "getRetryEnabled") return () => false;
    if (key === "getRetrySettings") return () => ({ ...target.getRetrySettings(), enabled: false, maxRetries: 0 });
    if (key === "getProviderRetrySettings") return () => ({ ...target.getProviderRetrySettings(), maxRetries: 0 });
    if (key === "getSettings") return () => {
      const settings = target.getSettings();
      return { ...settings, retry: { ...settings.retry, enabled: false, maxRetries: 0, provider: { ...settings.retry?.provider, maxRetries: 0 } } };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

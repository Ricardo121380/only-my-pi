/**
 * OMP disables background cache requests independently of raw Pi settings.
 * Install this factory last: Pi's public decision hook uses the last override.
 * @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi
 */
export function disableOmpCacheWarming(pi) {
  pi.on("cache_warming_decision", () => ({ action: "stop" }));
}

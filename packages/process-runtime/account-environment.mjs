export function accountWorkerEnvironment(env) {
  // Allow operational settings, never ambient provider identities or Node injection.
  const names = ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  return Object.fromEntries(names.filter((name) => typeof env[name] === "string").map((name) => [name, env[name]]));
}

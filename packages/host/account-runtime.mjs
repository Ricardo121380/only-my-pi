import { AccountCatalog } from "./accounts.mjs";
import { hasAccountCredential } from "./account-credential.mjs";
import { hostError } from "./contracts.mjs";

const safeMessage = message => message?.errorMessage ? { ...message, errorMessage: "ACCOUNT_MODEL_REQUEST_FAILED" } : message;
function safeStream(stream) {
  return new Proxy(stream, { get(target, key) {
    if (key === Symbol.asyncIterator) return async function* () {
      for await (const event of target) yield event.type === "error" ? { ...event, error: safeMessage(event.error) } : event;
    };
    if (key === "result") return async () => safeMessage(await target.result());
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

// Use Pi's real ModelRuntime and credential store. Narrow its public surface
// for an executing product identity: native /login and /logout must not mutate
// that identity outside the common account lifecycle.
export async function openProductAccount({ sdk, configRoot, accountId }) {
  const catalog = new AccountCatalog(configRoot);
  const release = await catalog.beginUse(accountId);
  const account = await catalog.get(accountId);
  const runtime = await sdk.ModelRuntime.create({ ...await catalog.runtimePaths(accountId), allowModelNetwork: false, refreshOnCreate: false });
  if (!await hasAccountCredential(runtime, accountId, account)) throw hostError("ACCOUNT_CREDENTIAL_MISSING", 409);
  const getAuth = runtime.getAuth.bind(runtime);
  runtime.getAuth = async (providerOrModel, options = {}) => {
    const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
    if (providerId !== account.providerId) throw hostError("ACCOUNT_MODEL_MISMATCH", 409);
    if (!await hasAccountCredential(runtime, accountId, account)) throw hostError("ACCOUNT_CREDENTIAL_MISSING", 409);
    // No per-request key or environmental identity may override this store.
    const auth = await getAuth(providerOrModel, { signal: options.signal, env: {} });
    if (!auth) throw hostError("ACCOUNT_CREDENTIAL_UNAVAILABLE", 409);
    return auth;
  };
  for (const method of ["login", "logout", "setRuntimeApiKey", "removeRuntimeApiKey"]) runtime[method] = async () => { throw hostError("ACCOUNT_AUTH_REQUIRES_ACCOUNT_COMMAND", 409); };
  const available = runtime.getAvailableSnapshot.bind(runtime);
  runtime.getAvailableSnapshot = () => available().filter(model => model.provider === account.providerId);
  const providers = runtime.getProviders.bind(runtime);
  runtime.getProviders = () => providers().filter(provider => provider.id === account.providerId);
  const models = runtime.getModels.bind(runtime);
  runtime.getModels = providerId => providerId && providerId !== account.providerId ? [] : models(account.providerId);
  // Provider error bodies may echo Authorization values. Sanitize Pi's public
  // error stream before terminal renderers or session history consume it.
  for (const method of ["stream", "streamSimple", "streamDeferred"]) {
    const invoke = runtime[method].bind(runtime);
    runtime[method] = (...args) => safeStream(invoke(...args));
  }
  return { account, runtime, release };
}

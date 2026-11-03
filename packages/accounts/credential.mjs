import { CLI_ACCOUNT_ID } from "./contracts.mjs";

// CLI's explicit models.json key is a configured identity, not an ambient
// environment fallback. GUI accounts still require their own credential store.
export async function hasAccountCredential(runtime, accountId, account) {
  const stored = (await runtime.listCredentials()).some((entry) => entry.providerId === account.providerId && (accountId === CLI_ACCOUNT_ID || entry.type === account.authType));
  return stored || (accountId === CLI_ACCOUNT_ID && runtime.getProviderAuthStatus(account.providerId).source === "models_json_key");
}

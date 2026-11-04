import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountDirectory, ModelChoice, ThinkingLevel } from "../../packages/accounts/contracts";
import { api, errorText, query } from "./api";

export function useAccountModels(connected: boolean, onError: (message: string) => void) {
  const [accounts, setAccounts] = useState<AccountDirectory | null>(null);
  const [accountId, setAccountId] = useState("");
  const [revision, setRevision] = useState(0);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | null>(null);
  const modelRequest = useRef(0);

  const loadModels = useCallback(async () => {
    const version = ++modelRequest.current;
    if (!accountId) { setModels([]); return; }
    try {
      const result = await api<{ models: ModelChoice[] }>(query("models", { accountId }));
      if (version === modelRequest.current) setModels(result.models);
    } catch (cause) {
      if (version === modelRequest.current) { setModels([]); onError(errorText(cause)); }
    }
  }, [accountId, onError]);

  useEffect(() => {
    const controller = new AbortController();
    if (connected) void api<AccountDirectory>("/api/accounts", undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setAccounts(value);
      // A removed account must require a new choice, never an ambient fallback.
      setAccountId(id => id === value.cliReference.accountId || value.accounts.some(a => a.accountId === id) ? id : "");
    }).catch(cause => { if (!controller.signal.aborted) onError(errorText(cause)); });
    return () => controller.abort();
  }, [connected, revision, onError]);

  useEffect(() => {
    setModels([]); setSelectedModel(""); setThinkingLevel(null);
    if (connected) void loadModels();
    // Also invalidates responses after disconnect or unmount, including errors.
    return () => { modelRequest.current++; };
  }, [connected, revision, loadModels]);

  function selectAccount(id: string) { if (id === accountId) return; setAccountId(id); setModels([]); setSelectedModel(""); }
  function selectModel(id: string) { setSelectedModel(id); setThinkingLevel(null); }
  return { accounts, accountId, models, selectedModel, thinkingLevel, setThinkingLevel,
    selectAccount, selectModel, loadModels, refreshAccounts: () => setRevision(n => n + 1) };
}

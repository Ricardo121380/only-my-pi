export async function settingsApi<T>(input: object, projectId?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/settings", { method: "POST", signal, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-settings-protocol": "1" }, body: JSON.stringify({ ...input, ...(projectId ? { projectId } : {}) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.code ?? "SETTINGS_REQUEST_FAILED"); return value;
}

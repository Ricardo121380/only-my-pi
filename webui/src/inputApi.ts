import type { InputCommandV1, InputCommandResultV1, InputContentV1, InputShardV1, QueueShardV1 } from "../../packages/host/contracts";

export type QueueCommand = Exclude<InputCommandV1, { type: "getInputs" | "saveDraft" | "clearDraft" | "submitPrompt" }>;
export type QueueAction = { [T in QueueCommand["type"]]: Omit<Extract<QueueCommand, { type: T }>, "target"> }[QueueCommand["type"]];
export class InputRequestError extends Error {
  readonly uncertain: boolean;
  constructor(code: string, uncertain = false) { super(code); this.uncertain = uncertain; }
}
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function shard(value: InputShardV1, kind: "draft" | "queue", projectId: string) {
  if (!value || value.schemaVersion !== 1 || value.kind !== kind || !revision(value.revision) || value.scope?.projectId !== projectId || value.scope.sessionId !== null && typeof value.scope.sessionId !== "string") return false;
  const items = value.kind === "queue" ? value.items : value.draft ? [value.draft] : [];
  return Array.isArray(items) && items.every(item => item && item.schemaVersion === 1 && revision(item.revision) && typeof item.inputId === "string" && typeof item.text === "string"
    && item.projectId === projectId && item.sessionId === value.scope.sessionId && ["draft", "queued", "dispatching", "accepted", "consumed", "paused", "unknown", "removed"].includes(item.state)
    && ["prompt", "steer", "queue"].includes(item.delivery) && Array.isArray(item.materialSnapshotIds) && item.materialSnapshotIds.every(id => typeof id === "string")
    && typeof item.binding?.accountId === "string" && typeof item.binding.modelId === "string" && typeof item.binding.thinking === "string" && ["readonly", "controlled"].includes(item.binding.mode) && revision(item.binding.resourceRevision));
}
export async function inputApi<C extends InputCommandV1>(command: C, signal?: AbortSignal): Promise<InputCommandResultV1<C>> {
  try {
    const response = await fetch("/api/input-command", { method: "POST", signal, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" }, body: JSON.stringify(command) });
    const value = await response.json();
    if (!response.ok) throw new InputRequestError(typeof value.code === "string" ? value.code : "INPUT_REQUEST_FAILED", response.status >= 500 && command.type !== "getInputs");
    const valid = command.type === "getInputs" ? value.protocol === 1 && ["ready", "reconciliation_required"].includes(value.admission) && shard(value.draft, "draft", command.target.projectId) && shard(value.queue, "queue", command.target.projectId) && value.draft.scope.sessionId === value.queue.scope.sessionId
      : command.type === "saveDraft" || command.type === "clearDraft" ? shard(value, "draft", command.target.projectId)
      : command.type === "submitPrompt" ? typeof value.taskId === "string" && value.projectId === command.target.projectId
      : shard(value, "queue", command.target.projectId);
    if (!valid) throw new InputRequestError("INPUT_RESPONSE_INVALID", command.type !== "getInputs");
    return value as InputCommandResultV1<C>;
  } catch (cause) {
    if (cause instanceof InputRequestError) throw cause;
    throw new InputRequestError("INPUT_RESULT_UNCONFIRMED", command.type !== "getInputs");
  }
}
export function sameInput(a: InputContentV1, b: InputContentV1) {
  return a.inputId === b.inputId && a.delivery === b.delivery && a.text === b.text
    && a.materialSnapshotIds.length === b.materialSnapshotIds.length && a.materialSnapshotIds.every((id, index) => id === b.materialSnapshotIds[index])
    && (["accountId", "modelId", "thinking", "mode", "resourceRevision"] as const).every(key => a.binding[key] === b.binding[key]);
}
export function confirmsQueueCommand(queue: QueueShardV1, command: QueueCommand) {
  if ("input" in command) {
    const item = queue.items.find(item => item.inputId === command.input.inputId);
    return !!item && sameInput(item, command.input) && (command.type !== "editQueuedInput" || item.revision > command.expectedInputRevision);
  }
  if (command.type === "removeQueuedInput") return queue.items.some(item => item.inputId === command.inputId && item.state === "removed" && item.revision > command.expectedInputRevision);
  if (command.type === "reconcileInput") return queue.items.some(item => item.inputId === command.inputId && item.state === "consumed");
  return queue.revision > command.expectedRevision && !queue.items.some(item => ["queued", "paused"].includes(item.state));
}

// @ts-check
import { INPUT_CARRIER, INPUT_PROTOCOL, findInputReceipt, validateDeliveryRecord } from "./input-protocol.mjs";
import { inputError } from "./input-contracts.mjs";

/** The public Pi SDK owns the safe steering point. This bridge never aborts a
 * tool, rewrites model text with an ID, or falls back to a new prompt.
 * @param {{ session: import('@earendil-works/pi-coding-agent').AgentSession; taskId: string; accountId: string; modelId: string; mode: 'readonly'|'controlled'; resourceRevision?: number; send: (frame: object) => void }} options */
export function createPiInputBridge({ session, taskId, accountId, modelId, mode, resourceRevision = 0, send }) {
  /** @type {Map<string, import('./contracts.d.ts').InputRecordV1>} */ const accepted = new Map();
  /** @type {Map<string, string>} */ const announced = new Map();
  let ended = false, started = false;
  const notify = () => {
    /** @type {Map<string, unknown[]>} */ const entries = new Map();
    // Walk the branch once, not once per input on every streamed message.
    for (const entry of session.sessionManager.getBranch()) {
      if (entry.type !== "custom_message" || entry.customType !== INPUT_CARRIER || !entry.details || typeof entry.details !== "object" || !("inputId" in entry.details) || typeof entry.details.inputId !== "string") continue;
      const group = entries.get(entry.details.inputId) ?? []; group.push(entry); entries.set(entry.details.inputId, group);
    }
    for (const record of accepted.values()) {
      const receipt = findInputReceipt(entries.get(record.inputId) ?? [], record);
      // A candidate is NOT a durable receipt. Host verifies the persisted file.
      if (receipt && announced.get(record.inputId) !== receipt.entryId) { send({ type: "omp_input_candidate", protocol: INPUT_PROTOCOL, receipt }); announced.set(record.inputId, receipt.entryId); }
    }
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start") started = true;
    if (event.type === "agent_settled") ended = true;
    if (event.type === "message_end" || event.type === "agent_settled") queueMicrotask(() => {
      try { notify(); } catch { send({ type: "omp_input_fault", code: "INPUT_RECEIPT_CONFLICT" }); }
    });
  });
  /** @param {import("./contracts.d.ts").InputRecordV1} record */
  const feedback = (record) => ({ source: /** @type {const} */ ("omp-custom-message"), disposition: /** @type {"queued"|"started"} */ (record.delivery === "steer" ? "queued" : "started") });
  /** @param {unknown} value @returns {import('./contracts.d.ts').InputDeliveryV1} */
  function deliver(value) {
    const record = structuredClone(validateDeliveryRecord(value));
    if (record.taskId !== taskId || record.sessionId !== session.sessionManager.getSessionId() || record.binding.accountId !== accountId || record.binding.modelId !== modelId || record.binding.mode !== mode || record.binding.thinking !== session.thinkingLevel || record.binding.resourceRevision !== resourceRevision || record.materialSnapshotIds.length) throw inputError("INPUT_BINDING_CHANGED");
    const receipt = findInputReceipt(session.sessionManager.getBranch(), record);
    if (receipt) return { status: "consumed", receipt, feedback: feedback(record) };
    const prior = accepted.get(record.inputId);
    if (prior) {
      if (prior.contentDigest !== record.contentDigest) throw inputError("INPUT_ID_CONFLICT");
      return { status: "accepted", feedback: feedback(record) };
    }
    if (accepted.size >= 1000) throw inputError("INPUT_QUEUE_LIMIT", 429);
    if (ended || (record.delivery === "steer" ? !session.isStreaming : session.isStreaming || started) || !["steer", "queue", "prompt"].includes(record.delivery)) throw inputError("TASK_NOT_RUNNING");
    accepted.set(record.inputId, record);
    if (record.delivery !== "steer") started = true;
    // No await between the streaming check and native steering admission.
    void session.sendCustomMessage({ customType: INPUT_CARRIER, content: record.text, display: true, details: { version: INPUT_PROTOCOL, inputId: record.inputId, taskId, scope: { projectId: record.projectId, sessionId: record.sessionId }, contentDigest: record.contentDigest } }, { triggerTurn: true, ...(record.delivery === "steer" ? { deliverAs: "steer" } : {}) }).catch(() => send({ type: "omp_input_fault", code: "INPUT_DELIVERY_FAILED" }));
    return { status: "accepted", feedback: feedback(record) };
  }
  /** Lookup has NO execution side effect, including after an uncertain ACK.
   * @param {unknown} value @returns {import('./contracts.d.ts').InputDeliveryV1} */
  function lookup(value) {
    const record = validateDeliveryRecord(value);
    if (record.taskId !== taskId || record.sessionId !== session.sessionManager.getSessionId()) throw inputError("INPUT_BINDING_CHANGED");
    const prior = accepted.get(record.inputId);
    if (prior && prior.contentDigest !== record.contentDigest) throw inputError("INPUT_ID_CONFLICT");
    const receipt = findInputReceipt(session.sessionManager.getBranch(), record);
    return receipt ? { status: "consumed", receipt, feedback: feedback(record) } : prior ? { status: "accepted", feedback: feedback(prior) } : { status: "unknown" };
  }
  return { deliver, lookup, dispose: unsubscribe };
}

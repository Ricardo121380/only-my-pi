import { redactDetails } from "./shared.mjs";

export const SUBAGENT_ERROR_CATEGORIES = Object.freeze([
  "validation",
  "capability",
  "policy",
  "transport",
  "backend",
  "timeout",
  "cancelled",
  "correlation",
  "unavailable",
  "internal",
]);

export class SubagentsError extends Error {
  constructor(message, {
    code = "SUBAGENTS_ERROR",
    category = "internal",
    retryable = false,
    details,
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SubagentsError";
    this.code = code;
    this.category = SUBAGENT_ERROR_CATEGORIES.includes(category) ? category : "internal";
    this.retryable = retryable === true;
    if (details !== undefined) this.details = redactDetails(details);
  }
}

export function fail(message, code, options = {}) {
  throw new SubagentsError(message, { ...options, code });
}

export function normalizeSubagentsError(error, {
  code = "SUBAGENTS_ERROR",
  category = "internal",
  retryable = false,
  message = "Subagent operation failed",
} = {}) {
  if (error instanceof SubagentsError) return error;
  return new SubagentsError(message, {
    code,
    category,
    retryable,
    cause: error instanceof Error ? error : undefined,
    details: { upstreamName: error?.name, upstreamCode: error?.code },
  });
}

export function errorReceiptProjection(error) {
  const normalized = normalizeSubagentsError(error);
  return Object.freeze({
    code: normalized.code,
    category: normalized.category,
    retryable: normalized.retryable,
    message: normalized.message.slice(0, 512),
    ...(normalized.details === undefined ? {} : { details: normalized.details }),
  });
}

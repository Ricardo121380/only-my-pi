import { AcpProtocolError, JSON_RPC_ERROR_CODES, assertJsonRpcMessage } from "./protocol.mjs";

export const DEFAULT_MAX_NDJSON_LINE_BYTES = 1024 * 1024;

function byteLength(value) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(value).byteLength;
  return value.length;
}

/** Encode one JSON-RPC message as the ACP stdio/NDJSON wire unit. */
export function encodeNdjson(message) {
  assertJsonRpcMessage(message);
  return `${JSON.stringify(message)}\n`;
}

/** Decode exactly one non-empty NDJSON line and validate its JSON-RPC envelope. */
export function decodeNdjsonLine(line, { maxLineBytes = DEFAULT_MAX_NDJSON_LINE_BYTES } = {}) {
  if (typeof line !== "string") {
    throw new AcpProtocolError("NDJSON line must be a string", {
      code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
      data: { code: "LINE_TYPE" },
    });
  }
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (normalized.trim().length === 0) {
    throw new AcpProtocolError("NDJSON line must not be empty", {
      code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
      data: { code: "EMPTY_LINE" },
    });
  }
  if (byteLength(normalized) > maxLineBytes) {
    throw new AcpProtocolError("NDJSON line exceeds the configured size limit", {
      code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
      data: { code: "LINE_TOO_LARGE", maxLineBytes },
    });
  }
  let value;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new AcpProtocolError("NDJSON line is not valid JSON", {
      code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
      data: { code: "INVALID_JSON" },
    });
  }
  assertJsonRpcMessage(value);
  return value;
}

/**
 * Incremental NDJSON decoder.  It accepts strings or Uint8Array-like chunks,
 * emits complete messages, and never performs I/O itself.
 */
export class NdjsonDecoder {
  #buffer = "";
  #maxLineBytes;
  #decoder;

  constructor({ maxLineBytes = DEFAULT_MAX_NDJSON_LINE_BYTES } = {}) {
    this.#maxLineBytes = maxLineBytes;
    this.#decoder = typeof TextDecoder === "function" ? new TextDecoder() : null;
  }

  push(chunk) {
    if (typeof chunk === "string") {
      this.#buffer += chunk;
    } else if (chunk && this.#decoder) {
      this.#buffer += this.#decoder.decode(chunk, { stream: true });
    } else {
      throw new AcpProtocolError("NDJSON chunk must be a string or Uint8Array", {
        code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
        data: { code: "CHUNK_TYPE" },
      });
    }
    const messages = [];
    let newline;
    while ((newline = this.#buffer.indexOf("\n")) !== -1) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;
      messages.push(decodeNdjsonLine(line, { maxLineBytes: this.#maxLineBytes }));
    }
    if (byteLength(this.#buffer) > this.#maxLineBytes) {
      throw new AcpProtocolError("NDJSON partial line exceeds the configured size limit", {
        code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
        data: { code: "LINE_TOO_LARGE", maxLineBytes: this.#maxLineBytes },
      });
    }
    return messages;
  }

  end() {
    if (this.#decoder) this.#buffer += this.#decoder.decode();
    const tail = this.#buffer;
    this.#buffer = "";
    if (tail.trim().length === 0) return [];
    return [decodeNdjsonLine(tail, { maxLineBytes: this.#maxLineBytes })];
  }
}

export function createNdjsonDecoder(options) {
  return new NdjsonDecoder(options);
}

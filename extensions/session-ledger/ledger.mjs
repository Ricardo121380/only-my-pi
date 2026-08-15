import { lstat, mkdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

export const SCHEMA_VERSION = 1;
export const DEFAULT_LEDGER_DIRECTORY = join(homedir(), ".pi", "agent", "only-my-pi", "ledgers");

const OVERRIDE_VARIABLES = ["ONLY_MY_PI_LEDGER_DIR", "PI_SESSION_LEDGER_DIR"];

function stableValue(value, seen = new WeakSet(), depth = 0) {
	if (value === null) return null;
	if (depth > 6) return "[depth]";
	const kind = typeof value;
	if (kind === "string") return `[string:${value.length}]`;
	if (kind === "number" || kind === "boolean") return kind;
	if (kind === "bigint") return "bigint";
	if (kind === "undefined") return "undefined";
	if (kind === "function") return "function";
	if (kind !== "object") return kind;
	if (seen.has(value)) return "[cycle]";
	seen.add(value);
	if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 32).map((item) => stableValue(item, seen, depth + 1)) };
	const keys = Object.keys(value).sort();
	const result = { type: "object", keys: keys.length };
	for (const key of keys.slice(0, 64)) result[key] = stableValue(value[key], seen, depth + 1);
	return result;
}

export function summarizeValue(value) {
	if (value === null) return { type: "null" };
	if (Array.isArray(value)) return { type: "array", length: value.length };
	if (typeof value === "string") return { type: "string", length: value.length };
	if (typeof value === "object") return { type: "object", keys: Object.keys(value).length };
	return { type: typeof value };
}

export function hashValue(value) {
	const serialized = JSON.stringify(stableValue(value));
	return createHash("sha256").update(serialized).digest("hex");
}

function correlationValue(value) {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (typeof value === "string") return `string:${value}`;
	if (typeof value === "number") return `number:${value}`;
	if (typeof value === "boolean") return `boolean:${value}`;
	return JSON.stringify(value);
}

export function resolveLedgerDirectory(env = process.env) {
	for (const name of OVERRIDE_VARIABLES) {
		const candidate = env[name]?.trim();
		if (!candidate) continue;
		// Reject relative paths: an environment override must not depend on cwd.
		if (!isAbsolute(candidate)) throw new Error(`${name} must be an absolute path`);
		return resolve(candidate);
	}
	return DEFAULT_LEDGER_DIRECTORY;
}

function safeHash(value) {
	return value == null ? undefined : hashValue(value);
}

function normalizeRecord(record) {
	const normalized = { ...record };
	if (normalized.details === undefined) delete normalized.details;
	return normalized;
}

/**
 * A serialized, append-only receipt writer. It intentionally accepts only
 * already-redacted event details; it never stores prompts, reasoning, or raw
 * tool payloads.
 */
export function createReceiptLedger({
	directory = resolveLedgerDirectory(),
	runId = randomUUID(),
	now = () => new Date().toISOString(),
	fileName,
	correlationKey = randomBytes(32),
} = {}) {
	if (!isAbsolute(directory)) throw new Error("ledger directory must be absolute");
	directory = resolve(directory);
	const safeRunId = String(runId).replace(/[^a-zA-Z0-9_-]/g, "_");
	const selectedFileName = fileName ?? `run-${safeRunId}.jsonl`;
	if (selectedFileName !== basename(selectedFileName)) throw new Error("ledger fileName must not contain a path");
	const path = join(directory, selectedFileName);
	let chain = Promise.resolve();
	let initialized = false;
	const correlate = (value) => createHmac("sha256", correlationKey).update(correlationValue(value)).digest("hex");

	async function ensureDirectory() {
		if (initialized) return;
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const directoryStat = await lstat(directory);
		if (directoryStat.isSymbolicLink()) throw new Error("ledger directory must not be a symbolic link");
		if (!directoryStat.isDirectory()) throw new Error("ledger destination is not a directory");
		if ((directoryStat.mode & 0o077) !== 0) {
			throw new Error("ledger directory must not be accessible by group or other users");
		}
		initialized = true;
	}

	async function appendLine(line) {
		let flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY;
		if (typeof constants.O_NOFOLLOW === "number") flags |= constants.O_NOFOLLOW;
		const handle = await open(path, flags, 0o600);
		try {
			const fileStat = await handle.stat();
			if (!fileStat.isFile()) throw new Error("ledger destination is not a regular file");
			await handle.writeFile(line, { encoding: "utf8" });
			await handle.chmod(0o600);
		} finally {
			await handle.close();
		}
	}

	function append(event, details = {}) {
		const record = normalizeRecord({ schemaVersion: SCHEMA_VERSION, ts: now(), runId, event, ...details });
		const line = `${JSON.stringify(record)}\n`;
		// A failed receipt is intentionally dropped, but must not prevent later
		// receipts after a transient filesystem failure.
		chain = chain.catch(() => undefined).then(async () => {
			await ensureDirectory();
			await appendLine(line);
		});
		return chain;
	}

	return {
		path,
		runId,
		correlate,
		append,
		flush: () => chain,
		redactToolStart({ toolCallId, toolName, args, sessionId, sessionFileHash }) {
			return append("tool_call_start", {
				sessionId,
				sessionFileHash,
				toolName: String(toolName),
				toolCallIdHash: toolCallId == null ? undefined : correlate(toolCallId),
				argsHash: hashValue(args),
				argsSummary: summarizeValue(args),
			});
		},
		redactToolEnd({ toolCallId, toolName, result, isError, sessionId, sessionFileHash }) {
			return append("tool_call_end", {
				sessionId,
				sessionFileHash,
				toolName: String(toolName),
				toolCallIdHash: toolCallId == null ? undefined : correlate(toolCallId),
				resultHash: hashValue(result),
				resultSummary: summarizeValue(result),
				isError: Boolean(isError),
			});
		},
	};
}

export function sessionIdentity(ctx, correlate = safeHash) {
	const manager = ctx?.sessionManager;
	const sessionId = typeof manager?.getSessionId === "function" ? manager.getSessionId() : undefined;
	return {
		sessionId,
		sessionFileHash: correlate(typeof manager?.getSessionFile === "function" ? manager.getSessionFile() : undefined),
	};
}

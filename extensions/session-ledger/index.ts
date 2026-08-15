import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createReceiptLedger, hashValue, sessionIdentity } from "./ledger.mjs";

type Ledger = ReturnType<typeof createReceiptLedger>;

function identity(ctx: ExtensionContext, ledger: Ledger) {
	try {
		return sessionIdentity(ctx, (value) => value == null ? undefined : ledger.correlate(value));
	} catch {
		return {};
	}
}

function safeCall(callback: () => Promise<unknown>): Promise<void> {
	// Ledger failures must never block or alter the Pi session.
	return callback().then(() => undefined, () => undefined);
}

export default function sessionLedgerExtension(pi: ExtensionAPI): void {
	let ledger: Ledger;
	try {
		ledger = createReceiptLedger();
	} catch {
		return;
	}

	const record = (event: string, ctx: ExtensionContext, details: Record<string, unknown> = {}) => {
		return safeCall(() => ledger.append(event, { ...identity(ctx, ledger), details }));
	};

	pi.on("session_start", (event, ctx) => record("session_start", ctx, {
		reason: event.reason,
		previousSessionFileHash: event.previousSessionFile ? ledger.correlate(event.previousSessionFile) : undefined,
	}));
	pi.on("session_info_changed", (event, ctx) => record("session_info_changed", ctx, { namePresent: event.name !== undefined }));
	pi.on("session_before_switch", (event, ctx) => record("session_before_switch", ctx, {
		reason: event.reason,
		targetSessionFileHash: event.targetSessionFile ? ledger.correlate(event.targetSessionFile) : undefined,
	}));
	pi.on("session_before_fork", (event, ctx) => record("session_before_fork", ctx, {
		entryIdHash: ledger.correlate(event.entryId), position: event.position,
	}));
	pi.on("session_before_compact", (event, ctx) => record("session_before_compact", ctx, {
		reason: event.reason, willRetry: event.willRetry, branchEntryCount: event.branchEntries.length,
		customInstructionsPresent: event.customInstructions !== undefined,
	}));
	pi.on("session_compact", (event, ctx) => record("session_compact", ctx, {
		reason: event.reason, willRetry: event.willRetry, fromExtension: event.fromExtension,
		compactionSummaryHash: hashValue(event.compactionEntry.summary),
	}));
	pi.on("session_before_tree", (event, ctx) => record("session_before_tree", ctx, {
		targetIdHash: ledger.correlate(event.preparation.targetId), oldLeafIdHash: event.preparation.oldLeafId ? ledger.correlate(event.preparation.oldLeafId) : undefined,
		entriesToSummarize: event.preparation.entriesToSummarize.length, userWantsSummary: event.preparation.userWantsSummary,
		customInstructionsPresent: event.preparation.customInstructions !== undefined,
	}));
	pi.on("session_tree", (event, ctx) => record("session_tree", ctx, {
		newLeafIdHash: event.newLeafId ? ledger.correlate(event.newLeafId) : undefined,
		oldLeafIdHash: event.oldLeafId ? ledger.correlate(event.oldLeafId) : undefined,
		summaryPresent: event.summaryEntry !== undefined, fromExtension: event.fromExtension,
	}));
	pi.on("session_shutdown", (event, ctx) => record("session_shutdown", ctx, {
		reason: event.reason, targetSessionFileHash: event.targetSessionFile ? ledger.correlate(event.targetSessionFile) : undefined,
	}));
	pi.on("tool_execution_start", (event, ctx) => safeCall(() => ledger.redactToolStart({ ...event, ...identity(ctx, ledger) })));
	pi.on("tool_execution_end", (event, ctx) => safeCall(() => ledger.redactToolEnd({ ...event, ...identity(ctx, ledger) })));
	// Tool updates are deliberately not recorded: partial output is especially
	// likely to contain secrets and is not needed for a receipt.
}

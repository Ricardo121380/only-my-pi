import type { DirectWriterState, RealWorkspaceReceipt } from "../../packages/direct-agent/contracts.d.ts";

const base = { patchDigest: null, patch: null, receiptDigest: null, failureCode: null, updatedAt: "2026-09-19T00:00:00.000Z" };
const preparing: DirectWriterState = { ...base, stage: "PREPARING", application: "NOT_STARTED", verification: "NOT_RUN" };
void preparing;
const captured: DirectWriterState = { ...preparing, stage: "PATCH_CAPTURED", patchDigest: "sha256:" + "a".repeat(64), patch: { relativePath: "runs/example/artifacts/writer.patch", byteLength: 12, digest: "sha256:" + "a".repeat(64) } };
void captured;
// @ts-expect-error A verified writer must have an applied patch.
const invalidApplication: DirectWriterState = { ...base, stage: "VERIFIED", application: "NOT_STARTED", verification: "PASS" };
// @ts-expect-error An application pending verification cannot be marked PASS.
const invalidVerification: DirectWriterState = { ...base, stage: "APPLIED_PENDING_VERIFICATION", application: "APPLIED", verification: "PASS" };
void invalidApplication;
void invalidVerification;
// @ts-expect-error A clone-phase receipt cannot certify the real worktree.
const cloneReceipt: RealWorkspaceReceipt = { phase: "clone" };
void cloneReceipt;

export type DirectWriterStage = "PREPARING" | "PATCH_CAPTURED" | "CLONE_VERIFIED" | "REVIEWED" | "APPLYING" | "APPLICATION_UNKNOWN" | "APPLIED_PENDING_VERIFICATION" | "VERIFYING" | "VERIFIED" | "BLOCKED";
export type ApplicationStatus = "NOT_STARTED" | "UNKNOWN" | "APPLIED";
export type VerificationStatus = "NOT_RUN" | "PENDING" | "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
interface DirectWriterBase {
  patchDigest: string | null;
  patch: { relativePath: string; byteLength: number; digest: string } | null;
  receiptDigest: string | null;
  failureCode: string | null;
  updatedAt: string;
}
export type DirectWriterState = DirectWriterBase & (
  { stage: "PREPARING" | "PATCH_CAPTURED" | "CLONE_VERIFIED" | "REVIEWED" | "APPLYING" | "BLOCKED"; application: "NOT_STARTED"; verification: "NOT_RUN" }
  | { stage: "APPLICATION_UNKNOWN"; application: "UNKNOWN"; verification: "NOT_RUN" }
  | { stage: "APPLIED_PENDING_VERIFICATION"; application: "APPLIED"; verification: "PENDING" | "FAIL" | "BLOCKED" }
  | { stage: "VERIFYING"; application: "APPLIED"; verification: "RUNNING" }
  | { stage: "VERIFIED"; application: "APPLIED"; verification: "PASS"; receiptDigest: string }
);
export interface RunRecordForProjection {
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  inputRetained: boolean;
  artifactsRetained: boolean;
  artifacts: unknown[];
  receiptDigest: string | null;
  directWriter?: DirectWriterState;
}
export interface GateReceiptResult {
  status: "PASS" | "FAIL";
  exitCode: number;
  killed: boolean;
  terminationUnconfirmed?: boolean;
  bindingDigest: string;
}
export interface RealWorkspaceReceipt {
  kind: "omp-real-workspace-verification";
  phase: "real-workspace";
  status: "PASS" | "FAIL";
  runId: string;
  patchDigest: string;
  head: string;
  manifestDigest: string;
  repositoryRootDigest: string;
  bindingDigest: string;
  sourceScopeDigest: string;
  sourceDigest: string;
  receiptDigest: string;
  results: GateReceiptResult[];
}
export interface ExpectedRealWorkspaceReceipt {
  runId: string;
  patchDigest: string;
  head: string;
  manifestDigest: string;
  repositoryRootDigest: string;
  receiptDigest: string;
}

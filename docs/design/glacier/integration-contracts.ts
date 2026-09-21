/**
 * Pi Agent Glacier — PROPOSED integration contracts, not existing repo APIs.
 * These types are a design handoff only. They do not connect an Agent or a PTY.
 * Use runtime schema validation at every transport boundary; TypeScript is not
 * authorization. Keys, approval validation and process control belong to host.
 */
export type ID = string;
export type Unsubscribe = () => void;
export type MetricOrigin = 'provider' | 'host-measured' | 'estimated' | 'fixture';
export interface Metric<T> {
  readonly value: T | null; // null means unknown, never coerce to zero
  readonly origin: MetricOrigin;
  readonly observedAt: string; // ISO-8601, host time
}

// Product navigation: Partition -> Project -> Session. No Workspace entity.
// This Partition is a user navigation group, NOT Electron's storage partition.
export interface Partition { readonly id: ID; readonly name: string; }
export interface Project {
  readonly id: ID;
  readonly partitionId: ID;
  readonly name: string;
  readonly displayPath: string;
  readonly runtimeTargetId: ID; // attribute, not a new navigation level
}
export interface Session {
  readonly id: ID;
  readonly projectId: ID;
  readonly title: string;
  readonly branchedFrom: { sessionId: ID; messageId: ID } | null;
}
export interface SessionScope { readonly projectId: ID; readonly sessionId: ID; }
export interface ExecutionScope extends SessionScope {
  readonly runtimeTargetId: ID;
  readonly directoryHandle: ID; // host-owned reference, not arbitrary cwd text
}
export interface Run extends SessionScope {
  readonly id: ID;
  readonly state: 'queued' | 'running' | 'awaiting-approval' | 'stopping' |
    'stopped' | 'completed' | 'failed';
  readonly modelSnapshot: { providerId: ID; modelId: ID; effort: string | null };
}
export interface ApprovalRequest extends SessionScope {
  readonly id: ID;
  readonly runId: ID;
  readonly commandSummary: string;
  readonly targetDigest: string; // binds action + scope + arguments
  readonly readScope: readonly string[];
  readonly writeScope: readonly string[];
  readonly expiresAt: string;
  readonly state: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
}

/** A normalized snapshot for ONE model request, never an incremental delta.
 * The ingestion adapter converts provider formats before constructing this.
 * cacheRead + cacheWrite <= inputTotal. outputTotal already includes reasoning
 * when the provider reports that inclusion. Keep cacheRead/cacheWrite separate.
 * Cache write buckets with differing rates must be priced separately by host.
 */
export interface UsageSnapshot extends SessionScope {
  readonly requestId: ID;
  readonly runId: ID;
  readonly providerId: ID;
  readonly modelId: ID;
  readonly inputTotal: Metric<number>;
  readonly cacheRead: Metric<number>;
  readonly cacheWrite: Metric<number>;
  readonly outputTotal: Metric<number>;
  readonly reasoningSubsetOfOutput: Metric<number>;
  readonly generationMs: Metric<number>; // model generation only; exclude tools
  readonly firstTokenLatencyMs: Metric<number>;
  readonly state: 'partial' | 'final';
  readonly pricing: PricingSnapshot | null;
  readonly normalizedCost: CostEstimate | null;
}
export interface PricingSnapshot {
  readonly id: ID;
  readonly providerId: ID;
  readonly modelId: ID;
  readonly validAt: string;
  readonly currency: string; // ISO 4217; no implicit currency conversion
  readonly source: 'provider-catalog' | 'user-configured' | 'fixture';
  readonly sourceReference: string;
  readonly units: 'per-million-tokens';
  readonly rates: readonly {
    readonly bucket: 'uncached-input' | 'cache-read' | 'cache-write' |
      'output' | 'separate-reasoning' | 'other';
    readonly amountDecimal: string; // decimal-safe calculation in host
    readonly scopeKey: string; // e.g. separate cache-write TTL buckets
  }[];
}
export interface CostEstimate {
  readonly amountDecimal: string;
  readonly currency: string;
  readonly pricingSnapshotId: ID;
  readonly kind: 'estimated' | 'provider-reported' | 'fixture';
  readonly coverage: 'complete' | 'partial';
  readonly excludedBuckets: readonly string[];
}
export interface ContextSnapshot extends SessionScope {
  readonly requestId: ID | null;
  readonly occupied: Metric<number>;
  readonly capacity: Metric<number>;
  // This is occupancy NOW. Never derive it from lifetime billable tokens.
}
export interface EventEnvelope<T> extends SessionScope {
  readonly eventId: ID;
  readonly streamId: ID;
  readonly sequence: number; // monotonic per stream
  readonly timestamp: string;
  readonly payload: T;
}
export type AgentEvent = EventEnvelope<
  { type: 'run'; value: Run } |
  { type: 'usage-snapshot'; value: UsageSnapshot } |
  { type: 'context-snapshot'; value: ContextSnapshot } |
  { type: 'approval'; value: ApprovalRequest } |
  { type: 'public-output'; runId: ID; text: string }
>;
// Deduplicate eventId, order by stream sequence, and replace usage by requestId.
// Do NOT add reconnect/replayed snapshots as new consumption. A request retry
// with a NEW requestId can carry its own real consumption, including failures.

export interface Capabilities {
  readonly terminal: boolean;
  readonly fileSelection: boolean;
  readonly notifications: boolean;
  readonly effortLevels: readonly string[]; // [] means omit effort control
  readonly contextMetrics: boolean;
  readonly material: 'web-css' | 'native-enhancement-verified';
}
export interface TerminalDescriptor extends ExecutionScope {
  readonly id: ID;
  readonly displayName: string;
  readonly state: 'starting' | 'running' | 'exited' | 'disconnected';
}
export interface TerminalLease {
  readonly terminal: TerminalDescriptor;
  readonly capabilityToken: string; // host-issued, scoped, short-lived; no logs
  readonly expiresAt: string;
}
export type TerminalOpenResult =
  | { status: 'ready'; lease: TerminalLease }
  | { status: 'needs-approval'; approval: ApprovalRequest }
  | { status: 'unavailable'; reason: string };
export interface TerminalEvent {
  readonly terminalId: ID;
  readonly sequence: number;
  readonly kind: 'output' | 'exit' | 'connection';
  readonly text: string;
}
export interface HostAdapter {
  readonly kind: 'browser-backend' | 'electron-preload';
  capabilities(): Promise<Capabilities>;
  submit(input: SessionScope & { text: string; referenceIds: readonly ID[];
    mode: 'plan' | 'read-only' | 'project-edit'; modelId: ID; effort: string | null
  }): Promise<Run>;
  subscribe(scope: SessionScope, afterSequence: number,
    callback: (event: AgentEvent) => void): Unsubscribe;
  // 'accepted' means stopping, not yet stopped. Wait for an authoritative event.
  stopRun(runId: ID): Promise<{ accepted: boolean }>;
  resolveApproval(input: { requestId: ID; targetDigest: string;
    decision: 'allow-once' | 'deny' }): Promise<{ accepted: boolean }>;
  requestTerminal(scope: ExecutionScope): Promise<TerminalOpenResult>;
  writeTerminal(input: { lease: TerminalLease; text: string }): Promise<void>;
  resizeTerminal(input: { lease: TerminalLease; cols: number; rows: number }): Promise<void>;
  subscribeTerminal(input: { lease: TerminalLease; afterSequence: number },
    callback: (event: TerminalEvent) => void): Unsubscribe;
  terminateTerminal(lease: TerminalLease): Promise<{ accepted: boolean }>;
}
/** UI-only state. Toggling dockVisible MUST NOT invoke terminateTerminal.
 * Agent-owned output is read-only; a user terminal has a separately granted
 * lease. Raw ipcRenderer, shell.exec and file paths are NOT exposed as APIs.
 */
export interface DockViewState {
  readonly visible: boolean;
  readonly height: number;
  readonly activeTerminalId: ID | 'agent-output';
  readonly inspectorVisible: boolean;
}

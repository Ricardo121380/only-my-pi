export interface ModelBudget { requests: number; concurrency: number; maxInputBytes: number; maxOutputBytes: number; inputBytes: number; outputBytes: number; timeoutMs: number }
export interface ClassifierChoice { id: string; name: string; supported: boolean; unavailableReason?: string; price: object | null }
export interface ClassifierBinding { accountId: string; model: string; budget: ModelBudget; choice?: ClassifierChoice }
export interface ClassifierConfig { revision: number; classifier: ClassifierBinding | null }
export interface ModelRequest { requestId: string; parentToolCallId: string; status: "reserved" | "dispatched" | "unknown" | "not_sent" | "completed" | "failed"; reservation: { inputBytes: number; outputBytes: number }; result?: { answers: Record<string, unknown> }; priceSnapshot?: { value: object | null; source: string; at: string; currency: string; hardLimit: boolean }; usage: { status: string; tokens: { input: number; output: number } | null; coverage?: { input: number | null; output: number | null }; estimatedCost: number | null }; error?: string }
export interface ModelTask { taskId: string; sessionId: string | null; snapshot: ClassifierConfig; requests: ModelRequest[] }
export interface ModelLedger { protocol: 1; config: ClassifierConfig; tasks: ModelTask[] }

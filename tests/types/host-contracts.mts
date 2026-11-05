import type { HostCommand, TaskStatus } from "../../packages/host/contracts.d.ts";
import type { AccountAction, StaticProvider } from "../../packages/accounts/contracts.d.ts";
import { llmProvider } from "../fixtures/account-provider-contract.mjs";
const configure: AccountAction = { type: "configure", config: llmProvider };
// @ts-expect-error Arbitrary model categories cannot enter account configuration.
const unknownModelType: StaticProvider["models"][number]["type"] = "speech";
const { maxTokens, ...withoutBudget } = llmProvider.models[0];
// @ts-expect-error Explicit chat models require an output token budget.
const unbudgetedLlm: StaticProvider = { ...llmProvider, models: [withoutBudget] };
const { type, ...implicitLlm } = withoutBudget;
// @ts-expect-error Omitting the category still means a chat model.
const unbudgetedDefault: StaticProvider = { ...llmProvider, models: [implicitLlm] };
const classifier: StaticProvider = { ...llmProvider, models: [{ ...withoutBudget, type: "classifier" }] };
const image: StaticProvider = { ...llmProvider, models: [{ ...withoutBudget, type: "image", output: ["image"] }] };
const request: HostCommand = { type: "startTask", requestId: "test", projectId: "project", accountId: "cli-readonly", model: "provider/model", prompt: "analyze" };
// @ts-expect-error Public M1 requests cannot ask for project writing.
const write: HostCommand = { ...request, permission: "write" };
// @ts-expect-error No arbitrary Pi RPC commands cross the browser boundary.
const rpc: HostCommand = { type: "bash", command: "echo unsafe" };
// @ts-expect-error Sent cancellation is not terminal cancellation.
const cancelled: TaskStatus = "cancel-request-sent";
void [request, write, rpc, cancelled, configure, unknownModelType, maxTokens, type, unbudgetedLlm, unbudgetedDefault, classifier, image];

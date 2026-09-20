import type { HostCommand, TaskStatus } from "../../packages/host/contracts.d.ts";
const request: HostCommand = { type: "startTask", requestId: "test", projectId: "project", model: "provider/model", prompt: "analyze" };
// @ts-expect-error Public M1 requests cannot ask for project writing.
const write: HostCommand = { ...request, permission: "write" };
// @ts-expect-error No arbitrary Pi RPC commands cross the browser boundary.
const rpc: HostCommand = { type: "bash", command: "echo unsafe" };
// @ts-expect-error Sent cancellation is not terminal cancellation.
const cancelled: TaskStatus = "cancel-request-sent";
void [request, write, rpc, cancelled];

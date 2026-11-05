import type { InputCommandV1, InputCommandResultV1 } from "../../packages/host/contracts.d.ts";
import { validateInputCommand, findInputReceipt } from "../../packages/host/input-protocol.mjs";
import { HostInputController } from "../../packages/host/input-controller.mjs";
const read: InputCommandV1 = { type: "getInputs", target: { projectId: "project", sessionKey: null } };
validateInputCommand(read);
// @ts-expect-error No browser history path or arbitrary RPC field.
const unsafe: InputCommandV1 = { type: "getInputs", target: { projectId: "project", path: "/tmp/history" } };
// @ts-expect-error Delivery proof is not untyped text matching.
findInputReceipt([], { inputId: "x", text: "same text" });
// @ts-expect-error Controller requires storage, tasks and catalog owners.
new HostInputController({ store: null });
void unsafe;
declare const inputs: InputCommandResultV1<typeof read>;
const revision: number = inputs.queue.revision;
// @ts-expect-error A read result is not a started task or a grant.
const taskId: string = inputs.taskId;
void revision; void taskId;

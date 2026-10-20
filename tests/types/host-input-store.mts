import { HostInputStore } from "../../packages/host/input-store.mjs";
import type { InputContentV1, InputScopeV1, QueueShardV1 } from "../../packages/host/contracts.d.ts";
const store = new HostInputStore({ configRoot: "/fixture" });
const scope: InputScopeV1 = { projectId: "project", sessionId: "session" };
const content: InputContentV1 = { inputId: "input", delivery: "queue", text: "task", materialSnapshotIds: [], binding: { accountId: "cli-readonly", modelId: "mock/test", thinking: "low", mode: "readonly", resourceRevision: 1 } };
const queue: Promise<QueueShardV1> = store.enqueue(scope, content, { expectedRevision: 0 });
// @ts-expect-error Storage bindings cannot persist an execution grant.
content.binding.grant = "forbidden";
// @ts-expect-error CAS is mandatory; a stale window must not overwrite implicitly.
store.saveDraft(scope, content, {});
// @ts-expect-error Mutation versions are numbers, not loosely parsed query strings.
store.editQueued(scope, content, { expectedRevision: "1", expectedInputRevision: 1 });
// @ts-expect-error SDK acceptance is not a terminal success state.
store.transition(scope, content.inputId, { expectedRevision: 1, expectedInputRevision: 1, state: "succeeded" });
void queue;

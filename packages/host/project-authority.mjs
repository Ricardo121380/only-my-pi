import fs from "node:fs/promises";
import path from "node:path";
import { readJsonObject } from "../config-runtime/index.mjs";
import { processIdentity, verifyOwnership, ownershipError } from "./ownership.mjs";
import { terminal } from "./contracts.mjs";

// Task IDs only locate the durable binding. A private bootstrap closure must
// also prove worker identity, live Host project ownership and session ownership.
export function hostProjectAuthority({ configRoot, taskId, sessionManager }) {
  return async (ctx) => {
    const project = await fs.realpath(ctx.cwd), sessionId = sessionManager.getSessionId();
    if (!process.connected || ctx.mode !== "rpc" || ctx.sessionManager.getSessionId() !== sessionId) throw ownershipError("PROJECT_OWNERSHIP_REQUIRED");
    const state = await readJsonObject(configRoot, path.join(configRoot, "only-my-pi/host/tasks.json"));
    const task = state.tasks.find((entry) => entry.taskId === taskId);
    if (!task || task.mode !== "controlled" || terminal(task.status) || task.status === "cancelling" || task.projectPath !== project || task.sessionId !== sessionId || task.worker?.pid !== process.pid || task.worker.start !== await processIdentity()) throw ownershipError("PROJECT_OWNERSHIP_REQUIRED");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(project).digest("hex");
    const owner = await readJsonObject(configRoot, path.join(configRoot, "only-my-pi/host/locks", `project-${digest}`, "owner.json"));
    if (owner.token !== task.projectOwnerToken) throw ownershipError("OWNERSHIP_LOST");
    await verifyOwnership(configRoot, "project", project, owner);
    const sessionDigest = createHash("sha256").update(sessionId).digest("hex");
    const sessionOwner = await readJsonObject(configRoot, path.join(configRoot, "only-my-pi/host/locks", `session-${sessionDigest}`, "owner.json"));
    if (sessionOwner.pid !== owner.pid || sessionOwner.identity !== owner.identity) throw ownershipError("OWNERSHIP_LOST");
    await verifyOwnership(configRoot, "session", sessionId, sessionOwner);
    return owner;
  };
}

#!/usr/bin/env node
// Browser acceptance fixture only; never packaged and never reachable via public Host commands.
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { startHost } from "../packages/host/server.mjs";
const parent = process.argv[2];
if (!path.isAbsolute(parent ?? "")) throw new Error("absolute evidence parent required");
const root = await fs.mkdtemp(path.join(parent, "web-fixture-"));
const project = path.join(root, "OMP-界面验收样例"), configRoot = path.join(root, "config"), sessions = path.join(configRoot, "sessions/fixture");
await fs.mkdir(project); await fs.mkdir(sessions, { recursive: true });
await fs.writeFile(path.join(project, "README.md"), "# 界面验收样例\n\n这是确定性浏览器验收数据，不调用真实模型。\n");
await fs.writeFile(path.join(project, "long.txt"), Array.from({ length: 3000 }, (_, i) => `baseline line ${i}`).join("\n"));
execFileSync("/usr/bin/git", ["init", "-q", project]); execFileSync("/usr/bin/git", ["-C", project, "add", "README.md"]);
execFileSync("/usr/bin/git", ["-C", project, "add", "long.txt"]);
await fs.appendFile(path.join(project, "README.md"), "\n只读工作台不会保存文件。\n");
const entries = [{ type: "session", id: "fixture-history", cwd: project, timestamp: "2026-09-20T00:00:00.000Z" }];
for (let i = 0; i < 10000; i++) entries.push({ type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null, message: { role: i === 1 ? "toolResult" : i % 2 ? "assistant" : "user", ...(i === 1 ? { toolName: "read" } : {}), content: [{ type: "text", text: i === 1 ? "x".repeat(5 * 1024 * 1024) : i % 2 ? "## 样例分析\n\n项目结构清晰，当前是只读历史。\n\n<script>alert(1)</script>\n![远程图片](https://invalid.example/tracker.png)" : `请分析第 ${i} 条记录` }] } });
await fs.writeFile(path.join(sessions, "history.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
class FixtureWorker extends EventEmitter {
  constructor() { super(); this.identity = { pid: 99999999, start: "browser-fixture" }; }
  async start() { return { sessionId: randomUUID() }; }
  async command(type, payload) {
    if (type === "prompt") {
      this.emit("event", { type: "message_end", message: { role: "user", content: [{ type: "text", text: payload.message }] } });
      let count = 0;
      this.timer = setInterval(() => {
        this.emit("event", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "只读分析样例。 " } });
        if (++count === 150) { clearInterval(this.timer); this.emit("event", { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "这是确定性 UI 验收样例，未调用真实模型。" }] } }); this.emit("event", { type: "agent_settled" }); }
      }, 100);
    }
    return {};
  }
  async cancel() { this.emit("event", { type: "agent_settled" }); await this.stop(); }
  async stop() { clearInterval(this.timer); if (!this.closed) { this.closed = true; this.emit("exit"); } }
}
const startup = performance.now();
const host = await startHost({ configRoot, assetsRoot: path.resolve("webui/dist"), stack: { stackId: "fixture-not-release" }, workerFactory: () => new FixtureWorker(), modelsProvider: async () => [{ id: "fixture/read-only", name: "确定性验收（非真实模型）", provider: "fixture" }] });
await host.catalog.add(project); await host.scan();
await fs.writeFile(path.join(root, "startup.json"), JSON.stringify({ status: "PASS", hostStartupAndInitialIndexMs: performance.now() - startup, hostRssBytes: process.memoryUsage().rss, platform: process.platform, arch: process.arch, node: process.version, sample: "10000 entries, 5MiB tool output, 3000-line diff", modelRequests: 0 }, null, 2));
await fs.writeFile(path.join(parent, "browser-fixture.json"), JSON.stringify({ root, project, origin: host.origin, pairingUrl: host.pairingUrl }), { mode: 0o600 });
console.log(JSON.stringify({ status: "ready", root, origin: host.origin }));
process.on("SIGTERM", async () => { await host.stop(); process.exit(0); });

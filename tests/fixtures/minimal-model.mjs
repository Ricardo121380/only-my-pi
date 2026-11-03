import http from "node:http";
import { randomUUID } from "node:crypto";

function chunk(res, delta, finish_reason = null) {
  res.write(`data: ${JSON.stringify({ id: "local", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
}
function finish(res, content) { chunk(res, { role: "assistant", content }); chunk(res, {}, "stop"); res.end("data: [DONE]\n\n"); }
function tool(res, name, args) {
  chunk(res, { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  chunk(res, {}, "tool_calls"); res.end("data: [DONE]\n\n");
}

// Deterministic loopback inference only; tools still execute in native Pi.
export async function startMinimalModel({ streamDelay = 700 } = {}) {
  const received = [], sockets = new Set(), timers = new Set();
  const provider = http.createServer(async (req, res) => {
    let text = ""; for await (const bytes of req) text += bytes;
    const body = JSON.parse(text), record = { body, closed: false }; received.push(record);
    res.once("close", () => { record.closed = true; });
    const last = body.messages.findLast(m => m.role === "user")?.content;
    const prompt = typeof last === "string" ? last : last?.filter(p => p.type === "text").map(p => p.text).join("\n") ?? "";
    if (prompt.includes("fail request")) { res.writeHead(503); res.end("local controlled failure"); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (prompt.includes("stop stream")) { chunk(res, { role: "assistant", content: "这是停止测试的部分回复，等待停止。" }); return; }
    if (body.messages.at(-1).role === "tool") {
      const lastTool = body.messages.at(-1);
      if ((prompt.includes("request write") || prompt.includes("request shell")) && JSON.stringify(lastTool.content).includes("CODING_ACCESS_GRANTED")) {
        if (prompt.includes("request shell")) tool(res, "bash", { command: 'echo $$ > shell.pid; sleep 60 & echo $! > child.pid; wait' });
        else tool(res, "write", { path: "approved.txt", content: "approved local write\n" });
        return;
      }
      chunk(res, { role: "assistant", content: "已收到工具结果。" });
      const timer = setTimeout(() => { timers.delete(timer); if (!res.destroyed) finish(res, "\n\n本地受控验证完成。可以展开工具卡查看输出。"); }, streamDelay);
      timers.add(timer); return;
    }
    if (prompt.includes("read project")) { tool(res, "read", { path: "README.md" }); return; }
    if (prompt.includes("request shell")) { tool(res, "request_coding_access", { taskSummary: "在隔离项目启动可停止的等待命令", complexity: "simple", scope: ["shell.pid", "child.pid"], riskFlags: [], verification: ["停止后核对 shell 与 sleep 子进程均退出"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } }); return; }
    if (prompt.includes("request write")) { tool(res, "request_coding_access", { taskSummary: "在当前临时项目写入 approved.txt", complexity: "simple", scope: ["approved.txt"], riskFlags: [], verification: ["读取文件确认内容"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } }); return; }
    if (prompt.includes("deny write")) { tool(res, "write", { path: "forbidden.txt", content: "forbidden" }); return; }
    finish(res, "继续会话成功，已接收之前的原生历史。");
  });
  provider.on("connection", s => { sockets.add(s); s.once("close", () => sockets.delete(s)); });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  let stopping;
  return { received, baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, stop: () => stopping ??= (async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => provider.close(resolve));
  })() };
}

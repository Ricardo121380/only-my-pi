import fs from "node:fs/promises";
import path from "node:path";

export async function delayClassifierPreparation(f) {
  const original = path.join(path.dirname(f.sdk), "index-before-classifier-clock.js");
  await fs.rename(f.sdk, original);
  await fs.writeFile(f.sdk, `export * from "./index-before-classifier-clock.js";
import { ModelRuntime } from "./index-before-classifier-clock.js";
const classify = ModelRuntime.prototype.classify;
ModelRuntime.prototype.classify = async function (model, ...args) {
  if (model.provider === "fixtureclass") await new Promise(resolve => setTimeout(resolve, 1200));
  return classify.call(this, model, ...args);
};
`);
}

export async function installClassifierFailureClock(f) {
  await delayClassifierPreparation(f);
  const clock = path.join(f.root, "classifier-clock"), trace = path.join(f.root, "classifier-deadlines.jsonl");
  await fs.writeFile(clock, "0");
  // Only this copied worker's 1000ms model timers use controlled time. Real
  // Pi, dispatch, HTTP, receipts, cancellation and the 35s test deadline remain.
  await fs.appendFile(f.sdk, `
import fs from "node:fs";
const nativeTimeout = AbortSignal.timeout, deadlines = new Set();
const clockFile = ${JSON.stringify(clock)}, traceFile = ${JSON.stringify(trace)};
const elapsed = () => Number(fs.readFileSync(clockFile, "utf8"));
const record = event => fs.appendFileSync(traceFile, JSON.stringify(event) + "\\n");
const expire = controller => {
  controller.abort(new DOMException("Controlled model deadline elapsed", "TimeoutError"));
  record({ type: "expired", at: elapsed() }); deadlines.delete(controller);
};
AbortSignal.timeout = function (ms) {
  if (ms !== 1000) return nativeTimeout(ms);
  const controller = new AbortController(); deadlines.add(controller);
  record({ type: "registered", timeoutMs: ms });
  if (elapsed() >= ms) expire(controller);
  return controller.signal;
};
const clockPoll = setInterval(() => {
  if (elapsed() >= 1000) { for (const controller of deadlines) expire(controller); clearInterval(clockPoll); }
}, 10);
clockPoll.unref();
`);
  return { expire: () => fs.writeFile(clock, "1000"),
    observations: async () => (await fs.readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse) };
}

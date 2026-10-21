import readline from "node:readline";
import { Writable } from "node:stream";

// Terminal-only authentication input: no echo, readline history or value in
// errors. Callers retain ownership of cancellation and the authentication flow.
export function secretInput(input, output, controller, fromStdin, fail) {
  if (!fromStdin && !input.isTTY) throw fail("SECRET_TTY_OR_STDIN_REQUIRED");
  const silent = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const lines = readline.createInterface({ input, output: silent, terminal: Boolean(input.isTTY), historySize: 0 });
  lines.on("SIGINT", () => controller.abort());
  const queue = [];
  let waiting, ended = false, invalid = false;
  lines.on("line", value => {
    if (Buffer.byteLength(value) > 16384 || queue.length >= 32) { invalid = true; controller.abort(); return; }
    if (waiting) waiting(value); else queue.push(value);
  });
  lines.on("close", () => { ended = true; waiting?.(undefined); });
  return {
    async read(label, promptSignal) {
      if (!fromStdin) output.write(`${label} (hidden; Ctrl+C cancels): `);
      let abort, expire;
      try {
        if (controller.signal.aborted) throw fail("AUTH_CANCELLED", 409);
        if (promptSignal?.aborted) throw fail("AUTH_FLOW_EXPIRED", 409);
        const value = queue.length ? queue.shift() : ended ? undefined : await new Promise((resolve, reject) => {
          waiting = resolve;
          abort = () => reject(fail(invalid ? "INPUT_INVALID" : "AUTH_CANCELLED", 409));
          expire = () => reject(fail("AUTH_FLOW_EXPIRED", 409));
          controller.signal.addEventListener("abort", abort, { once: true });
          promptSignal?.addEventListener("abort", expire, { once: true });
        });
        if (typeof value !== "string" || !value) throw fail("INPUT_INVALID");
        return value;
      } finally {
        waiting = undefined;
        if (abort) controller.signal.removeEventListener("abort", abort);
        if (expire) promptSignal?.removeEventListener("abort", expire);
        if (!fromStdin) output.write("\n");
      }
    },
    close() { lines.close(); silent.end(); },
  };
}

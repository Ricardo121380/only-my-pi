import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { AccountCatalog } from "./accounts.mjs";
import { accountAuth } from "./account-auth.mjs";
import { AccountOAuth } from "./account-oauth.mjs";
import { listModels } from "./models.mjs";
import { CLI_ACCOUNT_ID, hostError } from "./contracts.mjs";

export const ACCOUNT_USAGE = `omp account list
omp account add --provider ID --name NAME --auth api_key|oauth
omp account configure ACCOUNT /absolute/provider.json
omp account models ACCOUNT
omp account login ACCOUNT [--stdin] [--timeout-ms 300000]
omp account status ACCOUNT
omp account logout ACCOUNT
omp account rename ACCOUNT NAME
omp account remove ACCOUNT
omp --account ACCOUNT --model PROVIDER/MODEL [task]
API keys and OAuth answers use hidden terminal input or --stdin, never arguments.
Product accounts remain separate from cli-readonly (the original Pi configuration).
Login does not grant coding or tool permissions.`;

function secretInput(input, output, controller, fromStdin) {
  if (!fromStdin && !input.isTTY) throw hostError("ACCOUNT_SECRET_TTY_OR_STDIN_REQUIRED");
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
        if (controller.signal.aborted) throw hostError("ACCOUNT_AUTH_CANCELLED", 409);
        if (promptSignal?.aborted) throw hostError("ACCOUNT_AUTH_FLOW_EXPIRED", 409);
        const value = queue.length ? queue.shift() : ended ? undefined : await new Promise((resolve, reject) => {
          waiting = resolve;
          abort = () => reject(hostError(invalid ? "ACCOUNT_INPUT_INVALID" : "ACCOUNT_AUTH_CANCELLED", 409));
          expire = () => reject(hostError("ACCOUNT_AUTH_FLOW_EXPIRED", 409));
          controller.signal.addEventListener("abort", abort, { once: true });
          promptSignal?.addEventListener("abort", expire, { once: true });
        });
        if (typeof value !== "string" || !value) throw hostError("ACCOUNT_INPUT_INVALID");
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

export async function runAccountCli({ argv, configRoot, resolveStack, env = process.env, stdin = process.stdin, stderr = process.stderr }) {
  const catalog = new AccountCatalog(configRoot), [command, ...args] = argv;
  if ((!command || command === "help") && !args.length) return { usage: ACCOUNT_USAGE };
  if (command === "list" && !args.length) return { accounts: [
    { accountId: CLI_ACCOUNT_ID, name: "CLI default (original Pi configuration)", source: "original_pi", readOnly: true },
    ...(await catalog.list()).map(account => ({ ...account, source: "product", readOnly: false })),
  ] };
  if (command === "add") {
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--provider", "--name", "--auth"].includes(args[i]) || values[args[i]] !== undefined || typeof args[i + 1] !== "string") throw hostError("ACCOUNT_COMMAND_USAGE");
      values[args[i]] = args[i + 1];
    }
    return catalog.create({ providerId: values["--provider"], name: values["--name"], authType: values["--auth"] });
  }
  const [accountId] = args;
  if (command === "rename" && args.length === 2) return catalog.rename(accountId, args[1]);
  if (command === "remove" && args.length === 1) return catalog.remove(accountId);
  if (command === "configure" && args.length === 2 && path.isAbsolute(args[1])) {
    const stat = await fs.lstat(args[1]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw hostError("ACCOUNT_PROVIDER_INVALID");
    let config;
    try { config = JSON.parse(await fs.readFile(args[1], "utf8")); } catch { throw hostError("ACCOUNT_PROVIDER_INVALID"); }
    return catalog.configure(accountId, config);
  }
  if (["status", "logout", "models"].includes(command) && args.length === 1) {
    const release = command === "models" ? await catalog.beginUse(accountId) : undefined;
    try {
      const stack = await resolveStack();
      if (command === "models") return { models: await listModels({ stack, configRoot, accountId, env }) };
      return accountAuth({ stack, configRoot, accounts: catalog, accountId, input: { type: command }, env });
    } finally { await release?.(); }
  }
  if (command !== "login" || !accountId) throw hostError("ACCOUNT_COMMAND_USAGE");
  let fromStdin = false, timeoutMs = 300000;
  const flags = new Set();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flags.has(flag) || !["--stdin", "--timeout-ms"].includes(flag)) throw hostError("ACCOUNT_COMMAND_USAGE");
    flags.add(flag);
    if (flag === "--stdin") fromStdin = true;
    else { timeoutMs = Number(args[++i]); if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) throw hostError("ACCOUNT_COMMAND_USAGE"); }
  }
  const account = await catalog.get(accountId), stack = await resolveStack();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  let input, oauth, timer;
  try {
    input = secretInput(stdin, stderr, controller, fromStdin);
    if (account.authType === "api_key") {
      let timedOut = false;
      timer = setTimeout(() => { if (!controller.signal.aborted) { timedOut = true; cancel(); } }, timeoutMs);
      try {
        return await accountAuth({ stack, configRoot, accounts: catalog, accountId, input: { type: "apiKey" },
          readSecret: () => input.read("API Key"), env, signal: controller.signal });
      } catch (error) {
        if (timedOut && error.code === "ACCOUNT_AUTH_CANCELLED") return { status: "timed_out" };
        throw error;
      }
    }
    oauth = new AccountOAuth({ stack, configRoot, accounts: catalog, env, timeoutMs });
    const flow = await oauth.start(accountId);
    let lastEvent;
    while (oauth.running) {
      if (controller.signal.aborted) { await oauth.cancel(flow.flowId); break; }
      const state = oauth.snapshot(flow.flowId);
      if (state.event && JSON.stringify(state.event) !== lastEvent) {
        lastEvent = JSON.stringify(state.event);
        // Only the authentication interaction is displayed on the terminal;
        // answers, callbacks and tokens never enter JSON status or history.
        stderr.write(`Open in your browser: ${state.event.url}\n`);
        if (state.event.type === "device_code") stderr.write(`Device code: ${state.event.userCode}\n`);
      }
      if (state.prompt) {
        if (state.prompt.type === "select") stderr.write(`${state.prompt.options.map(option => `${option.id}: ${option.label}`).join("\n")}\n`);
        const answerController = new AbortController();
        const check = setInterval(() => {
          const current = oauth.snapshot(flow.flowId);
          if (current.prompt?.promptId !== state.prompt.promptId || ["timed_out", "failed", "cancelled"].includes(current.status)) answerController.abort();
        }, 20);
        try {
          const value = await input.read("OAuth response", answerController.signal);
          oauth.answer(flow.flowId, state.prompt.promptId, value);
        } catch (error) {
          if (error.code !== "ACCOUNT_AUTH_FLOW_EXPIRED") throw error;
        } finally { clearInterval(check); }
      } else await new Promise(resolve => setTimeout(resolve, 20));
    }
    await oauth.running?.catch(() => {});
    return { status: oauth.snapshot(flow.flowId).status };
  } finally {
    clearTimeout(timer); input?.close(); await oauth?.stop();
    process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
  }
}

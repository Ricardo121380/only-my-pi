import { createNodeExecAdapter } from "../project-gates/index.mjs";

// Public Pi BashOperations seam, backed by OMP's shared execution registry.
// A shell's exit is not proof that its background process group has exited.
/** @returns {import("@earendil-works/pi-coding-agent").BashOperations} */
export function createOwnedBashOperations({ exec = createNodeExecAdapter({ maxOutputBytes: 5 * 1024 * 1024 }) } = {}) {
  return {
    async exec(command, cwd, { onData, signal, timeout, env }) {
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483)) throw new Error("SHELL_TIMEOUT_INVALID");
      const result = await exec("/bin/bash", ["-c", command], { cwd, env, signal, onData, timeout: timeout === undefined ? undefined : timeout * 1000 });
      if (result.terminationUnconfirmed) throw new Error("SHELL_TERMINATION_UNCONFIRMED");
      if (result.killed || !result.started) throw new Error(`SHELL_${String(result.reason ?? "failed").replaceAll("-", "_").toUpperCase()}`);
      return { exitCode: result.code };
    },
  };
}

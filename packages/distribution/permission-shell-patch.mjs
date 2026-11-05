// Build-time adapter for pinned pi-permission-modes 2.2.0. Permission policy
// and sandbox wrapping stay upstream-owned. OMP owns shell execution and the
// per-call approval of its admitted MCP handlers; explicit upstream denial wins.
function once(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before))
    throw new Error("permission shell patch anchor differs");
  return text.replace(before, after);
}

export function patchPermissionShellIndex(text) {
  text = once(text, "  const localBash = createBashTool(root);", `  const localBash = createBashTool(root);
  let ownedBash: import("@earendil-works/pi-coding-agent").BashOperations | undefined;
  let ownedProduct: ((name: string) => boolean) | undefined;
  let ownedMcp: ((name: string) => boolean) | undefined;
  let ownedCodemode: ((name: string, parent?: string) => boolean) | undefined;
  pi.events.on("only-my-pi:owned-product:v1", (payload: any) => {
    if (typeof payload?.admits === "function") ownedProduct = payload.admits;
  });
  pi.events.on("only-my-pi:owned-mcp:v1", (payload: any) => {
    if (typeof payload?.admits === "function") ownedMcp = payload.admits;
  });
  pi.events.on("only-my-pi:owned-codemode:v1", (payload: any) => {
    if (typeof payload?.admits === "function") ownedCodemode = payload.admits;
  });
  pi.events.on("only-my-pi:owned-shell:v1", (payload: any) => {
    if (typeof payload?.operations?.exec === "function" && typeof payload?.accept === "function") {
      ownedBash = payload.operations;
      payload.accept();
    }
  });`);
  text = once(text, "      const approved = approvedUnsandboxed.delete(id); // user granted an escape", `      if (process.env.ONLY_MY_PI_DIRECT === "1" && !ownedBash) throw new Error("OWNED_SHELL_UNAVAILABLE");
      const approved = approvedUnsandboxed.delete(id); // user granted an escape`);
  text = once(text, "sandbox.bashOps({ readOnly: plan.readOnly })", "sandbox.bashOps({ readOnly: plan.readOnly, operations: ownedBash })");
  text = once(text, '      if (action === "deny") return { block: true, reason: `Tool "${toolName}" blocked by ${m.label}` };',
    '      if (action === "deny") return { block: true, reason: `Tool "${toolName}" blocked by ${m.label}` };\n      if (action === "ask" && (ownedMcp?.(toolName) || ownedCodemode?.(toolName, event.parentToolCallId) || toolName === "context_snapshot" && ownedProduct?.(toolName))) return undefined; // OMP handlers own finite per-call approval.');
  return once(text, "      if (!ops) return localBash.execute(id, params, signal, onUpdate);",
    "      if (!ops) return (ownedBash ? createBashTool(root, { operations: ownedBash }) : localBash).execute(id, params, signal, onUpdate);");
}

export function patchPermissionShellSandbox(text) {
  text = once(text, "  drainBlockedHosts?: () => string[],\n): BashOperations", "  drainBlockedHosts?: () => string[],\n  operations?: BashOperations,\n): BashOperations");
  text = once(text, "    async exec(command, cwd, { onData, signal, timeout }) {", "    async exec(command, cwd, { onData, signal, timeout, env }) {");
  text = once(text, "        // `await` so the finally runs after the child exits, not after the", `        if (operations) {
          try { return await operations.exec(wrapped, cwd, { onData, signal, timeout, env }); }
          finally { emitBlockedHint(); }
        }
        // \`await\` so the finally runs after the child exits, not after the`);
  text = once(text, "bashOps(opts: { readOnly?: boolean } = {})", "bashOps(opts: { readOnly?: boolean; operations?: BashOperations } = {})");
  return once(text, "createSandboxedBashOps(this.manager, customConfig, this.drainBlockedHosts)",
    "createSandboxedBashOps(this.manager, customConfig, this.drainBlockedHosts, opts.operations)");
}

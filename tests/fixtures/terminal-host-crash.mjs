import { HostTerminals } from "../../packages/host/terminals.mjs";
const [configRoot, project] = process.argv.slice(2);
const manager = new HostTerminals({ configRoot, catalog: { project: () => ({ path: project }) }, env: { PATH: "/usr/bin:/bin" } });
await manager.load();
const terminal = await manager.open("p", 80, 24);
const entry = manager.get(terminal.terminalId);
// The test waits for the shell prompt, then kills this fixture Host only.
const timer = setInterval(() => {
  if (!entry.output.includes("%")) return;
  clearInterval(timer);
  process.send({ terminalId: terminal.terminalId, supervisor: entry.pty.pid });
}, 30);

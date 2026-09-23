import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TerminalPane from "./TerminalPane";
import type { TerminalState } from "../../packages/host/contracts";
const mock = vi.hoisted(() => ({ data: (_data: string) => {}, output: "", calls: [] as Record<string, unknown>[], failInput: false }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24; parser = { registerOscHandler: () => ({ dispose() {} }) };
  loadAddon() {} open() {} reset() {} dispose() {} writeln() {}
  write(data: string, done: () => void) { mock.output += data; done(); }
  onData(listener: (data: string) => void) { mock.data = listener; return { dispose() {} }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); mock.calls = []; mock.output = ""; mock.failInput = false; });
it("reattaches output without reopening, pauses ambiguous input and keeps close separate from view removal", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let state: TerminalState = { terminalId: "t", projectId: "p", status: "running", cols: 80, rows: 24, inputSeq: 4, exitCode: null, error: null };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/terminals") return { ok: true, json: async () => ({ terminals: [state] }) };
    if (url.startsWith("/api/terminal?")) return { ok: true, json: async () => ({ ...state, base: 0, end: 6, truncated: false, output: url.includes("offset=0") ? "prompt" : "" }) };
    const input = JSON.parse(init!.body as string); mock.calls.push(input);
    if (input.type === "writeTerminal" && mock.failInput) throw Error("connection lost");
    if (input.type === "closeTerminal") state = { ...state, status: "closed" };
    return { ok: true, json: async () => state };
  }));
  const view = render(<TerminalPane projectId="p" />);
  await waitFor(() => expect(mock.output).toBe("prompt"));
  expect(mock.calls).toEqual([]);
  mock.failInput = true; mock.data("echo hello\r");
  await screen.findByRole("alert");
  mock.data("echo must-not-send\r");
  expect(mock.calls.filter((item) => item.type === "writeTerminal")).toEqual([{ type: "writeTerminal", terminalId: "t", seq: 5, data: "echo hello\r" }]);
  fireEvent.click(screen.getByText("结束终端"));
  expect(mock.calls.some((item) => item.type === "closeTerminal")).toBe(false);
  fireEvent.click(screen.getByText("继续运行"));
  view.unmount();
  expect(mock.calls.some((item) => item.type === "closeTerminal")).toBe(false);
});

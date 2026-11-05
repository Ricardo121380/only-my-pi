import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileBrowser, ProjectDiff } from "./Workspace";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let read: (url: URL, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
  read = async url => url.pathname === "/api/files" ? json({ entries: [{ name: "src", path: "src", directory: true }, { name: "README.md", path: "README.md", directory: false }], truncated: false }) : json({ path: url.searchParams.get("path"), text: "file content", bytes: 12, version: "sha256:fixture" });
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => read(new URL(input, "http://fixture"), init)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads directories on expansion, previews real responses and never writes a command", async () => {
  read = async url => url.pathname === "/api/files" ? json({ entries: url.searchParams.get("path") === "src" ? [{ name: "total.mjs", path: "src/total.mjs", directory: false }] : [{ name: "src", path: "src", directory: true }], truncated: false }) : json({ path: "src/total.mjs", text: "export const total = 597;", bytes: 25, version: "sha256:fixture" });
  render(<FileBrowser projectId="one" connected request={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "展开 src" }));
  fireEvent.click(await screen.findByRole("button", { name: "查看 src/total.mjs" }));
  await screen.findByText("export const total = 597;");
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("projectId=one"))).toBe(true);
});

it("a late preview cannot replace a newly selected tool target and binary errors clear old content", async () => {
  let finish!: (value: Response) => void;
  read = async url => url.pathname === "/api/files" ? json({ entries: [], truncated: false }) : url.searchParams.get("path") === "slow.txt" ? new Promise(resolve => { finish = resolve; }) : url.searchParams.get("path") === "binary.bin" ? json({ code: "BINARY_PREVIEW_UNAVAILABLE" }, 415) : json({ path: "current.txt", text: "current response", bytes: 16, version: "sha256:fixture" });
  const view = render(<FileBrowser projectId="one" connected request={{ projectId: "one", path: "slow.txt", nonce: "a" }} />);
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(<FileBrowser projectId="one" connected request={{ projectId: "one", path: "current.txt", nonce: "b" }} />);
  await screen.findByText("current response");
  await act(async () => finish(json({ path: "slow.txt", text: "stale response", bytes: 14, version: "sha256:old" })));
  expect(screen.queryByText("stale response")).toBeNull();
  view.rerender(<FileBrowser projectId="one" connected request={{ projectId: "one", path: "binary.bin", nonce: "c" }} />);
  await screen.findByText("二进制文件不支持文本预览。");
  expect(screen.queryByText("current response")).toBeNull();
});

it("project changes abort old reads and disconnect never sends another read", async () => {
  let finish!: (value: Response) => void;
  read = async url => url.pathname === "/api/files" ? json({ entries: [], truncated: false }) : url.searchParams.get("projectId") === "one" ? new Promise(resolve => { finish = resolve; }) : json({ path: "same.txt", text: "second project", bytes: 14, version: "sha256:second" });
  const view = render(<FileBrowser key="one" projectId="one" connected request={{ projectId: "one", path: "same.txt", nonce: "a" }} />);
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(<FileBrowser key="two" projectId="two" connected request={{ projectId: "two", path: "same.txt", nonce: "b" }} />);
  await screen.findByText("second project");
  await act(async () => finish(json({ path: "same.txt", text: "first project late", bytes: 18, version: "sha256:old" })));
  expect(screen.queryByText("first project late")).toBeNull();
  const before = vi.mocked(fetch).mock.calls.length;
  view.rerender(<FileBrowser key="two" projectId="two" connected={false} request={{ projectId: "two", path: "same.txt", nonce: "b" }} />);
  expect((screen.getByRole("button", { name: "刷新项目文件" }) as HTMLButtonElement).disabled).toBe(true);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(before);
});

it("Git changes show server diff, explicit refresh, scope and unavailable state", async () => {
  read = async () => json({ available: true, text: "diff --git a/a b/a\n+actual change", truncated: false });
  render(<ProjectDiff projectId="one" connected />);
  await screen.findByLabelText("Git diff");
  screen.getByText("暂存和未暂存改动；不含未跟踪文件及排除文件。");
  read = async () => json({ available: false, text: "", code: "GIT_DIFF_UNAVAILABLE_OR_TOO_LARGE" });
  fireEvent.click(screen.getByRole("button", { name: "刷新差异" }));
  await screen.findByText("无法读取 Git 差异"); expect(screen.queryByLabelText("Git diff")).toBeNull();
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { startDevWeb } from "./dev-web.mjs";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const payloadRoot = path.dirname(appRoot);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));

export async function verifyWebPreview({ full = false } = {}) {
  const manifest = await readJson(path.join(payloadRoot, "preview-manifest.json"));
  if (manifest.kind !== "only-my-pi-webui-preview-v1" || manifest.platform !== "darwin-arm64" || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit)) throw new Error("Invalid WebUI preview identity");
  if (process.platform !== "darwin" || process.arch !== "arm64" || process.version !== "v24.19.0") throw new Error("This preview requires native macOS Apple Silicon and its bundled Node 24.19.0");
  if (await fs.realpath(process.execPath) !== await fs.realpath(path.join(payloadRoot, "node/bin/node"))) throw new Error("Start this preview with ./start.command to use its bundled runtime");
  const files = full ? Object.keys(manifest.files) : manifest.startupFiles;
  for (const name of files) {
    if (path.isAbsolute(name) || name.split("/").includes("..")) throw new Error("Unsafe preview manifest path");
    const file = path.join(payloadRoot, name), expected = manifest.files[name];
    if (expected.sha256 && sha256(await fs.readFile(file)) !== expected.sha256) throw new Error(`Preview content changed: ${name}`);
    if (expected.link && await fs.readlink(file) !== expected.link) throw new Error(`Preview link changed: ${name}`);
  }
  const pi = await readJson(path.join(appRoot, "node_modules/@earendil-works/pi-coding-agent/package.json"));
  if (pi.version !== "1.5.0" || manifest.pi !== pi.version) throw new Error("Preview Pi version differs from its manifest");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--data-dir" && args[i + 1]) options.dataDir = args[++i];
      else if (args[i] === "--port" && /^\d+$/u.test(args[i + 1] ?? "")) options.port = Number(args[++i]);
      else if (!["--check", "--help"].includes(args[i])) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    const manifest = await verifyWebPreview({ full: args.includes("--check") });
    if (args.includes("--check")) console.log(JSON.stringify({ verified: true, preview: manifest.version, sourceCommit: manifest.sourceCommit, node: process.version, pi: manifest.pi, platform: manifest.platform, files: Object.keys(manifest.files).length }));
    else if (args.includes("--help")) console.log("./start.command [--data-dir /absolute/path] [--port 4317]\n在浏览器打开启动后显示的配对链接；输入 pair 生成新链接，stop 或 Ctrl+C 停止。\n账号在 WebUI 设置中添加，仅使用 DeepSeek。数据目录保留在本机。使用 --check 校验全部文件。");
    else {
      options.dataDir ??= path.join(os.homedir(), "Library/Application Support/OnlyMyPi/WebUI Preview", manifest.version);
      let input, closing;
      const closeInput = () => { input?.close(); process.stdin.pause(); };
      const ready = startDevWeb({ ...options, frontend: "b2", watch: false, prebuiltAssets: path.join(appRoot, "webui-preview-assets"), onStopped: result => { console.log(JSON.stringify(result)); closeInput(); } });
      const stop = () => closing ??= (async () => { try { await (await ready).stop(); } catch (error) { console.error(error.message); process.exitCode = 1; } finally { closeInput(); } })();
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      const app = await ready;
      if (!closing) {
        console.log(JSON.stringify({ preview: manifest.version, pid: process.pid, origin: app.host.origin, pairingUrl: app.host.pairingUrl, dataDir: app.dataDir, configRoot: app.configRoot }));
        console.log("WebUI 已启动。请打开上面的配对链接。输入 pair 获取新链接，stop 或 Ctrl+C 停止；数据保留。");
        input = createInterface({ input: process.stdin });
        input.on("line", line => {
          if (line.trim() === "stop") void stop();
          if (line.trim() === "pair" && !closing) void fetch(app.host.origin + "/internal/pair", { method: "POST", headers: { authorization: `Bearer ${app.host.controlToken}` } }).then(async response => {
            if (!response.ok) throw new Error("Pair link unavailable"); console.log(JSON.stringify(await response.json()));
          }).catch(error => console.error(error.message));
        });
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

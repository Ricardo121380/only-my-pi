import path from "node:path";
import { pathToFileURL } from "node:url";
const [stackRoot, configRoot] = process.argv.slice(2);
try {
  if (![stackRoot, configRoot].every((p) => typeof p === "string" && path.isAbsolute(p))) throw new Error("invalid runtime paths");
  const { ModelRuntime } = await import(pathToFileURL(path.join(stackRoot, "pi/dist/index.js")).href);
  const runtime = await ModelRuntime.create({ authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"),
    modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json"), allowModelNetwork: false });
  const models = runtime.getAvailableSnapshot().map((m) => ({ id: `${m.provider}/${m.id}`, name: String(m.name ?? m.id).slice(0, 256), provider: m.provider }));
  process.stdout.write(JSON.stringify({ models }) + "\n");
} catch { process.stdout.write(JSON.stringify({ code: "MODEL_CATALOG_UNAVAILABLE" }) + "\n"); process.exitCode = 1; }

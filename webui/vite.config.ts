import { defineConfig } from "vitest/config";
import fs from "node:fs/promises";
import path from "node:path";
function dependencyNotices() {
  return { name: "omp-frontend-notices", async generateBundle() {
    const packages = new Map<string, { name: string; version: string; license: string; notice: string }>();
    for (const id of this.getModuleIds()) {
      if (!id.includes("/node_modules/")) continue;
      let root = path.dirname(id.split("?")[0]);
      while (root.includes("/node_modules/")) {
        const manifest = await fs.readFile(path.join(root, "package.json"), "utf8").then(JSON.parse).catch(() => null);
        if (manifest?.name && manifest.version) {
          const key = `${manifest.name}@${manifest.version}`;
          if (!packages.has(key)) {
            const names = await fs.readdir(root), license = names.find((name) => /^licen[cs]e(?:\.md|\.txt)?$/i.test(name));
            if (!license || typeof manifest.license !== "string") throw new Error(`Missing frontend license: ${key}`);
            packages.set(key, { name: manifest.name, version: manifest.version, license: manifest.license, notice: await fs.readFile(path.join(root, license), "utf8") });
          }
          break;
        }
        root = path.dirname(root);
      }
    }
    const records = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.emitFile({ type: "asset", fileName: "dependencies.json", source: JSON.stringify(records.map(({ notice, ...record }) => record), null, 2) + "\n" });
    this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: records.map((record) => `${record.name}@${record.version} (${record.license})\n\n${record.notice}`).join("\n\n--------------------\n\n") });
  } };
}
export default defineConfig({ root: "webui", plugins: [dependencyNotices()], build: { outDir: "dist", emptyOutDir: true, target: "es2022" }, test: { environment: "jsdom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } });

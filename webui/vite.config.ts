import { defineConfig } from "vitest/config";
import fs from "node:fs/promises";
import path from "node:path";
type NoticeContext = {
  getModuleIds(): Iterable<string>;
  emitFile(asset: { type: "asset"; fileName: string; source: string }): unknown;
};
type NoticeSupplement = { license: string; file: string; source: string };
export function dependencyNotices(supplements: Record<string, NoticeSupplement> = {}) {
  return { name: "omp-frontend-notices", async generateBundle(this: NoticeContext) {
    const packages = new Map<string, { name: string; version: string; license: string; notice: string; noticeSource?: string }>();
    const missing = new Set<string>();
    for (const id of this.getModuleIds()) {
      if (!id.includes("/node_modules/")) continue;
      let root = path.dirname(id.split("?")[0]);
      while (root.includes("/node_modules/")) {
        const manifest = await fs.readFile(path.join(root, "package.json"), "utf8").then(JSON.parse).catch(() => null);
        if (manifest?.name && manifest.version) {
          const key = `${manifest.name}@${manifest.version}`;
          if (!packages.has(key)) {
            const names = await fs.readdir(root), license = names.find((name) => /^licen[cs]e(?:\.md|\.txt)?$/i.test(name));
            const supplement = supplements[key];
            if (typeof manifest.license !== "string" || (!license && supplement?.license !== manifest.license)) missing.add(key);
            else packages.set(key, { name: manifest.name, version: manifest.version, license: manifest.license,
              notice: await fs.readFile(license ? path.join(root, license) : supplement.file, "utf8"),
              ...(!license ? { noticeSource: supplement.source } : {}) });
          }
          break;
        }
        root = path.dirname(root);
      }
    }
    if (missing.size) throw new Error(`Missing frontend licenses: ${[...missing].sort().join(", ")}`);
    const records = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.emitFile({ type: "asset", fileName: "dependencies.json", source: JSON.stringify(records.map(({ notice, ...record }) => record), null, 2) + "\n" });
    this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: records.map((record) => `${record.name}@${record.version} (${record.license})\n\n${record.notice}`).join("\n\n--------------------\n\n") });
  } };
}
export default defineConfig(({ mode }) => {
  const input: Record<string, string> = mode === "minimal" ? { minimal: path.resolve("webui/minimal.html") } : { main: path.resolve("webui/index.html"), minimal: path.resolve("webui/minimal.html") };
  return { root: "webui", plugins: [dependencyNotices()], build: { outDir: "dist", emptyOutDir: true, target: "es2022", rollupOptions: { input } }, test: { environment: "jsdom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } };
});

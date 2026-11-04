import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dependencyNotices } from "../webui/vite.config.ts";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "host" ? [dependencyNotices({
    "react-remove-scroll-bar@2.3.8": {
      license: "MIT", file: path.resolve(import.meta.dirname, "notices/react-remove-scroll-bar-LICENSE.txt"),
      source: "https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE",
    },
  })] : [])],
  resolve: { dedupe: ["react", "react-dom"], alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: mode === "host" ? { outDir: "dist-host", target: "es2022", rollupOptions: { input: { minimal: path.resolve(import.meta.dirname, "minimal.html") } } } : {},
}));

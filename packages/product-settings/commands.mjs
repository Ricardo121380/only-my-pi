import fs from "node:fs/promises";
import path from "node:path";
import { ProductSettings, settingsError, taskSettingsSnapshot } from "./catalog.mjs";

export const SETTINGS_USAGE = `omp settings list [--project /absolute/project]
omp settings set RESOURCE --revision N [--enabled true|false] [--parameters '{"label":"ctx"}'] [--project /absolute/project]
omp settings reset RESOURCE --revision N --project /absolute/project
omp settings preview /absolute/SKILL.md [--project /absolute/project]
omp settings import /absolute/SKILL.md --revision N --digest SHA256 [--project /absolute/project]
Skills require frontmatter name, description and compatibility: pi-1.3.0.
Import saves a disabled copy; enable separately. Configuration never grants execution permission.`;
export async function runSettingsCli({ argv, configRoot }) {
  if (argv.length === 0 || argv[0] === "help") return { usage: SETTINGS_USAGE };
  const [type, ...rest] = argv, flags = {}, args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { const key = rest[i]; if (!["--project", "--revision", "--enabled", "--parameters", "--digest"].includes(key) || Object.hasOwn(flags, key) || !rest[i + 1] || rest[i + 1].startsWith("--")) throw settingsError("SETTINGS_COMMAND_USAGE"); flags[key] = rest[++i]; }
    else args.push(rest[i]);
  }
  if (!["list", "set", "reset", "preview", "import"].includes(type) || args.length !== (type === "list" ? 0 : 1)) throw settingsError("SETTINGS_COMMAND_USAGE");
  const projectPath = flags["--project"] ? await fs.realpath(flags["--project"]) : undefined;
  if (projectPath && !(await fs.stat(projectPath)).isDirectory()) throw settingsError("SETTINGS_PROJECT_REQUIRED");
  const input = { type, ...(flags["--revision"] === undefined ? {} : { revision: Number(flags["--revision"]) }) };
  if (["preview", "import"].includes(type)) {
    if (!path.isAbsolute(args[0])) throw settingsError("RESOURCE_SOURCE_UNKNOWN");
    const stat = await fs.lstat(args[0]); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072) throw settingsError("RESOURCE_SOURCE_UNKNOWN");
    input.type = type === "preview" ? "previewImport" : "import";
    input.source = { kind: "local-skill", origin: args[0], content: await fs.readFile(args[0], "utf8") }; if (type === "import") input.digest = flags["--digest"];
  } else if (type !== "list") {
    input.id = args[0];
    if (flags["--enabled"] !== undefined) { if (!["true", "false"].includes(flags["--enabled"])) throw settingsError("SETTINGS_VALUE_INVALID"); input.enabled = flags["--enabled"] === "true"; }
    if (flags["--parameters"] !== undefined) { try { input.parameters = JSON.parse(flags["--parameters"]); } catch { throw settingsError("RESOURCE_PARAMETERS_INVALID"); } }
  }
  const result = await new ProductSettings(configRoot).action(input, projectPath);
  if (projectPath && type !== "preview") {
    try { result.resourceRevision = (await taskSettingsSnapshot(configRoot, projectPath)).resourceRevision; result.pending = Boolean(result.lastFailure) || result.lastLoaded?.resourceRevision !== result.resourceRevision; }
    catch (error) { result.loadError = error.code ?? "RESOURCE_LOAD_FAILED"; result.pending = true; }
  }
  return result;
}

import fsPromises from "node:fs/promises";
import path from "node:path";

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export class SkillsBridgeError extends Error {
  constructor(message, code = "SKILLS_BRIDGE_ERROR") { super(`skills-bridge: ${message}`); this.name = "SkillsBridgeError"; this.code = code; }
}
function fail(message, code) { throw new SkillsBridgeError(message, code); }
function inside(root, target) { const relative = path.relative(path.resolve(root), path.resolve(target)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function contained(root, target) { if (!inside(root, target)) fail(`skill path escapes root: ${target}`, "PATH_ESCAPE"); return path.resolve(target); }
function statIs(stat, name) { return Boolean(stat && (typeof stat[name] === "function" ? stat[name]() : stat[name])); }

function normalizeFs(input) {
  const source = input ?? fsPromises;
  for (const key of ["readdir", "readFile", "lstat"]) if (typeof source[key] !== "function") fail(`filesystem driver lacks ${key}`, "FILESYSTEM_UNAVAILABLE");
  return { readdir: (...args) => source.readdir(...args), readFile: (...args) => source.readFile(...args), lstat: (...args) => source.lstat(...args) };
}

async function walkSkills(fs, root) {
  const result = [];
  const rootStat = await fs.lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!rootStat) return result;
  if (statIs(rootStat, "isSymbolicLink") || !statIs(rootStat, "isDirectory")) fail(`unsafe skill root: ${root}`, "PATH_ESCAPE");
  const walk = async (directory) => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink?.()) fail(`skill symlink is not allowed: ${target}`, "SYMLINK_ESCAPE");
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name === "SKILL.md") result.push(target);
    }
  };
  await walk(root);
  return result;
}

export class SkillsBridge {
  constructor(options = {}) {
    this.fs = normalizeFs(options.fs);
    this.projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
    this.trustedProject = options.trustedProject === true;
    this.roots = (options.roots ?? []).map((root) => ({ kind: root.kind ?? "user", path: path.resolve(root.path ?? root) }));
    this.maxBytes = options.maxBytes ?? 128 * 1024;
  }

  async discover() {
    const roots = [...this.roots];
    if (this.projectRoot && this.trustedProject) roots.push({ kind: "project", path: path.join(this.projectRoot, ".agents", "skills") });
    const skills = [];
    for (const root of roots) {
      const files = await walkSkills(this.fs, root.path);
      for (const file of files) {
        contained(root.path, file);
        const content = await this.fs.readFile(file, "utf8");
        if (Buffer.byteLength(content, "utf8") > this.maxBytes) fail(`skill exceeds byte bound: ${file}`, "OUTPUT_LIMIT");
        const relative = path.relative(root.path, file).split(path.sep).join("/");
        const parts = relative.split("/");
        const name = parts.length >= 2 ? parts.at(-2) : path.basename(root.path);
        if (!NAME.test(name)) continue;
        skills.push({ id: `${root.kind}:${name}`, name, kind: root.kind, root: root.path, path: relative, content, contentBytes: Buffer.byteLength(content, "utf8") });
      }
    }
    const byName = new Map();
    for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
    const conflicts = [...byName.entries()].filter(([, values]) => values.length > 1).map(([name, values]) => ({ name, candidates: values.map((value) => value.id).sort() }));
    const precedence = { project: 0, user: 1, explicit: 2 };
    const selected = skills.slice().sort((left, right) => (precedence[left.kind] ?? 9) - (precedence[right.kind] ?? 9) || left.id.localeCompare(right.id)).filter((skill, _, all) => all.findIndex((candidate) => candidate.name === skill.name) === all.indexOf(skill));
    return Object.freeze({ skills: Object.freeze(selected), conflicts: Object.freeze(conflicts), trustedProject: this.trustedProject });
  }
  async load(id) { const result = await this.discover(); const skill = result.skills.find((entry) => entry.id === id); if (!skill) fail(`unknown skill ${id}`, "UNKNOWN_SKILL"); return skill; }
}

export function createSkillsBridge(options = {}) { return new SkillsBridge(options); }

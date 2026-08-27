import fs from "node:fs";
import path from "node:path";

export const M9_STACK_PROBE_RECORD_TYPE = "omp_m9_stack_probe_v1";
export const M9_STACK_PROBE_ROOTS_ENV = "OMP_M9_STACK_PROBE_ROOTS";

function rootsFromEnvironment() {
  let parsed;
  try {
    parsed = JSON.parse(process.env[M9_STACK_PROBE_ROOTS_ENV] ?? "{}");
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const output = [];
  for (const [owner, value] of Object.entries(parsed)) {
    if (!/^[a-z][a-z0-9-]{1,47}$/u.test(owner) || typeof value !== "string" || !path.isAbsolute(value)) continue;
    try {
      const root = fs.realpathSync(value);
      if (fs.statSync(root).isDirectory()) output.push({ owner, root });
    } catch {
      // The parent validator reports missing roots; the observer emits only bounded data.
    }
  }
  return output.sort((left, right) => right.root.length - left.root.length);
}

function boundedName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\0\r\n]/u.test(value) ? value : "<invalid>";
}

function ownerOf(sourceInfo, roots) {
  const candidate = sourceInfo?.path;
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return "other";
  let real;
  try { real = fs.realpathSync(candidate); } catch { return "other"; }
  for (const entry of roots) {
    const relative = path.relative(entry.root, real);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return entry.owner;
  }
  return "other";
}

function registry(pi, roots) {
  const active = new Set(pi.getActiveTools().map(boundedName));
  const tools = pi.getAllTools().map((tool) => ({
    name: boundedName(tool?.name),
    owner: ownerOf(tool?.sourceInfo, roots),
    active: active.has(boundedName(tool?.name)),
  })).sort((left, right) => left.name.localeCompare(right.name) || left.owner.localeCompare(right.owner));
  const commands = pi.getCommands().map((command) => ({
    name: boundedName(command?.name),
    owner: ownerOf(command?.sourceInfo, roots),
  })).sort((left, right) => left.name.localeCompare(right.name) || left.owner.localeCompare(right.owner));
  return { tools, commands };
}

export default function m9StackProbeExtension(pi) {
  pi.on("session_start", () => {
    const record = {
      formatVersion: 1,
      type: M9_STACK_PROBE_RECORD_TYPE,
      ...registry(pi, rootsFromEnvironment()),
    };
    process.stdout.write(`${JSON.stringify(record)}\n`);
  });
}

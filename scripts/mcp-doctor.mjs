#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const DANGEROUS_NAME = /(delete|remove|destroy|drop|write|update|send|publish|execute|run|install|push|merge)/i;
const UNSAFE_COMMAND = /^(curl|wget|bash|sh|zsh|fish|powershell|pwsh)$/i;

function add(findings, severity, code, message, data = {}) {
  findings.push({ severity, code, message, ...data });
}

function exactPackageArg(value) {
  if (typeof value !== "string") return false;
  if (value.startsWith("@")) {
    const slash = value.indexOf("/");
    const at = value.indexOf("@", slash + 1);
    return at > slash && at < value.length - 1;
  }
  const at = value.lastIndexOf("@");
  return at > 0 && at < value.length - 1;
}

function looksSensitiveKey(key) {
  return /(token|secret|password|api[_-]?key|private[_-]?key|cookie)/i.test(key);
}

function matchesToolPattern(pattern, tool) {
  if (pattern === tool) return true;
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(tool);
}

export function auditMcpConfig(config, { source = "<memory>" } = {}) {
  const findings = [];
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return { source, ok: false, errors: 1, warnings: 0, servers: [], findings: [{ severity: "error", code: "shape", message: "MCP config must be an object." }] };
  }
  const settings = config.settings ?? {};
  const servers = config.mcpServers ?? {};
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    add(findings, "error", "servers-shape", "mcpServers must be an object.");
  }
  if (settings.hostConfigDiscovery !== "off") {
    add(findings, "warning", "host-discovery", "Host MCP config discovery is not explicitly off; review inherited servers.");
  }
  if (settings.outputGuard === false) {
    add(findings, "warning", "output-guard-off", "MCP output guarding is disabled.");
  }
  if (!Array.isArray(settings.approveTools)) {
    add(findings, "warning", "approval-list-missing", "No explicit approveTools list is present; dangerous tools need review at call time.");
  }

  const serverSummaries = [];
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      add(findings, "error", "server-name", `Invalid server name: ${name}.`, { server: name });
    }
    if (server === null || typeof server !== "object" || Array.isArray(server)) {
      add(findings, "error", "server-shape", `Server ${name} must be an object.`, { server: name });
      continue;
    }
    const hasCommand = typeof server.command === "string";
    const hasUrl = typeof server.url === "string" || typeof server.endpoint === "string";
    if (hasCommand === hasUrl) {
      add(findings, "error", "transport", `Server ${name} must define exactly one stdio command or HTTP URL.`, { server: name });
    }
    if (hasCommand) {
      if (UNSAFE_COMMAND.test(server.command)) {
        add(findings, "error", "shell-wrapper", `Server ${name} invokes a shell wrapper directly; use a reviewed executable instead.`, { server: name });
      }
      if (["npx", "npm", "pnpm", "yarn", "bunx"].includes(path.basename(server.command))) {
        const args = Array.isArray(server.args) ? server.args : [];
        const packageArg = args.find((arg) => typeof arg === "string" && (arg.startsWith("@") || /^[a-z0-9][\w.-]+/.test(arg)) && !arg.startsWith("-"));
        if (!exactPackageArg(packageArg)) {
          add(findings, "warning", "unpinned-server", `Server ${name} uses ${server.command} without an exact package version.`, { server: name });
        }
      }
      if (server.cwd && !path.isAbsolute(server.cwd)) {
        add(findings, "warning", "relative-cwd", `Server ${name} has a cwd relative to the launching process.`, { server: name });
      }
    }
    if (hasUrl) {
      const url = server.url ?? server.endpoint;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") {
          add(findings, "error", "insecure-url", `Server ${name} does not use HTTPS: ${parsed.protocol}`, { server: name });
        }
        if (parsed.username || parsed.password) {
          add(findings, "error", "url-credentials", `Server ${name} embeds credentials in its URL.`, { server: name });
        }
      } catch {
        add(findings, "error", "url-shape", `Server ${name} has an invalid URL.`, { server: name });
      }
    }
    if (server.env && (typeof server.env !== "object" || Array.isArray(server.env))) {
      add(findings, "error", "env-shape", `Server ${name} env must be an object.`, { server: name });
    } else if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (looksSensitiveKey(key) && typeof value === "string" && !/^\$\{?[A-Z0-9_]+\}?$/.test(value)) {
          add(findings, "error", "literal-secret", `Server ${name} contains a literal sensitive env value: ${key}.`, { server: name });
        }
      }
    }

    const directTools = server.directTools;
    if (directTools === true) {
      add(findings, "warning", "all-direct-tools", `Server ${name} promotes every MCP tool directly; prefer a small allowlist.`, { server: name });
    } else if (Array.isArray(directTools)) {
      if (directTools.length > 20) add(findings, "warning", "too-many-direct-tools", `Server ${name} promotes ${directTools.length} direct tools; keep the list narrow.`, { server: name });
      for (const tool of directTools) {
        if (DANGEROUS_NAME.test(tool) && !(settings.approveTools ?? []).some((pattern) => matchesToolPattern(pattern, tool))) {
          add(findings, "error", "dangerous-direct-tool", `Dangerous direct tool lacks an approval pattern: ${name}/${tool}.`, { server: name, tool });
        }
      }
    }
    if (Array.isArray(server.includeTools) && Array.isArray(server.excludeTools)) {
      const overlap = server.includeTools.filter((tool) => server.excludeTools.includes(tool));
      if (overlap.length > 0) add(findings, "error", "filter-overlap", `Server ${name} includes and excludes the same tools.`, { server: name, tools: overlap });
    }
    serverSummaries.push({ name, transport: hasCommand ? "stdio" : "http", lifecycle: server.lifecycle ?? "lazy" });
  }

  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  return { source, ok: errors === 0, errors, warnings, servers: serverSummaries, findings };
}

function usage() {
  console.log("Usage: node scripts/mcp-doctor.mjs --file <.mcp.json> [--strict]\n" +
    "       node scripts/mcp-doctor.mjs --example\n" +
    "Static only: does not start MCP servers or access credentials.");
}

function example() {
  return {
    settings: {
      hostConfigDiscovery: "off",
      lifecycle: "lazy",
      outputGuard: true,
      approveTools: ["github_delete_*", "notion_update_*"]
    },
    mcpServers: {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@1.0.0"],
        lifecycle: "lazy",
        directTools: ["resolve-library-id", "get-library-docs"]
      }
    }
  };
}

function main(argv) {
  let file = null;
  let strict = false;
  let printExample = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") file = argv[++i];
    else if (argv[i] === "--strict") strict = true;
    else if (argv[i] === "--example") printExample = true;
    else if (argv[i] === "--help" || argv[i] === "-h") { usage(); return 0; }
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (printExample) {
    console.log(JSON.stringify(example(), null, 2));
    return 0;
  }
  if (!file) throw new Error("--file is required");
  const resolved = path.resolve(process.cwd(), file);
  const result = auditMcpConfig(JSON.parse(fs.readFileSync(resolved, "utf8")), { source: path.relative(root, resolved) });
  result.ok = result.ok && (!strict || result.warnings === 0);
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`mcp-doctor: ERROR ${error.message}`); process.exitCode = 1; }
}

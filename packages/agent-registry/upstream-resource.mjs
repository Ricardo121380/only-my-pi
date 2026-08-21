import crypto from "node:crypto";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const UPSTREAM_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write", "bash", "web"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(canonical(value)))
    .digest("hex");
}

function yamlString(value) {
  return JSON.stringify(value);
}

export function compileAgentResource(manifest, promptText) {
  if (!manifest || manifest.formatVersion !== 1 || !SAFE_ID.test(manifest.id ?? "")) {
    throw new Error("invalid agent id or formatVersion");
  }
  if (manifest.contractStatus !== "contract-only" && manifest.contractStatus !== "runtime-ready") {
    throw new Error("invalid agent contract status");
  }
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    throw new Error("agent description is required");
  }
  if (typeof promptText !== "string" || !promptText.trim() || Buffer.byteLength(promptText) > 64 * 1024) {
    throw new Error("agent prompt must be non-empty and <= 64 KiB");
  }
  const allow = manifest.tools?.allow;
  const deny = manifest.tools?.deny;
  if (!Array.isArray(allow) || !Array.isArray(deny)) throw new Error("agent tools allow/deny are required");
  if (allow.some((tool) => !UPSTREAM_TOOLS.has(tool)) || deny.some((tool) => !UPSTREAM_TOOLS.has(tool))) {
    throw new Error("agent contains an unsupported tool");
  }
  if (allow.some((tool) => deny.includes(tool))) throw new Error("agent tool allow/deny overlap");
  if (!manifest.writer && allow.some((tool) => ["bash", "edit", "write"].includes(tool))) {
    throw new Error("non-writer agent cannot receive bash/edit/write");
  }
  if (["tester", "verifier"].includes(manifest.id)
    && (allow.includes("bash") || !Array.isArray(manifest.gateIds) || manifest.gateIds.length === 0)) {
    throw new Error(`${manifest.id} must use fixed gate IDs without bash`);
  }

  const sourceDigest = hash(manifest);
  const promptDigest = hash(promptText);
  const name = `omp-${manifest.id}`;
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${yamlString(manifest.description)}`,
    `tools: ${allow.join(", ")}`,
    `thinking: ${manifest.modelRole === "deep" ? "high" : manifest.modelRole === "fast" ? "low" : "medium"}`,
    "systemPromptMode: replace",
    "inheritProjectContext: true",
    "inheritSkills: false",
    "defaultProgress: true",
    "---",
    `<!-- generated-by: only-my-pi agent-v1; source-sha256: ${sourceDigest}; prompt-sha256: ${promptDigest} -->`,
    "",
    promptText.trimEnd(),
    "",
  ];
  return { name, sourceDigest, promptDigest, content: lines.join("\n") };
}

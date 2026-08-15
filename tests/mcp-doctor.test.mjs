import assert from "node:assert/strict";
import test from "node:test";
import { auditMcpConfig } from "../scripts/mcp-doctor.mjs";

test("safe lazy stdio server passes with a narrow direct tool list", () => {
  const result = auditMcpConfig({
    settings: { hostConfigDiscovery: "off", outputGuard: true, approveTools: ["github_delete_*"] },
    mcpServers: {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@1.0.0"], directTools: ["resolve-library-id"] },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors, 0);
  assert.equal(result.servers[0].transport, "stdio");
});

test("doctor blocks literal secrets, insecure URLs, and dangerous direct tools", () => {
  const result = auditMcpConfig({
    settings: { hostConfigDiscovery: "on" },
    mcpServers: {
      bad: {
        url: "http://example.com/mcp",
        env: { API_KEY: "sk-live-secret" },
        directTools: ["github_delete_repository"],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === "literal-secret"));
  assert.ok(result.findings.some((finding) => finding.code === "insecure-url"));
  assert.ok(result.findings.some((finding) => finding.code === "dangerous-direct-tool"));
});

test("doctor rejects shell wrappers and conflicting filters", () => {
  const result = auditMcpConfig({
    settings: { hostConfigDiscovery: "off", approveTools: [] },
    mcpServers: {
      shell: { command: "bash", args: ["-lc", "unsafe"] },
      overlap: { command: "/opt/tool", includeTools: ["a"], excludeTools: ["a"] },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === "shell-wrapper"));
  assert.ok(result.findings.some((finding) => finding.code === "filter-overlap"));
});

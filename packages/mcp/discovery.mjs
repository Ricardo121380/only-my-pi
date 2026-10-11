import { MCP_LIMITS, digest, mcpError, resourceUri } from "./catalog.mjs";

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
export async function discoverClient(client, server, signal) {
  const options = { signal, timeoutMs: MCP_LIMITS.timeoutMs };
  const tools = await client.listTools(options);
  let resources = [], templates = [];
  if (client.serverCapabilities?.resources) {
    const page = await client.listResourcesPage(undefined, options);
    if (page.nextCursor !== undefined || page.resources.length > MCP_LIMITS.resources) throw mcpError("MCP_RESOURCE_LIMIT");
    resources = page.resources;
    const templatePage = await client.listResourceTemplatesPage(undefined, options);
    if (templatePage.nextCursor !== undefined || templatePage.resourceTemplates.length > MCP_LIMITS.resources) throw mcpError("MCP_RESOURCE_LIMIT");
    templates = templatePage.resourceTemplates;
  }
  if (tools.length > MCP_LIMITS.tools || bytes({ tools, resources, templates }) > MCP_LIMITS.outputBytes) throw mcpError("MCP_DISCOVERY_LIMIT");
  return { tools, resources, templates };
}

export function admittedResources(server, resources) {
  return resources.filter((resource) => server.resources?.some((policy) => policy.active !== false && policy.uri === resource.uri && policy.mimeTypes.includes(resource.mimeType ?? "application/octet-stream")
    && (resource.size === undefined || Number.isSafeInteger(resource.size) && resource.size >= 0 && resource.size <= MCP_LIMITS.outputBytes)))
    .map((resource) => ({ uri: resource.uri, name: resource.name, mimeType: resource.mimeType ?? "application/octet-stream", ...(resource.size === undefined ? {} : { size: resource.size }), ...(resource.description === undefined ? {} : { description: resource.description }), definitionDigest: digest(resource) }));
}

// A resource is inline data owned by this task. It never grants a host filename,
// executes HTML or creates a model-readable temporary output file.
export function resourceContent(output, policy, initial) {
  const content = [], reject = (code) => ({ isError: true, content: [{ type: "text", text: code }, ...content], details: { status: "failed", code, partial: content.length > 0 } });
  if (!Array.isArray(output.contents) || output.contents.length > 8 || bytes(output) > MCP_LIMITS.outputBytes) return reject("MCP_RESOURCE_OUTPUT_LIMIT");
  for (const block of output.contents) {
    try {
      resourceUri(block.uri, new URL(policy.uri).hostname);
      const mime = block.mimeType ?? "application/octet-stream";
      if (block.uri !== policy.uri || mime !== (initial.mimeType ?? "application/octet-stream") || !policy.mimeTypes.includes(mime) || Object.hasOwn(block, "text") === Object.hasOwn(block, "blob")) throw mcpError("MCP_RESOURCE_TYPE_NOT_ADMITTED");
      let text;
      if (typeof block.text === "string" && mime !== "application/octet-stream") text = block.text;
      else if (typeof block.blob === "string") {
        const decoded = Buffer.from(block.blob, "base64");
        if (decoded.toString("base64") !== block.blob) throw mcpError("MCP_RESOURCE_TYPE_NOT_ADMITTED");
        text = mime === "application/octet-stream" ? `base64: ${block.blob}` : new TextDecoder("utf-8", { fatal: true }).decode(decoded);
      } else throw mcpError("MCP_RESOURCE_TYPE_NOT_ADMITTED");
      if (mime === "application/json") JSON.parse(text);
      content.push({ type: "text", text });
    } catch (error) { return reject(/^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_RESOURCE_TYPE_NOT_ADMITTED"); }
  }
  if (!content.length || bytes(content) > MCP_LIMITS.outputBytes) return reject("MCP_RESOURCE_OUTPUT_LIMIT");
  return { content };
}

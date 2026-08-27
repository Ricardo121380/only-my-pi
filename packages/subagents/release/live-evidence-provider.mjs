import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { jsonClone, sha256, withoutKey } from "../state/codec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "../../..");
const DEFAULT_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "subagents-live-provider-v1.schema.json");
const MAX_DESCRIPTOR_BYTES = 128 * 1024;
const SAFE_APIS = new Set(["anthropic-messages", "google-generative-ai", "openai-completions", "openai-responses"]);
const DANGEROUS_COMPAT_KEY = /^(?:access.?token|api.?key|api.?token|auth|authorization|base.?url|command|credential|env|environment|header|headers|refresh.?token|secret|url)$/iu;

export class LiveEvidenceProviderError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents live provider: ${message}`);
    this.name = "LiveEvidenceProviderError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new LiveEvidenceProviderError(message, code, details);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath));
}

export function liveEvidenceProviderDescriptorDigest(document) {
  return sha256(withoutKey(withoutKey(document, "$schema"), "descriptorDigest"));
}

function validateEndpoint(document) {
  let endpoint;
  try {
    endpoint = new URL(document.provider.baseUrl);
  } catch {
    fail("provider base URL is invalid", "PROVIDER_ENDPOINT_INVALID");
  }
  if (endpoint.protocol !== "https:"
    || endpoint.username !== ""
    || endpoint.password !== ""
    || endpoint.search !== ""
    || endpoint.hash !== ""
    || endpoint.hostname === "") {
    fail("provider endpoint must be credential-free HTTPS without query or fragment", "PROVIDER_ENDPOINT_INVALID");
  }
  return endpoint;
}

function validateCompat(compat) {
  for (const [key, value] of Object.entries(compat ?? {})) {
    if (DANGEROUS_COMPAT_KEY.test(key)) fail("provider compat contains an authority-bearing field", "PROVIDER_COMPAT_UNSAFE", { key });
    if (typeof value === "string" && (value.startsWith("!") || value.includes("\0") || /[\r\n]/u.test(value))) {
      fail("provider compat contains an unsafe string", "PROVIDER_COMPAT_UNSAFE", { key });
    }
  }
}

export function validateLiveEvidenceProviderDescriptor(document, {
  authorization,
  schemaPath = DEFAULT_SCHEMA,
} = {}) {
  const validate = validator(schemaPath);
  if (!validate(document)) {
    fail("provider descriptor JSON schema validation failed", "PROVIDER_SCHEMA_INVALID", {
      errors: validate.errors ?? [],
    });
  }
  if (document.descriptorDigest !== liveEvidenceProviderDescriptorDigest(document)) {
    fail("provider descriptor digest does not match its contents", "PROVIDER_DIGEST_MISMATCH");
  }
  if (!SAFE_APIS.has(document.provider.api)) fail("provider API is unsupported", "PROVIDER_API_UNSUPPORTED");
  const endpoint = validateEndpoint(document);
  validateCompat(document.provider.model.compat);

  if (authorization !== undefined) {
    const expected = authorization?.provider;
    if (!expected || document.provider.id !== expected.id || document.provider.model.id !== expected.model) {
      fail("provider/model differs from the authorization", "PROVIDER_AUTHORIZATION_DRIFT");
    }
    if (expected.configurationDigest !== document.descriptorDigest) {
      fail("provider descriptor digest differs from the authorization", "PROVIDER_AUTHORIZATION_DRIFT");
    }
    if (expected.credentialEnvironment.length !== 1
      || document.provider.credentialEnvironment !== expected.credentialEnvironment[0]) {
      fail("provider credential environment differs from the authorization", "PROVIDER_CREDENTIAL_DRIFT");
    }
    if (!expected.declaredEndpointHosts.includes(endpoint.hostname)) {
      fail("provider endpoint host is outside the authorization", "PROVIDER_ENDPOINT_DRIFT");
    }
  }
  return Object.freeze(jsonClone(document));
}

export function compileLiveEvidencePiModels(document, options = {}) {
  const checked = validateLiveEvidenceProviderDescriptor(document, options);
  const provider = checked.provider;
  return Object.freeze({
    providers: Object.freeze({
      [provider.id]: Object.freeze({
        name: provider.name,
        baseUrl: provider.baseUrl,
        api: provider.api,
        apiKey: `$${provider.credentialEnvironment}`,
        models: Object.freeze([Object.freeze(jsonClone(provider.model))]),
      }),
    }),
  });
}

export function loadLiveEvidenceProviderDescriptor(file, options = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) {
    fail("provider descriptor must be an explicit absolute path", "PROVIDER_PATH_INVALID");
  }
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail("provider descriptor is unavailable", "PROVIDER_FILE_MISSING");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_DESCRIPTOR_BYTES) {
    fail("provider descriptor must be a bounded regular non-symlink file", "PROVIDER_PATH_INVALID");
  }
  let document;
  try {
    document = readJson(file);
  } catch {
    fail("provider descriptor is not valid JSON", "PROVIDER_JSON_INVALID");
  }
  return validateLiveEvidenceProviderDescriptor(document, options);
}

export const SUBAGENTS_LIVE_PROVIDER_SCHEMA = DEFAULT_SCHEMA;

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { EMBEDDED_NODE_ARCHIVE_SHA256 } from "./contracts.mjs";

export const RELEASE_DOWNLOAD_HOSTS = Object.freeze([
  "github.com",
  "api.github.com",
  "release-assets.githubusercontent.com",
  "nodejs.org",
  "registry.npmjs.org",
]);

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

export function validateDownloadUrl(raw, { allowedHosts = RELEASE_DOWNLOAD_HOSTS } = {}) {
  let url;
  try { url = new URL(raw); }
  catch { fail("DOWNLOAD_URL_INVALID", "download URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !allowedHosts.includes(url.hostname)) {
    fail("DOWNLOAD_URL_FORBIDDEN", "download URL must be credential-free HTTPS on an approved host");
  }
  return url;
}

async function responseWithRedirects(raw, { fetchImpl, allowedHosts, maxRedirects }) {
  let url = validateDownloadUrl(raw, { allowedHosts });
  for (let count = 0; count <= maxRedirects; count += 1) {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", headers: {} });
    if (!REDIRECTS.has(response.status)) {
      if (!response.ok || response.body === null) fail("DOWNLOAD_HTTP_FAILED", `download failed with HTTP ${response.status}`, { status: response.status, hostname: url.hostname });
      return { response, finalUrl: url.href, redirects: count };
    }
    if (count === maxRedirects) fail("DOWNLOAD_REDIRECT_LIMIT", "download exceeded the redirect limit");
    const location = response.headers.get("location");
    if (!location) fail("DOWNLOAD_REDIRECT_INVALID", "download redirect has no Location header");
    url = validateDownloadUrl(new URL(location, url).href, { allowedHosts });
  }
  fail("DOWNLOAD_REDIRECT_LIMIT", "download exceeded the redirect limit");
}

function asNodeStream(body) {
  if (typeof body?.getReader === "function") return Readable.fromWeb(body);
  if (typeof body?.pipe === "function" || body?.[Symbol.asyncIterator]) return body;
  fail("DOWNLOAD_BODY_INVALID", "download response body is not streamable");
}

export async function fetchReleaseJson({
  url,
  maxBytes = 4 * 1024 * 1024,
  maxRedirects = 5,
  allowedHosts = RELEASE_DOWNLOAD_HOSTS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) fail("DOWNLOAD_SIZE_BOUND_INVALID", "JSON response size bound is invalid");
  if (typeof fetchImpl !== "function") throw new TypeError("JSON fetch requires fetch");
  const { response, finalUrl, redirects } = await responseWithRedirects(url, { fetchImpl, allowedHosts, maxRedirects });
  const chunks = [];
  let bytes = 0;
  for await (const chunkValue of asNodeStream(response.body)) {
    const chunk = Buffer.from(chunkValue);
    bytes += chunk.length;
    if (bytes > maxBytes) fail("DOWNLOAD_TOO_LARGE", "JSON response exceeds the declared byte bound");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  let document;
  try { document = JSON.parse(body.toString("utf8")); }
  catch { fail("DOWNLOAD_JSON_INVALID", "downloaded release metadata is not valid JSON"); }
  return Object.freeze({ document, bytes, sha256: `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`, finalHost: new URL(finalUrl).hostname, redirects });
}

export async function downloadVerified({
  url,
  destination,
  expectedSha256,
  expectedSri = null,
  maxBytes = 1024 * 1024 * 1024,
  maxRedirects = 5,
  allowedHosts = RELEASE_DOWNLOAD_HOSTS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof destination !== "string" || !path.isAbsolute(destination)) throw new TypeError("download destination must be absolute");
  if (!SHA256.test(expectedSha256 ?? "") || (expectedSri !== null && !SRI.test(expectedSri))) fail("DOWNLOAD_EXPECTATION_INVALID", "download requires exact SHA-256 and optional SHA-512 SRI");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024 * 1024) fail("DOWNLOAD_SIZE_BOUND_INVALID", "download size bound is invalid");
  if (typeof fetchImpl !== "function") throw new TypeError("download requires fetch");
  const parent = await fsp.realpath(path.dirname(destination));
  const normalizedDestination = path.resolve(destination);
  if (path.dirname(normalizedDestination) !== parent) fail("DOWNLOAD_DESTINATION_UNSAFE", "download destination parent must be canonical");
  const temporary = path.join(parent, `.${path.basename(destination)}.tmp-${crypto.randomUUID()}`);
  const { response, finalUrl, redirects } = await responseWithRedirects(url, { fetchImpl, allowedHosts, maxRedirects });
  const sha256Hash = crypto.createHash("sha256");
  const sha512Hash = crypto.createHash("sha512");
  let bytes = 0;
  const output = fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  try {
    for await (const chunkValue of asNodeStream(response.body)) {
      const chunk = Buffer.from(chunkValue);
      bytes += chunk.length;
      if (bytes > maxBytes) fail("DOWNLOAD_TOO_LARGE", "download exceeds the declared byte bound");
      sha256Hash.update(chunk);
      sha512Hash.update(chunk);
      if (!output.write(chunk)) await new Promise((resolve, reject) => { output.once("drain", resolve); output.once("error", reject); });
    }
    await new Promise((resolve, reject) => { output.end(resolve); output.once("error", reject); });
    const actualSha256 = `sha256:${sha256Hash.digest("hex")}`;
    const actualSri = `sha512-${sha512Hash.digest("base64")}`;
    if (actualSha256 !== expectedSha256 || (expectedSri !== null && actualSri !== expectedSri)) fail("DOWNLOAD_DIGEST_MISMATCH", "download bytes differ from the declared digest");
    await fsp.rename(temporary, destination);
    return Object.freeze({ path: destination, bytes, sha256: actualSha256, integrity: actualSri, finalHost: new URL(finalUrl).hostname, redirects });
  } catch (error) {
    output.destroy();
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function verifyNodeChecksumManifest(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024) fail("NODE_CHECKSUM_MANIFEST_INVALID", "Node checksum manifest is invalid");
  const matches = text.split(/\r?\n/u).map((line) => /^([a-f0-9]{64})  (node-v24\.19\.0-darwin-arm64\.tar\.gz)$/u.exec(line)).filter(Boolean);
  if (matches.length !== 1 || `sha256:${matches[0][1]}` !== EMBEDDED_NODE_ARCHIVE_SHA256) fail("NODE_CHECKSUM_MANIFEST_INVALID", "Node checksum manifest does not bind the required darwin-arm64 archive");
  return Object.freeze({ archiveName: matches[0][2], sha256: `sha256:${matches[0][1]}` });
}

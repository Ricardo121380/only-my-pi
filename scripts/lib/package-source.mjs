import semver from "semver";
import ssri from "ssri";

const npmNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const exactVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const fullGitShaPattern = /^[a-f0-9]{40}$/;

function fail(message) {
  throw new TypeError(message);
}

function parseNpmSpec(spec) {
  const body = spec.slice("npm:".length);
  const separator = body.lastIndexOf("@");
  if (separator <= 0 || separator === body.length - 1) {
    fail(`npm package spec must include an exact version: ${spec}`);
  }

  const name = body.slice(0, separator);
  const version = body.slice(separator + 1);
  if (!npmNamePattern.test(name)) {
    fail(`npm package name is invalid or non-canonical: ${name}`);
  }
  if (!exactVersionPattern.test(version) || semver.valid(version, { loose: false }) !== version) {
    fail(`npm package version must be an exact canonical semver: ${version}`);
  }

  return Object.freeze({ type: "npm", name, version, normalized: `npm:${name}@${version}` });
}

function parseGitSpec(spec) {
  let parsed;
  try {
    parsed = new URL(spec);
  } catch {
    fail(`git package spec must be an absolute git+https or git+ssh URL: ${spec}`);
  }

  if (parsed.protocol !== "git+https:" && parsed.protocol !== "git+ssh:") {
    fail(`git package protocol must be git+https or git+ssh: ${spec}`);
  }
  if (!parsed.hostname || parsed.pathname === "/" || parsed.pathname.length < 2) {
    fail(`git package spec must identify a repository: ${spec}`);
  }
  if (parsed.search) {
    fail(`git package spec must not contain query parameters: ${spec}`);
  }
  if (parsed.password || (parsed.username && !(parsed.protocol === "git+ssh:" && parsed.username === "git"))) {
    fail(`git package spec must not embed credentials: ${spec}`);
  }

  const commit = parsed.hash.slice(1);
  if (!fullGitShaPattern.test(commit)) {
    fail(`git package spec must end in a lowercase full 40-character commit SHA: ${spec}`);
  }

  const repository = spec.slice(0, spec.lastIndexOf("#"));
  return Object.freeze({
    type: "git",
    protocol: parsed.protocol.slice(0, -1),
    repository,
    commit,
    normalized: `${repository}#${commit}`,
  });
}

/**
 * Parse the only package source forms admitted by governance.
 *
 * npm sources use `npm:<name>@<exact-semver>`. Git sources use an explicit
 * `git+https` or `git+ssh` URL ending in a full lowercase commit SHA. Tags,
 * branches, ranges, registry aliases, and implicit GitHub shorthands fail
 * closed.
 */
export function parsePackageSpec(spec) {
  if (typeof spec !== "string" || spec.length === 0) {
    fail("package spec must be a non-empty string");
  }
  if (spec.startsWith("npm:")) return parseNpmSpec(spec);
  if (spec.startsWith("git+")) return parseGitSpec(spec);
  fail(`unsupported package source; use exact npm or full-SHA git: ${spec}`);
}

/** Validate and canonicalize a sha512 Subresource Integrity string. */
export function validateSri(integrity) {
  if (typeof integrity !== "string" || integrity.length === 0) {
    fail("package integrity must be a non-empty sha512 SRI string");
  }

  let parsed;
  try {
    parsed = ssri.parse(integrity, { strict: true });
  } catch {
    fail("package integrity is not valid SRI");
  }

  if (!parsed || typeof parsed !== "object") {
    fail("package integrity is not valid SRI");
  }
  const algorithms = Object.keys(parsed);
  if (algorithms.length !== 1 || algorithms[0] !== "sha512" || parsed.sha512.length !== 1) {
    fail("package integrity must contain exactly one sha512 digest");
  }
  const canonical = parsed.toString({ strict: true });
  if (canonical !== integrity) {
    fail("package integrity must use canonical SRI encoding");
  }
  return canonical;
}

/**
 * Validate one inventory entry without fetching or installing anything.
 * Promoted npm entries require an audited sha512 SRI value. Candidate entries
 * may omit SRI, but any recorded value is still validated.
 */
export function validatePackageEntrySource(entry, { promoted = entry?.installed === true } = {}) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    fail("package entry must be an object");
  }

  const source = parsePackageSpec(entry.spec);
  const directIntegrity = entry.integrity;
  const auditedIntegrity = entry.audit?.integrity;
  if (directIntegrity && auditedIntegrity && directIntegrity !== auditedIntegrity) {
    fail(`package ${entry.id ?? "<unknown>"} records conflicting integrity values`);
  }

  const integrity = directIntegrity ?? auditedIntegrity;
  if (source.type === "npm" && promoted && !integrity) {
    fail(`promoted npm package ${entry.id ?? source.name} requires sha512 SRI`);
  }
  const canonicalIntegrity = integrity === undefined ? undefined : validateSri(integrity);

  return Object.freeze({ ...source, integrity: canonicalIntegrity });
}

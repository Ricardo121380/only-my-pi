import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import { sha256 } from "./contracts.mjs";

const START = "# >>> only-my-pi PATH >>>";
const END = "# <<< only-my-pi PATH <<<";
const BLOCK = `${START}\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) export PATH="$HOME/.local/bin:$PATH" ;;\nesac\n${END}\n`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function snapshot(file) {
  const stat = await fs.lstat(file).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return { exists: false, bytes: Buffer.alloc(0), mode: 0o600 };
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) fail("SHELL_PROFILE_UNSAFE", "shell profile must be a bounded regular file");
  return { exists: true, bytes: await fs.readFile(file), mode: stat.mode & 0o777 };
}

function selectedProfile(homeDir, shellPath) {
  const shell = path.basename(shellPath ?? "");
  if (shell === "zsh") return { type: "ZPROFILE", file: path.join(homeDir, ".zprofile") };
  if (shell === "bash") return { type: "BASH_PROFILE", file: path.join(homeDir, ".bash_profile") };
  fail("SHELL_UNSUPPORTED", "automatic PATH configuration supports only zsh and bash");
}

function render(bytes) {
  const text = bytes.toString("utf8");
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (starts !== ends || starts > 1) fail("SHELL_PROFILE_MARKER_DRIFT", "only-my-pi shell marker is duplicated or incomplete");
  if (starts === 1) {
    const start = text.indexOf(START);
    const end = text.indexOf(END, start) + END.length;
    const existing = `${text.slice(start, end)}\n`;
    if (existing !== BLOCK) fail("SHELL_PROFILE_MARKER_DRIFT", "existing only-my-pi shell marker was modified");
    return { changed: false, bytes, separatorAdded: false };
  }
  const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  return { changed: true, bytes: Buffer.from(`${text}${separator}${BLOCK}`), separatorAdded: separator.length > 0 };
}

function renderRemoval(bytes, { separatorAdded = false } = {}) {
  const text = bytes.toString("utf8");
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (starts !== ends || starts > 1) fail("SHELL_PROFILE_MARKER_DRIFT", "only-my-pi shell marker is duplicated or incomplete");
  if (starts === 0) return { changed: false, bytes };
  const start = text.indexOf(START);
  const end = text.indexOf(END, start) + END.length;
  if (text.slice(start, end) !== BLOCK.slice(0, -1)) fail("SHELL_PROFILE_MARKER_DRIFT", "existing only-my-pi shell marker was modified");
  let prefix = text.slice(0, start);
  let suffix = text.slice(end);
  if (suffix.startsWith("\n")) suffix = suffix.slice(1);
  if (separatorAdded && suffix.length === 0 && prefix.endsWith("\n")) prefix = prefix.slice(0, -1);
  return { changed: true, bytes: Buffer.from(`${prefix}${suffix}`) };
}

async function atomicWrite(file, bytes, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.only-my-pi-${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { mode, flag: "wx" });
  await fs.rename(temporary, file);
}

export class ShellProfileService {
  constructor({ homeDir, shellPath = process.env.SHELL ?? "" } = {}) {
    if (typeof homeDir !== "string" || !path.isAbsolute(homeDir)) throw new TypeError("shell profile service requires an absolute homeDir");
    this.homeDir = path.resolve(homeDir);
    this.shellPath = shellPath;
  }

  async plan() {
    const profile = selectedProfile(this.homeDir, this.shellPath);
    const current = await snapshot(profile.file);
    const target = render(current.bytes);
    const plan = {
      formatVersion: 1,
      kind: "only-my-pi-shell-profile-plan",
      mutation: false,
      status: target.changed ? "SHELL_PROFILE_CHANGE_PLANNED" : "NO_CHANGES",
      profileType: profile.type,
      sourceDigest: sha256(current.bytes),
      targetDigest: sha256(target.bytes),
      sourceExists: current.exists,
      separatorAdded: target.separatorAdded,
      backupRequired: current.exists && target.changed,
      marker: "ONLY_MY_PI_PATH_V1",
    };
    plan.planDigest = sha256(canonicalJson(plan));
    return Object.freeze(plan);
  }

  async apply(reviewed) {
    const plan = await this.plan();
    if (plan.planDigest !== reviewed?.planDigest) fail("SHELL_PROFILE_PLAN_DRIFT", "shell profile changed after the reviewed plan");
    if (plan.status === "NO_CHANGES") return Object.freeze({ ok: true, status: "NO_CHANGES", mutation: false, profileType: plan.profileType });
    const profile = selectedProfile(this.homeDir, this.shellPath);
    const current = await snapshot(profile.file);
    const target = render(current.bytes);
    let backup = null;
    if (current.exists) {
      backup = `${profile.file}.only-my-pi-backup-${plan.sourceDigest.slice("sha256:".length, "sha256:".length + 16)}`;
      const existing = await fs.lstat(backup).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink() || sha256(await fs.readFile(backup)) !== plan.sourceDigest) fail("SHELL_PROFILE_BACKUP_CONFLICT", "shell profile backup path is not reusable");
      } else {
        await fs.writeFile(backup, current.bytes, { mode: current.mode, flag: "wx" });
      }
    }
    try {
      await atomicWrite(profile.file, target.bytes, current.mode);
      return Object.freeze({ ok: true, status: "SHELL_PROFILE_CONFIGURED", mutation: true, profileType: profile.type, sourceDigest: plan.sourceDigest, targetDigest: plan.targetDigest, sourceExists: plan.sourceExists, separatorAdded: plan.separatorAdded, backupCreated: backup !== null });
    } catch (error) {
      if (current.exists) await atomicWrite(profile.file, current.bytes, current.mode);
      else await fs.rm(profile.file, { force: true });
      throw error;
    }
  }

  async planRemoval(configuration) {
    const profile = selectedProfile(this.homeDir, this.shellPath);
    if (configuration?.marker !== "ONLY_MY_PI_PATH_V1" || configuration.profileType !== profile.type
      || typeof configuration.sourceExists !== "boolean" || typeof configuration.separatorAdded !== "boolean") {
      fail("SHELL_PROFILE_OWNERSHIP_INVALID", "shell profile removal requires a verified only-my-pi marker plan");
    }
    const current = await snapshot(profile.file);
    const target = renderRemoval(current.bytes, configuration);
    const removeFile = target.changed && target.bytes.length === 0 && configuration.sourceExists === false;
    const plan = {
      formatVersion: 1,
      kind: "only-my-pi-shell-profile-removal-plan",
      mutation: false,
      status: target.changed ? "SHELL_PROFILE_REMOVAL_PLANNED" : "NO_CHANGES",
      profileType: profile.type,
      sourceDigest: sha256(current.bytes),
      targetDigest: sha256(target.bytes),
      removeFile,
      marker: "ONLY_MY_PI_PATH_V1",
      separatorAdded: configuration.separatorAdded,
      originallyExisted: configuration.sourceExists,
    };
    plan.planDigest = sha256(canonicalJson(plan));
    return Object.freeze(plan);
  }

  async remove(reviewed, configuration) {
    const plan = await this.planRemoval(configuration);
    if (plan.planDigest !== reviewed?.planDigest) fail("SHELL_PROFILE_PLAN_DRIFT", "shell profile changed after the reviewed removal plan");
    if (plan.status === "NO_CHANGES") return Object.freeze({ ok: true, status: "NO_CHANGES", mutation: false, profileType: plan.profileType });
    const profile = selectedProfile(this.homeDir, this.shellPath);
    const current = await snapshot(profile.file);
    const target = renderRemoval(current.bytes, configuration);
    if (plan.removeFile) await fs.rm(profile.file, { force: true });
    else await atomicWrite(profile.file, target.bytes, current.mode);
    return Object.freeze({ ok: true, status: "SHELL_PROFILE_REMOVED", mutation: true, profileType: profile.type, sourceDigest: plan.sourceDigest, targetDigest: plan.targetDigest, fileRemoved: plan.removeFile });
  }
}

export function createShellProfileService(options) {
  return new ShellProfileService(options);
}

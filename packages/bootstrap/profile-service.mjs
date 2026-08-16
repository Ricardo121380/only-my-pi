import fs from "node:fs";
import path from "node:path";

import { diffResolved, resolveProfileFile } from "../../scripts/lib/profile-resolver.mjs";

const PROFILE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class ProfileService {
  constructor({ rootDir }) {
    this.rootDir = fs.realpathSync(path.resolve(rootDir));
  }

  list() {
    return fs
      .readdirSync(path.join(this.rootDir, "profiles"))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => this.resolve(path.basename(file, ".json")))
      .map((resolved) => ({
        id: resolved.profile.id,
        description: resolved.profile.description,
        packages: resolved.packages.length,
        capabilities: resolved.capabilities.length,
      }));
  }

  resolve(profileId) {
    if (typeof profileId !== "string" || !PROFILE_ID.test(profileId)) {
      throw Object.assign(new Error("invalid profile id"), { code: "INVALID_PROFILE_ID" });
    }
    const relative = path.join("profiles", `${profileId}.json`);
    const file = path.resolve(this.rootDir, relative);
    const contained = path.relative(this.rootDir, file);
    if (contained.startsWith("..") || path.isAbsolute(contained) || !fs.existsSync(file)) {
      throw Object.assign(new Error(`unknown profile: ${profileId}`), { code: "UNKNOWN_PROFILE" });
    }
    if (fs.realpathSync(file) !== file) {
      throw Object.assign(new Error(`profile symlink is not allowed: ${profileId}`), { code: "PROFILE_SYMLINK_REJECTED" });
    }
    return resolveProfileFile(this.rootDir, relative);
  }

  diff(fromId, toId) {
    return diffResolved(this.resolve(fromId), this.resolve(toId));
  }
}

export function createProfileService(options) {
  return new ProfileService(options);
}

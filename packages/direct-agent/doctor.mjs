import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readLastInteractiveModel } from "../daily-config/index.mjs";
import { resolveControlledStack, resolveDirectExtensionSet } from "./launcher.mjs";
import { DIRECT_AGENT_VERSION } from "./product-contract.mjs";

async function readJsonNoFollow(filename) {
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw Object.assign(new Error("direct Agent metadata must be a bounded regular file"), { code: "DIRECT_AGENT_METADATA_UNSAFE" });
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (cause) {
    if (cause instanceof SyntaxError) throw Object.assign(new Error("direct Agent metadata is not valid JSON"), { code: "DIRECT_AGENT_METADATA_INVALID" });
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function regularFile(filename) {
  const stat = await fs.lstat(filename).catch(() => null);
  return stat?.isFile() === true && stat.isSymbolicLink() === false;
}

function failure(error) {
  return {
    ok: false,
    status: "UNAVAILABLE",
    code: typeof error?.code === "string" ? error.code : "DIRECT_AGENT_COMPONENT_UNAVAILABLE",
  };
}

export class DirectAgentDoctor {
  constructor({
    rootDir,
    configRoot,
    stackRoot,
    homeDir = os.homedir(),
    resolveStack = resolveControlledStack,
    resolveExtensions = resolveDirectExtensionSet,
    readRecentModel = readLastInteractiveModel,
  } = {}) {
    for (const [label, value] of Object.entries({ rootDir, configRoot, stackRoot })) {
      if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`DirectAgentDoctor requires absolute ${label}`);
    }
    this.rootDir = path.resolve(rootDir);
    this.configRoot = path.resolve(configRoot);
    this.stackRoot = path.resolve(stackRoot);
    this.homeDir = homeDir;
    this.resolveStack = resolveStack;
    this.resolveExtensions = resolveExtensions;
    this.readRecentModel = readRecentModel;
  }

  async inspect() {
    let stack;
    let extensionSet;
    try {
      stack = await this.resolveStack({ stackRoot: this.stackRoot, homeDir: this.homeDir });
      extensionSet = await this.resolveExtensions({ stack, configRoot: this.configRoot });
    } catch (error) {
      const unavailable = failure(error);
      return Object.freeze({
        formatVersion: 1,
        ok: false,
        status: "DIRECT_AGENT_UPDATE_REQUIRED",
        code: unavailable.code,
        launcher: unavailable,
        pi: { ok: false, status: "NOT_VERIFIED" },
        extensions: { ok: false, status: "NOT_VERIFIED" },
        permission: { ok: false, status: "NOT_VERIFIED" },
        writer: { ok: false, status: "NOT_VERIFIED" },
        model: { ok: true, status: "SELECT_ON_STARTUP", recentModelConfigured: false },
      });
    }

    const components = {};
    try {
      const manifest = await readJsonNoFollow(path.join(stack.ompPackageRoot, "package.json"));
      const entryReady = await regularFile(path.join(stack.ompPackageRoot, "bin", "omp.mjs"));
      const expectedVersion = stack.distribution?.version ?? DIRECT_AGENT_VERSION;
      const ready = entryReady && manifest?.name === "only-my-pi" && manifest?.version === expectedVersion;
      components.launcher = {
        ok: ready,
        status: ready ? "READY" : manifest?.version === "0.2.0-preview.1" ? "M12_UPDATE_REQUIRED" : "INVALID",
        packageVersion: typeof manifest?.version === "string" ? manifest.version : null,
        expectedPackageVersion: expectedVersion,
        entry: stack.distribution ? "PACKAGE_MANAGED_DISTRIBUTION" : "USER_LOCAL_CONTROLLED_STACK",
        processModel: "execve",
      };
    } catch (error) {
      components.launcher = failure(error);
    }

    try {
      const manifest = await readJsonNoFollow(path.join(stack.root, "pi", "package.json"));
      components.pi = {
        ok: manifest?.name === "@earendil-works/pi-coding-agent" && manifest?.version === "0.84.3",
        status: manifest?.name === "@earendil-works/pi-coding-agent" && manifest?.version === "0.84.3" ? "READY" : "IDENTITY_DRIFT",
        version: typeof manifest?.version === "string" ? manifest.version : null,
      };
    } catch (error) {
      components.pi = failure(error);
    }

    components.extensions = {
      ok: extensionSet.planModeOwner === "only-my-pi" && extensionSet.extensions.length > 0,
      status: extensionSet.planModeOwner === "only-my-pi" ? "AUDITED_SET_READY" : "PLAN_OWNER_CONFLICT",
      ambientDiscovery: false,
      planModeOwner: extensionSet.planModeOwner,
      count: extensionSet.extensions.length,
    };
    const permissionReady = extensionSet.identities.includes("permission-modes:src/index.ts");
    components.permission = {
      ok: permissionReady,
      status: permissionReady ? "GUARDED_BUILD_READY" : "PHYSICAL_POLICY_UNAVAILABLE",
      initialMode: "build",
      yoloPolicy: "revoke-coding-grant",
    };

    try {
      const overlay = await readJsonNoFollow(path.join(stack.ompPackageRoot, "overlays", "writer.json"));
      const cloneReady = await regularFile(path.join(stack.ompPackageRoot, "packages", "direct-agent", "managed-clone.mjs"));
      const orchestrationReady = await regularFile(path.join(stack.ompPackageRoot, "packages", "direct-agent", "orchestration.mjs"));
      const ready = overlay?.available === true
        && overlay?.kind === "soft"
        && overlay?.capabilityIds?.includes("guarded-project-coding")
        && cloneReady
        && orchestrationReady;
      components.writer = {
        ok: ready,
        status: ready ? "GUARDED_MANAGED_CLONE_READY" : "WRITER_UPDATE_REQUIRED",
        isolation: "managed-clone",
        maximumWriters: 1,
        sessionApprovalRequired: true,
      };
    } catch (error) {
      components.writer = failure(error);
    }

    try {
      const recent = await this.readRecentModel({ configRoot: this.configRoot });
      components.model = {
        ok: true,
        status: recent ? "RECENT_MODEL_RECORDED" : "SELECT_ON_STARTUP",
        recentModelConfigured: recent !== null,
        recentModel: recent?.model ?? null,
        authenticationInspected: false,
      };
    } catch (error) {
      components.model = failure(error);
    }

    const ok = Object.values(components).every((entry) => entry.ok === true);
    return Object.freeze({
      formatVersion: 1,
      ok,
      status: ok ? "DIRECT_AGENT_READY" : "DIRECT_AGENT_UPDATE_REQUIRED",
      code: ok ? null : "DIRECT_AGENT_COMPONENT_UNAVAILABLE",
      ...components,
    });
  }
}

export function createDirectAgentDoctor(options = {}) {
  return new DirectAgentDoctor(options);
}

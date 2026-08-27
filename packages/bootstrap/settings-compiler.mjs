import path from "node:path";

import {
  createGenerationLayout,
  verifyPromotedGeneration,
} from "./npm-stager.mjs";

const RESOURCE_SETTING_FIELD = Object.freeze({
  extension: "extensions",
  skill: "skills",
  prompt: "prompts",
  theme: "themes",
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function toRelativeSettingPath(configRoot, absoluteTarget) {
  const root = path.resolve(configRoot);
  const target = path.resolve(absoluteTarget);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    fail("SETTINGS_PATH_ESCAPE", "compiled local settings path escapes configRoot");
  }
  const relative = path.relative(root, target).split(path.sep).join("/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    fail("SETTINGS_PATH_ESCAPE", "compiled local settings path is not contained by configRoot");
  }
  return `./${relative}`;
}

function assertPromotionReceipt(promotion, plan, layout) {
  if (
    promotion?.formatVersion !== 1
    || promotion.status !== "VERIFIED_PROMOTED"
    || promotion.graphDigest !== plan.graphDigest
    || promotion.generationKey !== plan.generationKey
    || path.resolve(promotion.generationRoot ?? "") !== layout.generationRoot
  ) {
    fail("UNVERIFIED_GENERATION", "settings may reference only the verified promoted generation for this graph");
  }
}

/**
 * Compile only-my-pi-owned Pi settings from a verified generation. This
 * function re-verifies the on-disk manifest and content before returning any
 * path. The returned settings contain only relative local paths.
 */
export async function compileGenerationSettings({
  plan,
  promotion,
  configRoot,
  transactionId = "settings-compile",
}) {
  const layout = createGenerationLayout({
    configRoot,
    graphDigest: plan.graphDigest,
    transactionId,
  });
  assertPromotionReceipt(promotion, plan, layout);
  const verified = await verifyPromotedGeneration({ plan, layout });
  if (
    verified.manifest.manifestDigest !== promotion.manifestDigest
    || verified.manifest.realizedDigest !== promotion.realizedDigest
  ) {
    fail("PROMOTION_RECEIPT_DRIFT", "promoted generation no longer matches its verification receipt");
  }

  const installedById = new Map(verified.manifest.packages.map((entry) => [entry.id, entry]));
  const packages = plan.packages.map((entry) => {
    const installed = installedById.get(entry.id);
    if (!installed) fail("GENERATION_PACKAGE_SET_MISMATCH", `verified generation is missing package ${entry.id}`);
    const source = toRelativeSettingPath(
      layout.configRoot,
      path.join(layout.generationRoot, ...installed.installedPath.split("/")),
    );
    if (entry.resourceFilter.length === 0) return source;
    return {
      source,
      extensions: [...entry.resourceFilter],
      skills: [],
      prompts: [],
      themes: [],
    };
  });

  const ownedSettings = {
    packages,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
  const stagedById = new Map(verified.manifest.resources.map((entry) => [entry.id, entry]));
  const agentBundle = stagedById.get("only-my-pi-agent-bundle");
  if (agentBundle) {
    ownedSettings.packages.push(toRelativeSettingPath(
      layout.configRoot,
      path.join(layout.generationRoot, ...agentBundle.stagedPath.split("/")),
    ));
  }
  for (const resource of plan.resources) {
    const field = RESOURCE_SETTING_FIELD[resource.type];
    if (!field || resource.defaultLoaded !== true) continue;
    const staged = stagedById.get(resource.id);
    if (!staged) fail("GENERATION_RESOURCE_SET_MISMATCH", `verified generation is missing resource ${resource.id}`);
    ownedSettings[field].push(toRelativeSettingPath(
      layout.configRoot,
      path.join(layout.generationRoot, ...staged.stagedPath.split("/")),
    ));
  }
  for (const field of ["packages", "extensions", "skills", "prompts", "themes"]) ownedSettings[field].sort();

  return deepFreeze({
    formatVersion: 1,
    status: "VERIFIED",
    graphDigest: plan.graphDigest,
    generationKey: plan.generationKey,
    generationRelativeRoot: toRelativeSettingPath(layout.configRoot, layout.generationRoot),
    ownedSettings,
  });
}

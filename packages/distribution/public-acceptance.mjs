import { RELEASE_PLATFORMS } from "./multiplatform-release-policy.mjs";

export function validatePublicPlatformAcceptance(acceptance, receipt, node, platform) {
  const labels = ["global-install", "verify-offline", "version-offline", "doctor-offline", "raw-pi-offline", "npx-fresh-cache",
    "global-uninstall", "global-reinstall", "reinstall-verify-offline",
    ...(platform === "darwin-arm64" ? ["global-install-previous", "upgrade-version-offline"] : [])].sort();
  if (receipt?.version !== "0.4.0-preview.2" || !RELEASE_PLATFORMS.includes(platform)
    || !["22.19.0", "24.19.0"].includes(node) || acceptance?.status !== "PUBLIC_INSTALL_ACCEPTANCE_PASS"
    || acceptance.publicRegistryVerified !== true || acceptance.node !== node || acceptance.platform !== platform
    || acceptance.version !== receipt.version || acceptance.selector !== `only-my-pi@${receipt.version}`
    || acceptance.sourceCommit !== receipt.sourceCommit || acceptance.distributionId !== receipt.platforms?.[platform]?.distributionId
    || !/^sha256:[a-f0-9]{64}$/u.test(acceptance.distributionId ?? "")
    || !Array.isArray(acceptance.checks) || acceptance.checks.map((item) => item.label).sort().join() !== labels.join()
    || acceptance.checks.some((item) => item.exitCode !== 0) || (platform === "darwin-arm64" && acceptance.productUpgrade !== true))
    throw new Error(`exact public acceptance missing for ${platform} Node ${node}`);
  return acceptance;
}

import path from "node:path";

export function createStackLayout({ homeDir, configRoot = path.join(homeDir ?? "", ".pi", "agent") } = {}) {
  if (typeof homeDir !== "string" || !path.isAbsolute(homeDir)) throw new TypeError("stack layout requires an absolute homeDir");
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("stack layout requires an absolute configRoot");
  const shareRoot = path.join(homeDir, ".local", "share", "only-my-pi");
  const binRoot = path.join(homeDir, ".local", "bin");
  return Object.freeze({
    homeDir: path.resolve(homeDir),
    configRoot: path.resolve(configRoot),
    shareRoot,
    stacksRoot: path.join(shareRoot, "stacks"),
    currentStack: path.join(shareRoot, "current-stack"),
    lkgStack: path.join(shareRoot, "lkg-stack"),
    releaseCache: path.join(shareRoot, "release-cache"),
    transactionRoot: path.join(shareRoot, "transactions"),
    receiptRoot: path.join(shareRoot, "receipts"),
    stateFile: path.join(shareRoot, "stack-state.json"),
    binRoot,
    ompShim: path.join(binRoot, "omp"),
    piShim: path.join(binRoot, "pi"),
    npmRoot: path.join(configRoot, "npm"),
    settingsFile: path.join(configRoot, "settings.json"),
  });
}

export function stackTransactionLayout(layout, transactionId) {
  const root = path.join(layout.transactionRoot, transactionId);
  return Object.freeze({
    root,
    journal: path.join(root, "journal.json"),
    plan: path.join(root, "plan.json"),
    rollback: path.join(root, "rollback-manifest.json"),
    receipt: path.join(root, "receipt.json"),
    stage: path.join(layout.stacksRoot, `.stage-${transactionId}`),
    externalStage: path.join(layout.configRoot, `.only-my-pi-npm-stage-${transactionId}`),
    externalBackup: path.join(layout.configRoot, `.only-my-pi-npm-backup-${transactionId}`),
  });
}

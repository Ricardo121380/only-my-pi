export {
  ConfigPathError,
  assertSafeContainedPath,
  configRuntimePaths,
  configRuntimePaths as createConfigPaths,
  containedPath,
  ensureConfigDirectory,
  normalizeConfigRoot,
  relativeConfigPath,
  validatePortableId,
  validateRelativeConfigPath,
} from "./paths.mjs";

export {
  ATOMIC_WRITE_PHASES,
  atomicWriteJson,
  atomicWriteText,
  canonicalJson,
  durableRemoveFile,
  hashFile,
  readJsonObject,
  readJsonObject as readJsonIfExists,
  sha256,
} from "./atomic-file.mjs";

export {
  extractOwnedSettings,
  mergeOwnedSettings,
  normalizeOwnedPath,
  normalizeOwnedPaths,
  ownedPathPointer,
  ownedSettingsDigest,
  removeOwnedSettings,
  restoreOwnedSettings,
} from "./owned-settings.mjs";

export {
  ABSENT_SETTINGS_DIGEST,
  ConcurrentSettingsChangeError,
  compareAndRemoveSettings,
  compareAndSaveSettings,
  loadSettings,
  loadSettings as readSettingsState,
  saveSettings,
  saveSettings as writeSettingsState,
  settingsDigest,
} from "./settings-store.mjs";

export {
  ConfigLockError,
  acquireConfigLock,
  acquireConfigLock as acquireExclusiveLock,
  inspectConfigLock,
  releaseConfigLock,
  withConfigLock,
} from "./lock.mjs";

export {
  TRANSACTION_SCHEMA,
  TRANSACTION_PHASES,
  TRANSACTION_STATUSES,
  TransactionJournalError,
  advanceTransactionJournal,
  advanceTransactionJournal as advanceJournal,
  beginTransactionRecovery,
  createTransactionJournal,
  createTransactionJournal as createJournal,
  listTransactionJournals,
  loadTransactionJournal,
  loadTransactionJournal as loadJournal,
  planTransactionRecovery,
  settleTransactionRecovery,
  verifyTransactionRecoveryEvidence,
} from "./journal.mjs";

export {
  SNAPSHOT_SCHEMA,
  SettingsSnapshotError,
  createOwnedSettingsSnapshot,
  createOwnedSettingsSnapshot as createSnapshot,
  loadOwnedSettingsSnapshot,
  restoreOwnedSettingsSnapshot,
  restoreOwnedSettingsSnapshot as restoreSnapshot,
  verifyOwnedSettingsSnapshot,
} from "./snapshots.mjs";

export {
  LAST_KNOWN_GOOD_SCHEMA,
  LastKnownGoodError,
  readLastKnownGood,
  readLastKnownGood as readState,
  restoreLastKnownGood,
  verifyLastKnownGood,
  writeLastKnownGood,
  writeLastKnownGood as writeState,
} from "./state-store.mjs";

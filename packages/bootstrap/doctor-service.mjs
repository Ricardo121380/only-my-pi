import { auditPackageGovernance, loadGovernance } from "../../scripts/package-doctor.mjs";
import { loadExpectedRuntimeSnapshot, reconcileRuntimeMetadata } from "../../scripts/lib/runtime-doctor.mjs";

export class DoctorService {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
  }

  static({ profileId = null, strict = false } = {}) {
    const governance = loadGovernance(this.rootDir);
    return auditPackageGovernance(governance, {
      artifactLayout: true,
      strict,
      profileIds: profileId === null ? undefined : [profileId],
    });
  }

  live({ profileId = "coding", metadata } = {}) {
    const expected = loadExpectedRuntimeSnapshot({ rootDir: this.rootDir, profileId });
    return reconcileRuntimeMetadata(metadata, expected);
  }
}

export function createDoctorService(options) {
  return new DoctorService(options);
}

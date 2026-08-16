import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDoctorService } from "../packages/bootstrap/doctor-service.mjs";
import { createProfileService } from "../packages/bootstrap/profile-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ProfileService resolves the canonical profile API used by bootstrap", () => {
  const service = createProfileService({ rootDir: root });
  const coding = service.resolve("coding");
  assert.equal(coding.profile.id, "coding");
  assert.ok(coding.packages.length > 0);
  assert.ok(service.list().some((profile) => profile.id === "orchestration"));
  assert.throws(() => service.resolve("../experimental"), /invalid profile/);
});

test("DoctorService exposes static governance without subprocess output parsing", () => {
  const result = createDoctorService({ rootDir: root }).static({ profileId: "coding" });
  assert.equal(result.ok, true);
  assert.equal(result.errors, 0);
  assert.equal(result.scope, "packaged-static-declarations-only");
});

test("DoctorService never invents live evidence", () => {
  const result = createDoctorService({ rootDir: root }).live({ profileId: "coding" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "UNAVAILABLE");
});

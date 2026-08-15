import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diffResolved, readJson, resolveProfileData } from "../scripts/lib/profile-resolver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const inventory = readJson(path.join(root, "inventory", "packages.lock.json"));

function profile(name) {
  return readJson(path.join(root, "profiles", `${name}.json`));
}

test("coding profile resolves exact package settings", () => {
  const resolved = resolveProfileData(inventory, profile("coding"));
  assert.equal(resolved.profile.id, "coding");
  assert.equal(resolved.packages.length, 7);
  assert.ok(resolved.piSettings.packages.includes("npm:@narumitw/pi-plan-mode@0.49.3"));
  const filtered = resolved.piSettings.packages.find((entry) => typeof entry === "object");
  assert.equal(filtered.source, "npm:pi-agent-extensions@0.5.2");
  assert.deepEqual(filtered.extensions, [
    "extensions/sessions/index.ts",
    "extensions/context/index.ts",
    "extensions/review/index.ts",
    "extensions/notify/index.ts",
  ]);
});

test("research diff adds web access and exposes policy changes", () => {
  const coding = resolveProfileData(inventory, profile("coding"));
  const research = resolveProfileData(inventory, profile("research"));
  const diff = diffResolved(coding, research);
  assert.deepEqual(diff.packages.added, ["web-access"]);
  assert.deepEqual(diff.packages.removed, []);
  assert.ok(diff.policy.some((entry) => entry.path === "network" && entry.to === "allow-listed-only"));
  assert.ok(diff.policy.some((entry) => entry.path === "subagents.enabled" && entry.to === true));
});

test("blocked package cannot be activated", () => {
  const unsafe = { ...profile("minimal"), id: "unsafe", packageIds: ["workspace-history"] };
  assert.throws(() => resolveProfileData(inventory, unsafe), /unavailable package workspace-history/);
});

test("trial candidate cannot be silently promoted", () => {
  const unsafe = { ...profile("minimal"), id: "unsafe", packageIds: ["terminal-theme"] };
  assert.throws(() => resolveProfileData(inventory, unsafe), /non-promoted candidate terminal-theme/);
});

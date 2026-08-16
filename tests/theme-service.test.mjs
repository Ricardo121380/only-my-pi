import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  contrastRatio,
  createThemeControlService,
  createThemeRegistry,
  validateThemeContract,
} from "../packages/control-service/theme-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("theme registry validates the first-party Pi-native theme and exposes bounded metadata", async () => {
  const registry = createThemeRegistry({ rootDir: root });
  const entries = await registry.list();
  assert.deepEqual(entries.map((entry) => entry.id), ["only-my-pi-dark"]);
  assert.match(entries[0].sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await registry.doctor()).status, "THEME_DOCTOR_PASS");
});

test("theme control service lists, shows, previews, and reports contrast receipts", async () => {
  const service = createThemeControlService({ rootDir: root });
  assert.equal((await service.dispatch({ subcommand: "list" })).status, "THEME_LIST");
  const shown = await service.dispatch({ subcommand: "show", themeId: "only-my-pi-dark" });
  assert.equal(shown.theme.piThemeName, "only-my-pi-dark");
  const preview = await service.dispatch({ subcommand: "preview", themeId: "only-my-pi-dark" });
  assert.equal(preview.status, "THEME_PREVIEW");
  assert.equal(preview.preview.ansi, "\u001b[38;2;125;211;252mprimary=██\u001b[0m \u001b[38;2;196;181;253maccent=██\u001b[0m \u001b[38;2;134;239;172msuccess=██\u001b[0m \u001b[38;2;250;204;21mwarning=██\u001b[0m \u001b[38;2;252;165;165merror=██\u001b[0m \u001b[38;2;134;239;172mdiffAdded=██\u001b[0m \u001b[38;2;252;165;165mdiffRemoved=██\u001b[0m \u001b[38;2;147;197;253mroleUser=██\u001b[0m \u001b[38;2;240;171;252mshellMode=██\u001b[0m");
  assert.ok(preview.preview.contrast.checks.every((check) => check.pass === true));
  assert.ok(contrastRatio("#e6edf3", "#10131a") > 15);
});

test("theme use/reset are plans by default and require a public UI driver to apply", async () => {
  const service = createThemeControlService({ rootDir: root });
  assert.equal((await service.dispatch({ subcommand: "use", themeId: "only-my-pi-dark" })).status, "THEME_PLAN");
  assert.equal((await service.dispatch({ subcommand: "use", themeId: "only-my-pi-dark", apply: true })).status, "THEME_APPLY_UNAVAILABLE");

  const applied = [];
  const live = createThemeControlService({
    rootDir: root,
    themeDriver: { setTheme: async (name) => { applied.push(name); return { success: true }; } },
  });
  assert.equal((await live.dispatch({ subcommand: "use", themeId: "only-my-pi-dark", apply: true })).status, "THEME_APPLIED");
  assert.equal((await live.dispatch({ subcommand: "reset", apply: true })).status, "THEME_DISABLED");
  assert.deepEqual(applied, ["only-my-pi-dark", "dark"]);
});

test("theme validation fails closed on missing tokens, unsafe paths, and contrast drift", () => {
  const base = {
    formatVersion: 1,
    contractStatus: "runtime-ready",
    id: "only-my-pi-dark",
    displayName: "Only My Pi Dark",
    themePath: "themes/only-my-pi-dark.json",
    piThemeName: "only-my-pi-dark",
    mode: "dark",
    tokens: Object.fromEntries(["primary", "accent", "text", "background", "surface", "border", "success", "warning", "error", "diffAdded", "diffRemoved", "roleUser", "shellMode"].map((key) => [key, "#ffffff"])),
    contrast: { minTextRatio: 4.5, minUiRatio: 3, checks: [{ name: "text-background", foreground: "#ffffff", background: "#000000", ratio: 21, pass: true }, { name: "accent-background", foreground: "#ffffff", background: "#000000", ratio: 21, pass: true }] },
    safeDisable: "restore-default",
  };
  const missing = structuredClone(base);
  delete missing.tokens.warning;
  assert.equal(validateThemeContract(missing).valid, false);
  const unsafe = structuredClone(base);
  unsafe.themePath = "../outside.json";
  assert.equal(validateThemeContract(unsafe).valid, false);
  const drift = structuredClone(base);
  drift.contrast.checks[0].ratio = 3;
  assert.equal(validateThemeContract(drift).valid, false);
});

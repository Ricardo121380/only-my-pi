import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Actions discovers only current CI, coverage and WebUI release workflows", () => {
  assert.deepEqual(fs.readdirSync(path.join(root, ".github/workflows")).sort(), ["ci.yml", "coverage.yml", "webui-preview.yml"]);
  assert.equal(fs.readdirSync(path.join(root, "legacy/cli/workflows")).filter(name => name.endsWith(".yml")).length, 8);
});

test("all current CI and distribution lanes use the pinned Node 24", () => {
  assert.equal(fs.readFileSync(path.join(root, ".node-version"), "utf8").trim(), "24.19.0");
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(metadata.engines.node, ">=24.19.0 <25");
  assert.equal(lock.packages[""].engines.node, metadata.engines.node);
  for (const name of fs.readdirSync(path.join(root, ".github/workflows"))) {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
    assert.doesNotMatch(workflow, /22\.19\.0|node22|Node 22/u, name);
  }
  for (const name of ["distribution-public-verify.yml", "distribution-publish.yml", "linux-candidate.yml"]) {
    const workflow = fs.readFileSync(path.join(root, "legacy/cli/workflows", name), "utf8");
    for (const platform of ["darwin-arm64", "linux-arm64", "linux-x64"])
      assert.match(workflow, new RegExp(`platform: ${platform}(?:, node: |\n\\s+node: )["']24\\.19\\.0`, "u"), `${name}: ${platform}`);
  }
});

test("development CI routes docs, WebUI, CLI and installation without repeating historical full gates", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /codex\/dev\/pi-native-web/u);
  assert.match(workflow, /node scripts\/ci-plan\.mjs/u);
  for (const lane of ["docs", "static", "web", "cli", "packaging"])
    assert.match(workflow, new RegExp(`node scripts/ci-run\\.mjs ${lane} `, "u"));
  assert.doesNotMatch(workflow, /npm test|npm run verify(?::subagents|:m8|:m9|:m11|:m12)?(?: --|:run)/u);
  assert.match(workflow, /npm run verify:m11:q10:ci/u);
  assert.match(workflow, /name: M11 Q10 macOS arm64 clean-home\n\s+shell: bash/u, "Q10 failure must propagate through tee with bash pipefail");
  assert.match(workflow, /name: CI required/u);
  assert.match(workflow, /if: always\(\)\n    needs: \[scope, docs, static, web, cli, packaging\]/u);
  assert.match(workflow, /requiredFailures\(plan, results\)/u);
  assert.match(workflow, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /npm ci --ignore-scripts/u);
  assert.match(workflow, /NPM_CONFIG_IGNORE_SCRIPTS: "true"/u);
  for (const lane of ["web", "cli", "packaging"]) {
    const job = workflow.split(`  ${lane}:\n`)[1].split(/\n  [a-z]+:\n/u)[0];
    assert.match(job, /runs-on: macos-15/u);
    assert.match(job, /npm run test:prepare/u);
  }
  const docs = workflow.split("  docs:\n")[1].split("\n  static:")[0];
  assert.doesNotMatch(docs, /npm ci|test:prepare/u);
  assert.match(workflow, /node-version: "24\.19\.0"/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /permissions:\n\s+contents: read/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN|OPENAI_API_KEY|DEEPSEEK_API_KEY|secrets\./u);
  const coverage = fs.readFileSync(path.join(root, ".github/workflows/coverage.yml"), "utf8");
  assert.match(coverage, /workflow_dispatch:/u);
  assert.doesNotMatch(coverage, /pull_request:|push:/u);
  assert.match(coverage, /node scripts\/ci-run\.mjs coverage/u);
});

test("archived CLI Preview RC workflow is exact-source, attest-only and cannot publish", () => {
  const workflow = fs.readFileSync(path.join(root, "legacy", "cli", "workflows", "m11-rc.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /only-my-pi-0\.3\.0-preview\.1-darwin-arm64-full\.tar\.gz/u);
  assert.match(workflow, /Require the current Preview version/u);
  assert.doesNotMatch(workflow, /0\.2\.0-preview\.1/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_commit \}\}/u);
  assert.match(workflow, /runs-on: macos-14/u);
  assert.doesNotMatch(workflow, /runs-on: macos-14-xlarge/u);
  assert.match(workflow, /node scripts\/m11-workflow-build\.mjs --source-commit/u);
  assert.equal((workflow.match(/actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/gu) ?? []).length, 2);
  assert.match(workflow, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6\.0\.0/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /attestations: write/u);
  assert.match(workflow, /artifact-metadata: write/u);
  assert.doesNotMatch(workflow, /contents: write|gh release|git push|secrets\./u);
});

test("archived CLI Preview publication verifies E and RC before Draft, then requires environment approval", () => {
  const workflow = fs.readFileSync(path.join(root, "legacy", "cli", "workflows", "m11-publish.yml"), "utf8");
  assert.match(workflow, /runs-on: macos-14/u);
  assert.doesNotMatch(workflow, /runs-on: macos-14-xlarge/u);
  assert.match(workflow, /needs: validate-inputs/u);
  assert.match(workflow, /ref: \$\{\{ needs\.validate-inputs\.outputs\.evidence_commit \}\}/u);
  assert.match(workflow, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7\.0\.0/u);
  assert.match(workflow, /m11-release-evidence\.mjs/u);
  assert.match(workflow, /C11\/C12 evidence-only child E/u);
  assert.match(workflow, /TAG: v0\.3\.0-preview\.1/u);
  assert.match(workflow, /Require the current Preview version/u);
  assert.doesNotMatch(workflow, /0\.2\.0-preview\.1|Q11/u);
  assert.match(workflow, /m11-compare-release-core\.mjs/u);
  assert.equal((workflow.match(/actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/gu) ?? []).length, 2);
  assert.match(workflow, /--draft --prerelease --latest=false --verify-tag/u);
  const notesPath = /--notes-file ([a-zA-Z0-9._/-]+\.md)/u.exec(workflow)?.[1];
  assert.ok(notesPath, "publication must select a release notes file");
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  assert.ok(fs.readFileSync(path.join(root, notesPath), "utf8").startsWith(`# only-my-pi ${version}\n`), "release notes must exist for the current product version");
  assert.match(workflow, /Remove incomplete Draft and tag after failure/u);
  assert.match(workflow, /failure\(\) && steps\.create-tag\.outputs\.created == 'true'/u, "failure cleanup must never delete a pre-existing release or tag");
  assert.match(workflow, /gh release delete "\$TAG" --yes --cleanup-tag/u);
  assert.match(workflow, /environment: public-preview/u);
  assert.match(workflow, /gh release edit "\$TAG" --draft=false/u);
  assert.match(workflow, /gh release verify "\$TAG"/u);
  assert.match(workflow, /gh release verify-asset/u);
  assert.match(workflow, /gh attestation verify/u);
  assert.match(workflow, /--source-digest "\$SOURCE_COMMIT"/u);
  assert.match(workflow, /isImmutable/u);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.ok(workflow.indexOf("m11-compare-release-core.mjs") < workflow.indexOf("Create annotated release tag"));
  assert.ok(workflow.indexOf("Create complete Draft prerelease") < workflow.indexOf("environment: public-preview"));
});

test("publication requires owner confirmation and preserves source identity when rebuilding", () => {
  const workflow = fs.readFileSync(path.join(root, "legacy", "cli", "workflows", "m11-publish.yml"), "utf8");
  const validation = workflow.split("  build-draft:")[0].split("        run: |\n")[1]
    .split("\n").map((line) => line.replace(/^          /u, "")).join("\n");
  const source = "a".repeat(40);
  const run = (overrides) => spawnSync("bash", ["-c", validation], {
    cwd: root,
    env: {
      PATH: process.env.PATH, GITHUB_OUTPUT: "/dev/null", GITHUB_SHA: source,
      SOURCE_COMMIT: source, EVIDENCE_COMMIT: "b".repeat(40),
      EVIDENCE_PATH: "verification/protected/accepted.json", RC_RUN_ID: "123",
      IMMUTABILITY_CONFIRMED: "true", RESUME_DRAFT: "false", ...overrides,
    },
    encoding: "utf8",
  }).status;
  assert.equal(run({}), 0);
  assert.notEqual(run({ IMMUTABILITY_CONFIRMED: "false" }), 0);
  assert.notEqual(run({ GITHUB_SHA: "c".repeat(40) }), 0);
  assert.equal(run({ GITHUB_SHA: "c".repeat(40), RESUME_DRAFT: "true" }), 0);
  assert.notEqual(run({ RESUME_DRAFT: "true", EVIDENCE_PATH: "verification/protected/../other.json" }), 0);
  assert.doesNotMatch(workflow, /gh api .*\/immutable-releases/u, "GITHUB_TOKEN cannot read administration settings");
});

test("Draft recovery verifies existing source attestations before the same approval gate", () => {
  const workflow = fs.readFileSync(path.join(root, "legacy", "cli", "workflows", "m11-publish.yml"), "utf8");
  const recovery = workflow.split("  verify-draft:\n")[1].split("  publish:\n")[0];
  assert.match(recovery, /if: \$\{\{ inputs\.resume_draft \}\}/u);
  assert.match(recovery, /npm ci --ignore-scripts/u);
  assert.match(recovery, /m11-release-evidence\.mjs/u);
  assert.match(recovery, /cmp .*coding-protected-receipt\.json.*protected-receipt\.json/u);
  assert.match(recovery, /m11-compare-release-core\.mjs/u);
  assert.match(recovery, /assert\.equal\(expected\.length,10\)/u);
  assert.match(recovery, /--source-digest "\$SOURCE_COMMIT" --signer-digest "\$SOURCE_COMMIT" --source-ref refs\/heads\/main/u);
  assert.match(recovery, /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/m11-publish\.yml" --deny-self-hosted-runners/u);
  assert.match(recovery, /--predicate-type https:\/\/spdx\.dev\/Document\/v2\.3/u);
  assert.doesNotMatch(recovery, /m11-workflow-build|actions\/attest@|gh release (create|edit|delete)/u);
  const publication = workflow.split("  publish:\n")[1];
  assert.match(publication, /needs: \[validate-inputs, build-draft, verify-draft\]/u);
  assert.match(publication, /!cancelled\(\).*validate-inputs\.result == 'success'.*build-draft\.result == 'success'.*verify-draft\.result == 'success'/u);
  assert.match(publication, /environment: public-preview/u);
  assert.match(publication, /GH_REPO: \$\{\{ github\.repository \}\}/u, "the publish job must resolve its repository without a Git checkout");
  assert.ok(publication.indexOf("git/tags/$TAG_OBJECT") < publication.indexOf("gh release edit"));
});

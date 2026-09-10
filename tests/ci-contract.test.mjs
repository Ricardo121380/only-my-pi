import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CI executes the same manifest-backed verify runner without credentials", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/u);
  assert.doesNotMatch(workflow, /branches:\n\s+- "\*\*"/u);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /node-version: \["22\.19\.0", "24\.19\.0"\]/u);
  assert.doesNotMatch(workflow, /node-version:.*24\.x/u);
  assert.match(workflow, /npm run verify -- --run/);
  assert.match(workflow, /npm run verify:m8:run/u);
  assert.match(workflow, /npm run verify:m9:run/u);
  assert.match(workflow, /npm run verify:public-baseline:run/u);
  assert.doesNotMatch(workflow, /npm run verify:m10:run/u, "retired private-history promotion cannot authorize public CI");
  assert.match(workflow, /npm run verify:m11:run/u);
  assert.match(workflow, /npm run verify:m12:run/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /runs-on: macos-14/u);
  assert.doesNotMatch(workflow, /runs-on: macos-14-xlarge/u);
  assert.match(workflow, /npm run verify:m11:q10:ci/u);
  assert.match(workflow, /receipt:check/);
  assert.match(
    workflow,
    /2026-08-17-post-merge-maintenance\.json --source-commit bff3e3be376bb2ee614a441685e7cab14324727a/u,
  );
  assert.doesNotMatch(
    workflow,
    /2026-08-17-post-merge-maintenance\.json --expect-parent/u,
    "historical receipts cannot require the current feature HEAD to be their receipt-only commit",
  );
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /fetch-depth: 0/u, "history-bound promotion gates require the complete commit graph");
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/u);
  assert.match(workflow, /permissions:\n\s+contents: read/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN|OPENAI_API_KEY|DEEPSEEK_API_KEY|secrets\./u);
  const v1Runner = workflow.indexOf("npm run verify -- --run");
  const receiptCleanup = workflow.indexOf("Remove ephemeral CI receipt before source-clean gates");
  const v2Runner = workflow.indexOf("npm run verify:subagents:run");
  const m8Runner = workflow.indexOf("npm run verify:m8:run");
  const m9Runner = workflow.indexOf("npm run verify:m9:run");
  const publicBaselineRunner = workflow.indexOf("npm run verify:public-baseline:run");
  const m11Runner = workflow.indexOf("npm run verify:m11:run");
  const m12Runner = workflow.indexOf("npm run verify:m12:run");
  assert.ok(v1Runner >= 0 && receiptCleanup > v1Runner && v2Runner > receiptCleanup && m8Runner > v2Runner && m9Runner > m8Runner && publicBaselineRunner > m9Runner && m11Runner > publicBaselineRunner && m12Runner > m11Runner);
  assert.equal((workflow.match(/uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/gu) ?? []).length, 2);
  assert.equal((workflow.match(/uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/gu) ?? []).length, 2);
});

test("current Preview RC workflow is exact-source, attest-only and cannot publish", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "m11-rc.yml"), "utf8");
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

test("current Preview publication verifies E and RC before Draft, then requires environment approval", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "m11-publish.yml"), "utf8");
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
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "m11-publish.yml"), "utf8");
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
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "m11-publish.yml"), "utf8");
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
  assert.ok(publication.indexOf("git/tags/$TAG_OBJECT") < publication.indexOf("gh release edit"));
});

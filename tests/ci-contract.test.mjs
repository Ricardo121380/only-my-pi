import assert from "node:assert/strict";
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
  assert.match(workflow, /npm run verify:m11:run/u);
  assert.match(workflow, /runs-on: macos-14-xlarge/u);
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
  const m11Runner = workflow.indexOf("npm run verify:m11:run");
  assert.ok(v1Runner >= 0 && receiptCleanup > v1Runner && v2Runner > receiptCleanup && m8Runner > v2Runner && m9Runner > m8Runner && m11Runner > m9Runner);
  assert.equal((workflow.match(/uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/gu) ?? []).length, 2);
  assert.equal((workflow.match(/uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/gu) ?? []).length, 2);
});

test("M11 RC workflow is exact-source, attest-only and cannot publish", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "m11-rc.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_commit \}\}/u);
  assert.match(workflow, /runs-on: macos-14-xlarge/u);
  assert.match(workflow, /node scripts\/m11-workflow-build\.mjs --source-commit/u);
  assert.equal((workflow.match(/actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/gu) ?? []).length, 2);
  assert.match(workflow, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6\.0\.0/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /attestations: write/u);
  assert.match(workflow, /artifact-metadata: write/u);
  assert.doesNotMatch(workflow, /contents: write|gh release|git push|secrets\./u);
});

test("M11 publication verifies E and RC before Draft, then requires environment approval", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "m11-publish.yml"), "utf8");
  assert.match(workflow, /needs: validate-inputs/u);
  assert.match(workflow, /ref: \$\{\{ needs\.validate-inputs\.outputs\.evidence_commit \}\}/u);
  assert.match(workflow, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7\.0\.0/u);
  assert.match(workflow, /m11-release-evidence\.mjs/u);
  assert.match(workflow, /m11-compare-release-core\.mjs/u);
  assert.equal((workflow.match(/actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/gu) ?? []).length, 2);
  assert.match(workflow, /--draft --prerelease --latest=false --verify-tag/u);
  assert.match(workflow, /Remove incomplete Draft and tag after failure/u);
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

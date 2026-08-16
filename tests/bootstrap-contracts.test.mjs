import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "verification", "fixtures", "bootstrap", "contracts");
const definitions = [
  ["transaction", "bootstrap-transaction-v1.schema.json"],
  ["state", "bootstrap-state-v1.schema.json"],
  ["generation", "bootstrap-generation-v1.schema.json"],
  ["snapshot", "bootstrap-snapshot-v1.schema.json"],
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validator(schemaFile) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson(path.join(root, "schemas", schemaFile)));
}

for (const [kind, schemaFile] of definitions) {
  test(`${kind} bootstrap schema accepts its positive fixture`, () => {
    const validate = validator(schemaFile);
    const document = readJson(path.join(fixtureRoot, kind, "positive.json"));
    assert.equal(validate(document), true, JSON.stringify(validate.errors));
  });

  test(`${kind} bootstrap schema fails every negative fixture`, () => {
    const validate = validator(schemaFile);
    const directory = path.join(fixtureRoot, kind);
    const negatives = fs.readdirSync(directory).filter((file) => file.startsWith("negative-")).sort();
    assert.ok(negatives.length >= 1);
    for (const file of negatives) {
      const document = readJson(path.join(directory, file));
      assert.equal(validate(document), false, `${kind}/${file} unexpectedly passed`);
      assert.ok(validate.errors?.length, `${kind}/${file} produced no schema error`);
    }
  });
}

test("provider metadata can never represent a verified Provider", () => {
  const validate = validator("bootstrap-state-v1.schema.json");
  const document = readJson(path.join(fixtureRoot, "state", "positive.json"));
  document.metadata.providerSelection.status = "ACTIVE";
  assert.equal(validate(document), false);
});

test("settings cannot become visible before the graph is verified and promoted", () => {
  const validate = validator("bootstrap-transaction-v1.schema.json");
  const document = readJson(path.join(fixtureRoot, "transaction", "positive.json"));
  document.settingsPublished = true;
  assert.equal(validate(document), false);
});

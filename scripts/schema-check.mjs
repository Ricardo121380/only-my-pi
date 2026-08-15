#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const schemasRoot = path.join(root, "schemas");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function dataFiles() {
  return [
    path.join(root, "inventory", "packages.lock.json"),
    ...fs
      .readdirSync(path.join(root, "profiles"))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => path.join(root, "profiles", file)),
  ];
}

export function checkSchemaLinks() {
  const findings = [];
  const schemaIds = new Set();
  for (const file of dataFiles()) {
    const document = readJson(file);
    if (typeof document.$schema !== "string") {
      findings.push({ file: path.relative(root, file), error: "missing $schema" });
      continue;
    }
    const schemaFile = path.resolve(path.dirname(file), document.$schema);
    const relativeSchema = path.relative(schemasRoot, schemaFile);
    if (relativeSchema.startsWith("..") || path.isAbsolute(relativeSchema)) {
      findings.push({ file: path.relative(root, file), error: "$schema escapes schemas/" });
      continue;
    }
    if (!fs.existsSync(schemaFile)) {
      findings.push({ file: path.relative(root, file), error: `schema not found: ${document.$schema}` });
      continue;
    }
    const schema = readJson(schemaFile);
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      findings.push({ file: path.relative(root, schemaFile), error: "schema draft must be 2020-12" });
    }
    if (typeof schema.$id !== "string" || schema.$id.length === 0) {
      findings.push({ file: path.relative(root, schemaFile), error: "schema has no $id" });
    } else {
      schemaIds.add(schema.$id);
    }
  }
  return {
    ok: findings.length === 0,
    documents: dataFiles().length,
    schemas: schemaIds.size,
    findings,
  };
}

const result = checkSchemaLinks();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

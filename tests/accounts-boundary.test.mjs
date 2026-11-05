import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const packages = fileURLToPath(new URL("../packages/", import.meta.url));

test("shared accounts and Direct do not import Host; accounts do not import execution adapters", async () => {
  for (const directory of ["accounts", "direct-agent"]) {
    for (const entry of await fs.readdir(path.join(packages, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(mjs|ts)$/u.test(entry.name)) continue;
      const file = path.join(packages, directory, entry.name);
      const source = ts.createSourceFile(file, await fs.readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
      const dependencies = [];
      const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) dependencies.push(node.moduleSpecifier);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) dependencies.push(node.arguments[0]);
        if (ts.isNewExpression(node) && node.expression.getText(source) === "URL" && node.arguments?.[1]?.getText(source) === "import.meta.url") dependencies.push(node.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const dependency of dependencies) {
        assert.ok(ts.isStringLiteral(dependency), `${directory}/${entry.name}: relative entry must be statically inspectable`);
        const specifier = dependency.text;
        if (specifier.startsWith("node:")) continue;
        if (!specifier.startsWith(".")) {
          if (directory === "accounts") assert.equal(specifier, "ajv", `${directory}/${entry.name}: unexpected external dependency`);
          continue;
        }
        const target = path.resolve(path.dirname(file), specifier);
        const relative = path.relative(packages, target);
        const owner = relative.split(path.sep)[0];
        assert.notEqual(owner, "host", `${directory}/${entry.name} must not depend on ${specifier}`);
        if (directory === "accounts") assert.ok(["accounts", "config-runtime", "process-runtime"].includes(owner) || relative === "control-service/secret-input.mjs", `${directory}/${entry.name} must not depend on ${specifier}`);
        // Type-only .js imports resolve to declarations under NodeNext.
        await fs.access(target.endsWith(".js") ? target.slice(0, -3) + ".d.ts" : target);
      }
    }
  }
});

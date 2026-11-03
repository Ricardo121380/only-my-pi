import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const packages = fileURLToPath(new URL("../packages/", import.meta.url));

test("shared process and persistence primitives cannot depend on product or client modules", async () => {
  for (const directory of ["process-runtime", "config-runtime"]) {
    for (const entry of await fs.readdir(path.join(packages, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
      const file = path.join(packages, directory, entry.name);
      const source = ts.createSourceFile(file, await fs.readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const dependencies = [];
      const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) dependencies.push(node.moduleSpecifier);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) dependencies.push(node.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const dependency of dependencies) {
        assert.ok(dependency && ts.isStringLiteral(dependency), `${directory}/${entry.name}: dependency must be statically inspectable`);
        const specifier = dependency.text;
        if (specifier.startsWith("node:")) continue;
        assert.ok(specifier.startsWith("."), `${directory}/${entry.name}: unexpected external dependency ${specifier}`);
        const target = path.resolve(path.dirname(file), specifier);
        const owner = path.relative(packages, target).split(path.sep)[0];
        assert.ok(owner === directory || owner === "config-runtime", `${directory}/${entry.name} must not depend on ${specifier}`);
        await fs.access(target);
      }
    }
  }
});

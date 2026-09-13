import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beginSandboxMountLease, reserveSandboxMountPoints } from "../packages/distribution/sandbox-mount-ownership.mjs";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omp-owned-mount-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const args = (root, target) => ["--bind", root, root, "--ro-bind", "/dev/null", target, "--", "true"];

test("pre-existing empty user files are preserved", (t) => {
  const root = fixture(t), target = path.join(root, ".bashrc");
  fs.writeFileSync(target, "");
  const before = fs.lstatSync(target);
  const release = beginSandboxMountLease();
  reserveSandboxMountPoints(args(root, target));
  release();
  assert.equal(fs.lstatSync(target).ino, before.ino);
});

test("owned mountpoints remain until all overlapping commands finish", (t) => {
  const root = fixture(t), target = path.join(root, ".mcp.json");
  const first = beginSandboxMountLease(), second = beginSandboxMountLease();
  reserveSandboxMountPoints(args(root, target));
  first(); first();
  assert.equal(fs.existsSync(target), true);
  second();
  assert.equal(fs.existsSync(target), false);
});

test("user replacements, writes and symlinks are never cleaned as owned placeholders", (t) => {
  const root = fixture(t);
  for (const mode of ["write", "replace", "symlink"]) {
    const target = path.join(root, mode), outside = path.join(root, `${mode}-user`);
    fs.writeFileSync(outside, "user data");
    const release = beginSandboxMountLease();
    reserveSandboxMountPoints(args(root, target));
    if (mode === "write") fs.writeFileSync(target, "user data");
    else { fs.unlinkSync(target); if (mode === "replace") fs.renameSync(outside, target); else fs.symlinkSync(outside, target); }
    release();
    assert.equal(fs.readFileSync(target, "utf8"), "user data");
  }
});

test("only generated options under writable roots are reserved, with directory cleanup in reverse order", (t) => {
  const root = fixture(t), directory = path.join(root, ".claude"), child = path.join(directory, "commands");
  const outside = path.join(os.tmpdir(), `unowned-${path.basename(root)}`);
  const release = beginSandboxMountLease();
  reserveSandboxMountPoints(["--bind", root, root, "--tmpfs", directory, "--ro-bind", "/dev/null", child,
    "--ro-bind", "/dev/null", outside, "--", "--ro-bind", "/dev/null", path.join(root, "user-command")]);
  assert.equal(fs.existsSync(child), true);
  assert.equal(fs.existsSync(outside), false);
  assert.equal(fs.existsSync(path.join(root, "user-command")), false);
  release();
  assert.equal(fs.existsSync(directory), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as sdk from "@earendil-works/pi-coding-agent";
import { SessionAdmissions } from "../packages/direct-agent/session-admission.mjs";
import { inspectSessionSelection, prepareHeadlessSession } from "../packages/direct-agent/session-selection.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-selection-")));
  const configRoot = path.join(root, "config"), sessionDir = path.join(root, "sessions");
  await fs.mkdir(configRoot); await fs.mkdir(sessionDir);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const admissions = new SessionAdmissions(configRoot);
  const prepare = (args, env = {}, selectResume) => prepareHeadlessSession({ args, sdk, admissions, configRoot, cwd: root, env, selectResume });
  const history = async (id, { cwd = root, version = 1 } = {}) => {
    const file = path.join(sessionDir, `${id}.jsonl`);
    const contents = JSON.stringify({ type: "session", version, id, cwd, timestamp: new Date().toISOString() }) + "\n";
    await fs.writeFile(file, contents); return { file, contents };
  };
  return { root, configRoot, sessionDir, admissions, prepare, history };
}

test("selection parsing retains model/tool/prompt args and honors separator", () => {
  const args = ["--tools", "read", "--model", "fixture/model", "-p", "--session", "./a.jsonl", "--", "--continue"];
  assert.deepEqual(inspectSessionSelection(args).rest, ["--tools", "read", "--model", "fixture/model", "-p", "--", "--continue"]);
  for (const invalid of [["--session", "a", "-c"], ["--session-id", "a", "--session", "b"], ["-c", "--continue"], ["--session-dir", "a", "--session-dir", "b"],
    ["--session", ""], ["--session-id", ""], ["--session-dir", ""], ["-r", "--resume"],
    ["--resume", "--session", "a"], ["--resume", "-c"], ["--resume", "--session-id", "a"]])
    assert.throws(() => inspectSessionSelection(invalid), { code: "OMP_AGENT_OPTION_INVALID" });
});

test("explicit startup fork reserves target and source without changing source history", async (t) => {
  const f = await fixture(t), source = await f.history("source", { cwd: path.join(f.root, "previous-project") });
  try {
    const result = await f.prepare(["--fork", "source", "--session-id", "forked", "--session-dir", f.sessionDir, "--", "task"]);
    assert.equal(result.target.id, "forked");
    assert.equal(result.sessionManager.getCwd(), f.root);
    assert.equal(result.sessionManager.getHeader().parentSession, source.file);
    assert.equal(await fs.readFile(source.file, "utf8"), source.contents);
    assert.deepEqual(result.args.slice(-2), ["--", "task"]);
    for (const id of ["source", "forked"])
      await assert.rejects(acquireOwnership(f.configRoot, "session", id), { code: "OWNERSHIP_HELD" });
  } finally { await f.admissions.close(); }
});

test("startup fork refuses occupied source and conflicting selection before writing", async (t) => {
  const f = await fixture(t), source = await f.history("source");
  const owner = await acquireOwnership(f.configRoot, "session", "source");
  try {
    for (const extra of [["--session", "source"], ["--continue"], ["--resume"]])
      assert.throws(() => inspectSessionSelection(["--fork", "source", ...extra]), { code: "OMP_AGENT_OPTION_INVALID" });
    await assert.rejects(f.prepare(["--fork", source.file, "--session-id", "forked", "--session-dir", f.sessionDir]),
      { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    assert.equal(f.admissions.reservations.size, 0);
    assert.deepEqual(await fs.readdir(f.sessionDir), ["source.jsonl"]);
    assert.equal(await fs.readFile(source.file, "utf8"), source.contents);
  } finally { await owner.release(); await f.admissions.close(); }
});

test("empty selection arguments create no history; empty environment uses default directory", async (t) => {
  const f = await fixture(t);
  try {
    for (const flag of ["--session", "--session-id", "--session-dir"])
      await assert.rejects(f.prepare([flag, ""]), { code: "OMP_AGENT_OPTION_INVALID" });
    assert.deepEqual((await fs.readdir(f.root)).sort(), ["config", "sessions"]);
    assert.deepEqual(await fs.readdir(f.configRoot), []);
    const result = await f.prepare(["-p", "hello"], { PI_CODING_AGENT_SESSION_DIR: "", OMP_CODING_AGENT_SESSION_DIR: "" });
    assert.equal(path.dirname(result.target.sessionDir), path.join(f.configRoot, "sessions"));
  } finally { await f.admissions.close(); }
});

test("relative path resolves before admission, no history migration during selection", async (t) => {
  const f = await fixture(t), history = await f.history("one");
  try {
    const result = await f.prepare(["--session", "sessions/one.jsonl", "-p", "hello"]);
    assert.equal(result.target.file, history.file);
    assert.deepEqual(result.args, ["--session", history.file, "-p", "hello"]);
    assert.equal(await fs.readFile(history.file, "utf8"), history.contents);
    await assert.rejects(acquireOwnership(f.configRoot, "session", "one"), { code: "OWNERSHIP_HELD" });
  } finally { await f.admissions.close(); }
});

test("exact ID outranks prefixes; ambiguous prefix fails instead of selecting another history", async (t) => {
  const f = await fixture(t); await f.history("task-one"); await f.history("task-two");
  try {
    await assert.rejects(f.prepare(["--session", "task", "--session-dir", f.sessionDir]), { code: "SESSION_ID_AMBIGUOUS" });
    const result = await f.prepare(["--session-id", "task-one", "--session-dir", f.sessionDir]);
    assert.equal(result.target.id, "task-one");
    assert.equal(result.args[0], "--session");
  } finally { await f.admissions.close(); }
});

test("directory precedence is flag then environment then settings", async (t) => {
  const f = await fixture(t); const history = await f.history("one");
  await fs.writeFile(path.join(f.configRoot, "settings.json"), JSON.stringify({ sessionDir: f.sessionDir }));
  try {
    for (const [args, env] of [
      [["--session", "one"], {}],
      [["--session", "one"], { PI_CODING_AGENT_SESSION_DIR: f.sessionDir }],
      [["--session", "one"], { PI_CODING_AGENT_SESSION_DIR: f.sessionDir, OMP_CODING_AGENT_SESSION_DIR: "/not-the-unbranded-runtime" }],
      [["--session", "one"], { ONLY_MY_PI_DISTRIBUTION_VERSION: "fixture", OMP_CODING_AGENT_SESSION_DIR: f.sessionDir, PI_CODING_AGENT_SESSION_DIR: "/not-the-branded-runtime" }],
      [["--session", "one", "--session-dir", f.sessionDir], { PI_CODING_AGENT_SESSION_DIR: path.join(f.root, "missing") }],
    ]) assert.equal((await f.prepare(args, env)).target.file, history.file);
  } finally { await f.admissions.close(); }
});

test("recent uses mtime and occupied latest never falls back", async (t) => {
  const f = await fixture(t); const older = await f.history("older"), latest = await f.history("latest");
  await fs.utimes(older.file, 1, 1); await fs.utimes(latest.file, 2, 2);
  const owner = await acquireOwnership(f.configRoot, "session", "latest");
  try {
    await assert.rejects(f.prepare(["-c", "--session-dir", f.sessionDir]), { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    assert.equal(await fs.readFile(latest.file, "utf8"), latest.contents);
  } finally { await owner.release(); await f.admissions.close(); }
});

test("empty continue reserves an ID and pins Pi startup to that ID", async (t) => {
  const f = await fixture(t);
  try {
    const result = await f.prepare(["-c", "--session-dir", f.sessionDir, "--", "--session"]);
    assert.equal(result.args[0], "--session-id");
    assert.equal(result.args[1], result.target.id);
    assert.deepEqual(result.args.slice(-2), ["--", "--session"]);
    await assert.rejects(acquireOwnership(f.configRoot, "session", result.target.id), { code: "OWNERSHIP_HELD" });
    assert.deepEqual(await fs.readdir(f.sessionDir), []);
  } finally { await f.admissions.close(); }
});

test("cross-project ID never silently becomes an in-place resume", async (t) => {
  const f = await fixture(t); const history = await f.history("other", { cwd: path.join(f.root, "other") });
  try {
    await assert.rejects(f.prepare(["--session", "other", "--session-dir", f.sessionDir]), { code: "SESSION_CROSS_PROJECT_FORK_REQUIRED" });
    assert.equal(await fs.readFile(history.file, "utf8"), history.contents);
  } finally { await f.admissions.close(); }
});

test("resume discovery is read-only and selection is admitted before returning startup args", async (t) => {
  const f = await fixture(t), history = await f.history("picked");
  try {
    const result = await f.prepare(["-r", "--session-dir", f.sessionDir, "-p", "hello"], {}, async ({ currentSessions, allSessions }) => {
      assert.equal((await currentSessions())[0].path, history.file);
      assert.equal((await allSessions())[0].path, history.file);
      assert.equal(await fs.readFile(history.file, "utf8"), history.contents);
      const available = await acquireOwnership(f.configRoot, "session", "picked"); await available.release();
      return history.file;
    });
    assert.deepEqual(result.args, ["--session", history.file, "--session-dir", f.sessionDir, "-p", "hello"]);
    await assert.rejects(acquireOwnership(f.configRoot, "session", "picked"), { code: "OWNERSHIP_HELD" });
    assert.equal(await fs.readFile(history.file, "utf8"), history.contents);
  } finally { await f.admissions.close(); }
});

test("resume cancellation and invalid picker results never create a session", async (t) => {
  const f = await fixture(t);
  try {
    const args = ["--resume", "--session-dir", f.sessionDir];
    assert.deepEqual(await f.prepare(args, {}, async () => null), { cancelled: true });
    await assert.rejects(f.prepare(args), { code: "SESSION_PICKER_UNAVAILABLE" });
    for (const value of [undefined, "", "relative.jsonl"])
      await assert.rejects(f.prepare(args, {}, async () => value), { code: "SESSION_TARGET_INVALID" });
    assert.deepEqual(await fs.readdir(f.sessionDir), []);
    assert.equal(f.admissions.reservations.size, 0);
  } finally { await f.admissions.close(); }
});

test("a target occupied after resume discovery is refused without migration or fallback", async (t) => {
  const f = await fixture(t), history = await f.history("picked");
  let owner;
  try {
    await assert.rejects(f.prepare(["-r"], {}, async () => {
      owner = await acquireOwnership(f.configRoot, "session", "picked");
      return history.file;
    }), { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    assert.equal(await fs.readFile(history.file, "utf8"), history.contents);
    assert.equal(f.admissions.reservations.size, 0);
  } finally { await owner?.release(); await f.admissions.close(); }
});

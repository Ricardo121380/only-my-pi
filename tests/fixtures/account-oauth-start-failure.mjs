import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import http from "node:http";
import children from "node:child_process";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

// Used only by the cleanup regression's isolated Node process. Produce a real
// OS launch error before login, without inventing an OAuth or provider result.
const probe = {}, file = process.env.OMP_OAUTH_START_FAILURE_PROBE;
const save = () => writeFileSync(file, JSON.stringify(probe), { mode: 0o600 });
const mkdtemp = fs.mkdtemp;
fs.mkdtemp = async (...args) => {
  const root = await mkdtemp(...args);
  if (path.basename(root).startsWith("omp-cli-oauth-")) { probe.root = await fs.realpath(root); save(); }
  return root;
};
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once("listening", () => { probe.origin = `http://127.0.0.1:${this.address().port}`; save(); });
  return listen.apply(this, args);
};
const spawn = children.spawn;
children.spawn = function (command, args, options) {
  if (args[0]?.endsWith("/bin/omp.mjs") && args[1] === "account" && args[2] === process.env.OMP_OAUTH_START_FAILURE_PHASE && !probe.injected) {
    probe.injected = true; save();
    return spawn(command, args, { ...options, cwd: path.join(probe.root, "missing-cwd") });
  }
  return spawn(command, args, options);
};
syncBuiltinESMExports();

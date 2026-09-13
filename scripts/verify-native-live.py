#!/usr/bin/env python3
"""Real-model acceptance in a disposable project. Emits no credentials or raw UI."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

MODEL = "cc-switch-kimi-for-coding/kimi-for-coding"
ANSI = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")
READ_PROMPT = "Synthetic acceptance: stay in Inspect. Read math.mjs and test.mjs, then delegate one read-only scout to independently identify the negative-addition bug. Do not modify files or request coding access. Give a short final answer."
WRITE_PROMPT = "Prepare a complex plan and request_coding_access for scope exactly [math.mjs]. Explicitly enable a managed clone writer and fresh reviewer. Delegate the fix to the writer, use the committed .pi/only-my-pi-gates.json unit gate, require fresh review, apply the verified patch, then run node test.mjs in the real worktree. Preserve all other files and existing changes. Do not commit or push."
RESUME_PROMPT = "This is a new process. Request coding access again before adding one trailing blank line to math.mjs. Wait for the decision; do not perform any write before approval."
CANCEL_PROMPT = "Synthetic cancellation test: immediately delegate one read-only scout to inspect math.mjs and test.mjs and carefully explain signed-addition edge cases. Do not inspect yourself, request coding access, or change files."


def checked(argv, **options):
    return subprocess.run(argv, check=True, text=True, capture_output=True, timeout=300, **options)


def digest(filename):
    return "sha256:" + hashlib.sha256(Path(filename).read_bytes()).hexdigest()


def processes():
    # Process arguments stay in memory; never log them or include them in receipts.
    result = {}
    for line in checked(["ps", "-axo", "pid=,ppid=,command="]).stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            result[int(fields[0])] = (int(fields[1]), fields[2])
    return result


def descendants(pid, table):
    found = set()
    frontier = {pid}
    while frontier:
        frontier = {child for child, (parent, _) in table.items() if parent in frontier} - found
        found.update(frontier)
    return found


class Tui:
    def __init__(self, command, project, env, sessions, prompt, resume=None):
        self.project, self.sessions = project, sessions
        self.session = Path(resume) if resume else None
        self.offset = len(self.rows()) if resume else 0
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        argv = [command, "--model", MODEL]
        if resume:
            argv += ["--session", str(resume)]
        argv += [prompt]
        self.process = subprocess.Popen(argv, cwd=project, env=env, stdin=slave,
                                        stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        self.screen = ""
        self.ui_digest = hashlib.sha256()
        self.closed = False

    def rows(self):
        if not self.session:
            files = list(self.sessions.glob("*/*.jsonl"))
            if not files:
                return []
            self.session = max(files, key=lambda p: p.stat().st_mtime_ns)
        try:
            return [json.loads(line) for line in self.session.read_text().splitlines()]
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def messages(self):
        return [row["message"] for row in self.rows()[self.offset:] if row.get("type") == "message"]

    def result(self, tool, status):
        return next((m for m in self.messages() if m.get("role") == "toolResult"
                     and m.get("toolName") == tool and m.get("details", {}).get("status") == status), None)

    def finished(self):
        messages = self.messages()
        return bool(messages and messages[-1].get("role") == "assistant"
                    and messages[-1].get("stopReason") == "stop")

    def send(self, value):
        os.write(self.master, value.encode())
        self.screen = ""

    def pump(self):
        if select.select([self.master], [], [], 0.2)[0]:
            try:
                chunk = os.read(self.master, 65536)
            except OSError:
                chunk = b""
            self.ui_digest.update(chunk)
            self.screen = (self.screen + ANSI.sub("", chunk.decode(errors="replace")))[-160000:]

    def wait(self, predicate, phase, timeout=240):
        print("Checking: " + phase, flush=True)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.pump()
            if predicate():
                return
            if self.process.poll() is not None:
                # Exit may itself be the awaited condition, becoming true
                # between the predicate and the process-state check.
                if predicate():
                    return
                raise RuntimeError("TUI exited during " + phase)
        raise TimeoutError("TUI timeout during " + phase)

    def approve_coding(self):
        def valid_request():
            calls = [c for m in self.messages() if m.get("role") == "assistant"
                     for c in m.get("content", []) if c.get("type") == "toolCall"
                     and c.get("name") == "request_coding_access"]
            if not calls or "Approve plan and allow coding" not in self.screen:
                return False
            request = calls[-1].get("arguments", {})
            if request.get("scope") != ["math.mjs"] or request.get("complexity") != "complex":
                raise RuntimeError("coding request differs from the synthetic approval scope")
            return True
        self.wait(valid_request, "bounded coding approval")
        self.send("\r")
        self.wait(lambda: self.result("request_coding_access", "CODING_ACCESS_GRANTED"), "coding grant")

    def stop(self):
        if self.closed:
            return self.process.poll() == 0
        graceful = True
        try:
            if self.process.poll() is None:
                self.send("\x04")
                try:
                    # A real terminal continues reading while Pi redraws/exits.
                    # Waiting without draining a PTY can block its final writes.
                    self.wait(lambda: self.process.poll() is not None, "normal exit", timeout=5)
                except TimeoutError:
                    graceful = False
                    self.process.send_signal(signal.SIGTERM)
                    try:
                        self.wait(lambda: self.process.poll() is not None, "termination cleanup", timeout=10)
                    except TimeoutError:
                        self.process.kill()
                        self.wait(lambda: self.process.poll() is not None, "forced cleanup", timeout=5)
        finally:
            os.close(self.master)
            self.closed = True
        return graceful and self.process.returncode == 0


def verify_cancel(command, project, env, sessions):
    before = digest(project / "math.mjs")
    tui = Tui(command, project, env, sessions, CANCEL_PROMPT)
    children = set()
    stopped = False
    try:
        def child_started():
            table = processes()
            running = descendants(tui.process.pid, table)
            # Pi replaces argv with its process title after startup.
            models = {pid for pid in running if "/dist/cli.js" in table[pid][1]
                      or table[pid][1].split()[0] in {"pi", "pi-rpc", "omp", "omp-rpc"}}
            if models:
                children.update(models)
            return bool(models) and any(c.get("name") == "delegate_readonly_agent"
                for m in tui.messages() for c in m.get("content", []) if c.get("type") == "toolCall")
        tui.wait(child_started, "real child process before cancellation")
        tui.send("\x1b")
        tui.wait(lambda: not children.intersection(processes()) and (
            tui.result("delegate_readonly_agent", "DIRECT_CHILD_CANCELLED") or
            any(m.get("stopReason") == "aborted" for m in tui.messages())), "cancelled child cleanup", timeout=30)
        remaining = descendants(tui.process.pid, processes())
        clean_exit = tui.stop()
        stopped = True
        assert clean_exit, "normal exit required forced termination"
        deadline = time.monotonic() + 10
        while remaining.intersection(processes()) and time.monotonic() < deadline:
            time.sleep(0.2)
        assert not remaining.intersection(processes()), "child processes remain after normal exit"
        assert digest(project / "math.mjs") == before, "cancelled read-only child changed source"
        return {"observedChildCount": len(children), "childrenReaped": True, "normalExit": True}
    finally:
        if not stopped:
            tui.stop()


def run(args):
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    workspace = Path(tempfile.mkdtemp(prefix="omp-live-", dir=output.parent))
    # A project under the operator's real HOME can inherit their .agents/skills
    # even when the process HOME is isolated. Keep project ancestry separate;
    # provider configuration remains outside the generic writable /tmp tree.
    project_workspace = Path(tempfile.mkdtemp(prefix="omp-live-project-", dir="/var/tmp")).resolve()
    project = project_workspace / "project"
    home = workspace / "home"
    config = home / ".pi/agent"
    project.mkdir()
    config.mkdir(parents=True, mode=0o700)
    env = {"HOME": str(home), "PATH": str(Path(args.command).resolve().parent) + ":" + os.environ.get("PATH", "/usr/bin:/bin"),
           "TERM": "xterm-256color", "LANG": "C.UTF-8", "PI_SKIP_VERSION_CHECK": "1",
           "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    archive_node = Path(args.command).resolve().parent.parent / "node/bin"
    if (archive_node / "node").is_file():
        env["PATH"] = str(archive_node) + ":" + env["PATH"]
    receipt = {"formatVersion": 1, "status": "BLOCKED", "model": MODEL,
               "harnessSha256": digest(__file__), "assertions": {}}
    active = None
    try:
        identity = json.loads(checked([args.command, "admin", "version", "--json"], env=env).stdout)
        if identity["sourceCommit"] != args.source_commit or identity["packageVersion"] != "0.4.0-preview.2":
            raise RuntimeError("installed candidate identity differs")
        receipt.update({"sourceCommit": args.source_commit, "version": identity["packageVersion"],
                        "distributionId": identity["distributionId"], "platform": identity["installation"]["platform"]})
        if not args.only_cancel:
            if not args.candidate_receipt:
                raise RuntimeError("full live acceptance requires the combined candidate receipt")
            candidate = json.loads(Path(args.candidate_receipt).read_text())
            platform = receipt["platform"]["os"] + "-" + receipt["platform"]["arch"]
            if (candidate.get("status") != "MULTIPLATFORM_CANDIDATE_NOT_PUBLISHED"
                    or candidate.get("sourceCommit") != args.source_commit
                    or candidate.get("version") != receipt["version"]
                    or candidate.get("platforms", {}).get(platform, {}).get("distributionId") != receipt["distributionId"]):
                raise RuntimeError("combined candidate identity differs")
            receipt["buildReceiptSha256"] = digest(args.candidate_receipt)
        if args.model_config:
            provider = json.loads(Path(args.model_config).read_text())["providers"]["cc-switch-kimi-for-coding"]
        else:
            key = os.environ.pop("OMP_KIMI_TEST_API_KEY", "")
            if not key:
                raise RuntimeError("Kimi test key is missing")
            provider = {"baseUrl": "https://api.kimi.com/coding", "api": "anthropic-messages", "apiKey": key,
                        "models": [{"id": "kimi-for-coding", "name": "Kimi For Coding", "reasoning": True,
                                    "input": ["text"], "contextWindow": 262144, "maxTokens": 32768}]}
        model_file = config / "models.json"
        model_file.write_text(json.dumps({"providers": {"cc-switch-kimi-for-coding": provider}}))
        model_file.chmod(0o600)
        (config / "settings.json").write_text(json.dumps({"defaultProvider": "cc-switch-kimi-for-coding", "defaultModel": "kimi-for-coding"}))
        (project / ".pi").mkdir()
        gate = {"$schema": "project-gates-v1.schema.json", "formatVersion": 1, "id": "native-live-fixture",
                "gates": [{"id": "unit", "description": "Signed addition", "command": "node", "args": ["test.mjs"],
                           "cwd": ".", "timeoutSeconds": 10, "env": {}}]}
        (project / ".pi/only-my-pi-gates.json").write_text(json.dumps(gate))
        (project / "AGENTS.md").write_text("Synthetic acceptance project. Only math.mjs may change. Verify with node test.mjs. Do not commit or inspect outside this project.\n")
        (project / "math.mjs").write_text("export const add = (a, b) => Math.abs(a + b);\n")
        (project / "test.mjs").write_text("import assert from 'node:assert/strict';import {add} from './math.mjs';assert.equal(add(-2,-3),-5);assert.equal(add(2,3),5);console.log('PASS');\n")
        (project / "preserve.txt").write_text("baseline\n")
        (project / ".gitignore").write_text(".pi/subagents/\n.pi/settings.json\n")
        (project / ".bashrc").touch()
        original_empty_inode = (project / ".bashrc").stat().st_ino
        checked(["git", "init", "-q"], cwd=project, env=env)
        checked(["git", "config", "user.name", "OMP Acceptance"], cwd=project, env=env)
        checked(["git", "config", "user.email", "acceptance@example.invalid"], cwd=project, env=env)
        checked(["git", "add", "."], cwd=project, env=env)
        checked(["git", "commit", "-qm", "synthetic baseline"], cwd=project, env=env)
        baseline = checked(["git", "rev-parse", "HEAD"], cwd=project, env=env).stdout.strip()
        (project / "preserve.txt").write_text("Pre-existing user fixture; do not change.\n")
        before = digest(project / "math.mjs")
        if args.only_cancel:
            receipt["cancellation"] = verify_cancel(args.command, project, env, config / "sessions")
            receipt["assertions"]["cancel-and-cleanup"] = True
            receipt["status"] = "NATIVE_CANCEL_ACCEPTANCE_PASS"
            return
        active = Tui(args.command, project, env, config / "sessions", READ_PROMPT)
        active.wait(lambda: "(Preview) · Inspect" in active.screen and "Build (sandboxed" in active.screen, "initial Inspect with active sandbox")
        active.wait(lambda: active.result("delegate_readonly_agent", "DIRECT_CHILD_COMPLETED") and active.finished(), "read-only scout")
        assert digest(project / "math.mjs") == before, "Inspect changed source"
        receipt["assertions"]["models-and-inspect"] = True
        receipt["assertions"]["readonly-subagents"] = True
        active.send(WRITE_PROMPT + "\r")
        active.approve_coding()
        active.wait(lambda: "Run clone verification before integrating this patch?" in active.screen
                    and '"test.mjs"' in active.screen, "runtime clone gate approval")
        active.send("\r")
        active.wait(lambda: active.result("delegate_managed_writer", "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION") and active.finished(), "managed writer and fresh review")
        writer = active.result("delegate_managed_writer", "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION")["details"]
        assert writer["verificationReceipt"]["status"] == "PASS" and writer["reviewer"]["verdict"] == "pass"
        assert "PASS" in checked(["node", "test.mjs"], cwd=project, env=env).stdout
        assert any(m.get("toolName") == "bash" and any("PASS" in c.get("text", "") for c in m.get("content", [])) for m in active.messages()), "main agent did not verify real worktree"
        receipt["assertions"].update({"coding-approval": True, "managed-clone-writer": True, "project-gates-and-review": True})
        session = active.session
        receipt["mainSessionSha256"] = digest(session)
        assert active.stop(), "main session required forced termination"
        active = None
        fixed = digest(project / "math.mjs")
        active = Tui(args.command, project, env, config / "sessions", RESUME_PROMPT, resume=session)
        active.wait(lambda: "(Preview) · Inspect" in active.screen, "resume Inspect")
        active.wait(lambda: "Approve plan and allow coding" in active.screen, "resume reapproval")
        active.send("\x1b[B\x1b[B\r")
        active.wait(lambda: active.result("request_coding_access", "CODING_ACCESS_DENIED") and active.finished(), "denied resume")
        assert digest(project / "math.mjs") == fixed, "resume wrote without approval"
        receipt["assertions"]["resume-reapproval"] = True
        receipt["resumedSessionSha256"] = digest(session)
        assert active.stop(), "resumed session required forced termination"
        active = None
        result = checked([args.command, "--model", MODEL, "-p", "Read math.mjs and report add(-2,-3). Also try creating unexpected.txt; if unavailable explain briefly."], cwd=project, env=env)
        assert "-5" in result.stdout and not (project / "unexpected.txt").exists()
        assert digest(project / "math.mjs") == fixed
        receipt["assertions"]["readonly-headless"] = True
        receipt["cancellation"] = verify_cancel(args.command, project, env, config / "sessions")
        receipt["assertions"]["cancel-and-cleanup"] = True
        assert (project / "preserve.txt").read_text() == "Pre-existing user fixture; do not change.\n"
        assert (project / ".bashrc").stat().st_ino == original_empty_inode and (project / ".bashrc").stat().st_size == 0
        assert checked(["git", "rev-parse", "HEAD"], cwd=project, env=env).stdout.strip() == baseline
        changes = checked(["git", "status", "--porcelain"], cwd=project, env=env).stdout.splitlines()
        assert sorted(changes) == [" M math.mjs", " M preserve.txt"], "unexpected project side effects"
        receipt["assertions"]["unknown-files-preserved"] = True
        receipt["status"] = "NATIVE_LIVE_ACCEPTANCE_PASS"
        receipt["notCovered"] = ["legacy-migration", "path-shadow-detection", "public-registry-installation"]
    except Exception as error:
        receipt["failure"] = type(error).__name__ + ": " + str(error)[:500]
        raise
    finally:
        try:
            if active:
                active.stop()
        except Exception:
            receipt["status"] = "BLOCKED"
            receipt["failure"] = "TUI cleanup failed"
            raise
        finally:
            try:
                (output / "acceptance.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
            finally:
                try:
                    shutil.rmtree(workspace)
                finally:
                    shutil.rmtree(project_workspace)
            print(json.dumps({"status": receipt["status"], "assertions": list(receipt["assertions"]), "output": str(output)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-config")
    parser.add_argument("--candidate-receipt", help="verified combined build receipt; required for full acceptance")
    parser.add_argument("--only-cancel", action="store_true", help="diagnostic subset; never full release evidence")
    run(parser.parse_args())

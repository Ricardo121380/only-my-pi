import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ownershipError } from "../host/ownership.mjs";
import { resolveLocalPath } from "./session-selection.mjs";
import { openValidatedSession } from "./session-history.mjs";
import { readSessionCwd } from "./session-admission.mjs";

async function validateCwd(cwd) {
  let directory;
  try { directory = await fs.stat(cwd); }
  catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
  }
  if (!directory?.isDirectory()) throw ownershipError("SESSION_CWD_INVALID");
}

async function validateSessionCwd(file, override) {
  const cwd = override ?? await readSessionCwd(file);
  await validateCwd(cwd);
  return cwd;
}

// OMP owns the public runtime contract, composing an SDK runtime for operations
// that already support admission. No Pi prototype/private fields are accessed.
// Keep this off the normal TUI route until picker callers are admitted.
export async function createAdmittedSessionRuntime({ sdk, admissions, sessionFile, sessionDir, sessionManager, cwdOverride, createRuntime, prepareResume, onFatal }) {
  if (Boolean(sessionFile) === Boolean(sessionManager)) throw ownershipError("SESSION_TARGET_INVALID");
  let manager;
  if (sessionManager) {
    manager = await admissions.admitCreatedManager(sessionManager);
    await validateCwd(manager.getCwd());
  } else {
    const lease = await admissions.admit(sessionFile);
    await validateSessionCwd(lease.file, cwdOverride);
    manager = await openValidatedSession(lease.file, sdk, sessionDir, cwdOverride, admissions.configRoot);
  }

  let unsafe = false;
  const observed = new WeakSet(), unsubscribers = [];
  const observe = (session) => {
    const runner = session.extensionRunner;
    if (observed.has(runner)) return;
    observed.add(runner);
    // Pi reports handler errors without rejecting emit(). Such a shutdown is
    // not evidence that execution cleanup succeeded, even if dispose resolves.
    unsubscribers.push(runner.onError((error) => {
      if (["session_shutdown", "session_before_switch", "session_before_fork"].includes(error.event)) unsafe = true;
    }));
  };
  const factory = async (options) => {
    const result = await createRuntime(options);
    observe(result.session);
    return result;
  };
  const initial = await factory({ cwd: manager.getCwd(), agentDir: admissions.configRoot, sessionManager: manager });

  class AdmittedSessionRuntime {
    #runtime;
    #rebind;
    #beforeInvalidate;
    #transition;
    #closing = false;
    #disposal;
    #failed = false;

    #fail(error) {
      unsafe = true;
      this.#failed = true;
    }

    constructor(result) { this.#install(result); }
    #install(result) {
      this.#runtime = new sdk.AgentSessionRuntime(result.session, result.services, factory,
        result.diagnostics, result.modelFallbackMessage);
      this.#runtime.setRebindSession(this.#rebind);
      this.#runtime.setBeforeSessionInvalidate(this.#beforeInvalidate);
    }
    get session() { return this.#runtime.session; }
    get services() { return this.#runtime.services; }
    get cwd() { return this.#runtime.cwd; }
    get diagnostics() { return this.#runtime.diagnostics; }
    get modelFallbackMessage() { return this.#runtime.modelFallbackMessage; }
    setRebindSession(callback) { this.#rebind = callback; this.#runtime.setRebindSession(callback); }
    setBeforeSessionInvalidate(callback) {
      this.#beforeInvalidate = callback;
      this.#runtime.setBeforeSessionInvalidate(callback);
    }

    async #replace(action) {
      if (this.#closing) throw ownershipError("OWNER_CLOSING");
      if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
      // Reject overlapping replacements rather than queueing stale UI/context
      // requests against a different session. This also avoids reentrant waits.
      if (this.#transition) throw ownershipError("SESSION_TRANSITION_IN_PROGRESS");
      const operation = Promise.resolve().then(action);
      this.#transition = operation;
      try { return await operation; }
      catch (error) {
        if (this.#failed && onFatal) {
          // The action has settled. Fatal disposal must not wait on itself,
          // nor return control to Pi's immediate-exit TUI error handler first.
          this.#transition = undefined;
          await onFatal(error);
        }
        throw error;
      }
      finally { this.#transition = undefined; }
    }

    async #resume(targetFile, targetCwd, createManager, options) {
      const current = this.session;
      observe(current);
      const runner = current.extensionRunner;
      const decision = await runner.emit({ type: "session_before_switch", reason: "resume", targetSessionFile: targetFile });
      if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
      if (decision?.cancel === true) return { cancelled: true };
      const projectTrustContext = options?.projectTrustContextFactory?.(targetCwd)
        ?? { ...runner.createContext(), cwd: targetCwd };
      // Trust dialogs must use the still-live outgoing UI, before teardown.
      await prepareResume?.({ cwd: targetCwd, projectTrustContext });
      // Copy/migrate only after a confirmed before-switch event. The public SDK
      // runtime swallows extension errors; compose these boundaries ourselves.
      const next = await createManager();
      await current.abort();
      await runner.emit({ type: "session_shutdown", reason: "resume", targetSessionFile: next.getSessionFile() });
      if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
      this.#beforeInvalidate?.();
      current.dispose();
      this.#install(await factory({ cwd: next.getCwd(), agentDir: this.services.agentDir, sessionManager: next,
        sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile: current.sessionFile },
        projectTrustContext }));
      await this.#rebind?.(this.session);
      await options?.withSession?.(this.session.createReplacedSessionContext());
      return { cancelled: false };
    }

    switchSession(file, options) {
      return this.#replace(async () => {
        const target = await admissions.admit(file);
        // Preflight without SessionManager.open: migration must not precede a
        // recoverable directory correction, nor invalidate the current runtime.
        const targetCwd = await validateSessionCwd(target.file, options?.cwdOverride);
        // Admission errors leave the existing runtime usable. Once extension
        // lifecycle begins, an error can leave cleanup unconfirmed.
        try {
          return await this.#resume(target.file, targetCwd,
            () => openValidatedSession(target.file, sdk, undefined, options?.cwdOverride, admissions.configRoot), options);
        } catch (error) { this.#fail(error); throw error; }
      });
    }

    newSession(options) {
      return this.#replace(async () => {
        try {
          const current = this.session;
          observe(current);
          const runner = current.extensionRunner;
          const decision = await runner.emit({ type: "session_before_switch", reason: "new" });
          if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
          if (decision?.cancel === true) return { cancelled: true };
          // One identity, reserved before even the first SessionManager exists.
          // Passing parentSession into create avoids a second generated ID.
          const next = current.sessionManager.isPersisted()
            ? await admissions.create(this.cwd, current.sessionManager.getSessionDir(), { parentSession: options?.parentSession })
            : await admissions.createMemory(this.cwd, { parentSession: options?.parentSession });
          await current.abort();
          await runner.emit({ type: "session_shutdown", reason: "new", targetSessionFile: next.getSessionFile() });
          if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
          this.#beforeInvalidate?.();
          current.dispose();
          this.#install(await factory({ cwd: this.cwd, agentDir: this.services.agentDir, sessionManager: next,
            sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile: current.sessionFile } }));
          if (options?.setup) {
            await options.setup(this.session.sessionManager);
            this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
          }
          await this.#rebind?.(this.session);
          await options?.withSession?.(this.session.createReplacedSessionContext());
          return { cancelled: false };
        } catch (error) { this.#fail(error); throw error; }
      });
    }
    fork(entryId, options) {
      return this.#replace(async () => {
        const current = this.session, position = options?.position ?? "before";
        observe(current);
        const decision = await current.extensionRunner.emit({ type: "session_before_fork", entryId, position });
        if (unsafe) {
          const error = ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
          this.#fail(error); throw error;
        }
        if (decision?.cancel === true) return { cancelled: true };
        const selected = current.sessionManager.getEntry(entryId);
        if (!selected || !["before", "at"].includes(position)
          || (position === "before" && (selected.type !== "message" || selected.message.role !== "user")))
          throw ownershipError("SESSION_FORK_ENTRY_INVALID");
        const leafId = position === "at" ? selected.id : selected.parentId;
        const content = position === "before" ? selected.message.content : undefined;
        const selectedText = typeof content === "string" ? content
          : content?.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
        // Validate the saved source before entering a potentially partial write.
        const persisted = current.sessionManager.isPersisted();
        if (leafId && persisted) await admissions.admit(current.sessionFile);
        try {
          const next = persisted
            ? await admissions.create(this.cwd, current.sessionManager.getSessionDir(), leafId
              ? { sourceFile: current.sessionFile, leafId } : { parentSession: current.sessionFile })
            : await admissions.createMemory(this.cwd, leafId
              ? { entries: [current.sessionManager.getHeader(), ...current.sessionManager.getEntries()], leafId } : {});
          await current.abort();
          await current.extensionRunner.emit({ type: "session_shutdown", reason: "fork", targetSessionFile: next.getSessionFile() });
          if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
          this.#beforeInvalidate?.();
          current.dispose();
          this.#install(await factory({ cwd: this.cwd, agentDir: this.services.agentDir, sessionManager: next,
            sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile: current.sessionFile } }));
          await this.#rebind?.(this.session);
          await options?.withSession?.(this.session.createReplacedSessionContext());
          return { cancelled: false, selectedText };
        } catch (error) { this.#fail(error); throw error; }
      });
    }
    importFromJsonl(inputPath, cwdOverride) {
      return this.#replace(async () => {
        // An in-memory manager has no destination directory. Refuse before
        // copying or teardown; explicit resume can select a persisted history.
        if (!this.session.sessionManager.isPersisted()) throw ownershipError("SESSION_TARGET_INVALID");
        if (typeof inputPath !== "string" || !inputPath.length) throw ownershipError("SESSION_TARGET_INVALID");
        const resolved = resolveLocalPath(inputPath, process.cwd());
        const source = await admissions.admit(resolved, { allowOwnedId: true });
        const targetCwd = await validateSessionCwd(source.file, cwdOverride);
        try {
          const sessionDir = this.session.sessionManager.getSessionDir();
          let destination = path.join(sessionDir, path.basename(source.file));
          const alreadyStored = path.resolve(destination) === source.file;
          if (!alreadyStored) {
            const { name, ext } = path.parse(destination);
            let suffix = 1;
            while (await fs.lstat(destination).then(() => true, (error) => {
              if (error.code === "ENOENT") return false;
              throw error;
            })) destination = path.join(sessionDir, `${name}-${suffix++}${ext}`);
          }
          return await this.#resume(destination, targetCwd, async () => {
            if (!alreadyStored) {
              await fs.mkdir(sessionDir, { recursive: true });
              await fs.copyFile(source.file, destination, constants.COPYFILE_EXCL);
            }
            await admissions.admitOwnedCopy(source.file, destination);
            return openValidatedSession(destination, sdk, sessionDir, cwdOverride, admissions.configRoot);
          });
        } catch (error) { this.#fail(error); throw error; }
      });
    }

    dispose() {
      if (this.#disposal) return this.#disposal;
      this.#closing = true;
      this.#disposal = (async () => {
        // Stop accepting transitions immediately, but let the current one settle
        // before choosing which session to abort/dispose. Never release on quit
        // notification alone: all shutdown handlers must finish first.
        try { await this.#transition; } catch { /* Its caller receives the error. */ }
        observe(this.session);
        try {
          await this.session.abort();
          await this.#runtime.dispose();
        } catch (error) { unsafe = true; throw error; }
        if (unsafe) throw ownershipError("SESSION_LIFECYCLE_UNCONFIRMED");
        await admissions.close();
        for (const unsubscribe of unsubscribers) unsubscribe();
      })();
      return this.#disposal;
    }
  }

  return new AdmittedSessionRuntime(initial);
}

import { createReadOnlySessionPicker } from "./session-picker.mjs";

const resumeErrors = new Set(["SESSION_OWNERSHIP_UNAVAILABLE", "SESSION_TARGET_CHANGED",
  "SESSION_TARGET_INVALID", "SESSION_HEADER_INVALID", "SESSION_CWD_INVALID",
  "SESSION_TRANSITION_IN_PROGRESS", "SESSION_LIFECYCLE_UNCONFIRMED", "OWNER_CLOSING"]);

// InteractiveMode copies its native callbacks onto custom editors after their
// construction. Route at the public input boundary, after that wiring completes.
export function createResumeEditorFactory(sdk, onResume) {
  return (tui, theme, keybindings) => new class extends sdk.CustomEditor {
    handleInput(data) {
      this.onAction("app.session.resume", onResume);
      const submit = this.onSubmit;
      this.onSubmit = (text) => text.trim() === "/resume" ? onResume() : submit?.(text);
      try { super.handleInput(data); }
      finally { this.onSubmit = submit; }
    }
  }(tui, theme, keybindings);
}

// Private runtime integration; install as an extension factory in every runtime
// creation. Other extensions replacing this editor remain an admission blocker
// for the full installation stack, not something this adapter silently patches.
export function createResumeUiExtension({ sdk, getRuntime }) {
  return (pi) => {
    let generation;
    pi.on("session_shutdown", () => { generation = undefined; });
    pi.on("session_start", (_event, ctx) => {
      const token = generation = {};
      let selecting = false;
      const resume = async () => {
        if (selecting || generation !== token) return;
        selecting = true;
        const runtime = getRuntime(), session = runtime.session;
        const manager = session.sessionManager;
        let draft;
        try {
          const file = await ctx.ui.custom((tui, _theme, keybindings, done) =>
            createReadOnlySessionPicker({ sdk, keybindings,
              currentSessions: (progress) => sdk.SessionManager.list(manager.getCwd(), manager.getSessionDir(), progress),
              allSessions: (progress) => manager.usesDefaultSessionDir()
                ? sdk.SessionManager.listAll(progress) : sdk.SessionManager.listAll(manager.getSessionDir(), progress),
              onSelect: done, onCancel: () => done(null), requestRender: () => tui.requestRender() }));
          if (!file) return;
          if (generation !== token || runtime.session !== session) return; // Includes reload of the same session.
          draft = ctx.ui.getEditorText();
          ctx.ui.setEditorText("");
          let result;
          const projectTrustContextFactory = (cwd) => ({ cwd, mode: "tui", hasUI: true, ui: ctx.ui });
          try { result = await runtime.switchSession(file, { projectTrustContextFactory }); }
          catch (error) {
            if (error?.code !== "SESSION_CWD_INVALID" || generation !== token || runtime.session !== session) throw error;
            const confirmed = await ctx.ui.confirm("历史工作目录不可用", `是否在当前项目目录继续？\n${runtime.cwd}`);
            if (generation !== token || runtime.session !== session) return;
            if (!confirmed) { ctx.ui.setEditorText(draft); return; }
            result = await runtime.switchSession(file, { cwdOverride: runtime.cwd, projectTrustContextFactory });
          }
          if (result?.cancelled && generation === token && runtime.session === session) ctx.ui.setEditorText(draft);
        } catch (error) {
          // Error messages can contain paths/provider details; show only known
          // admission codes. Do not continue using an invalidated extension ctx.
          if (generation === token && runtime.session === session) {
            if (draft !== undefined) ctx.ui.setEditorText(draft);
            ctx.ui.notify(resumeErrors.has(error?.code) ? error.code : "SESSION_RESUME_FAILED", "error");
          }
        } finally { selecting = false; }
      };
      ctx.ui.setEditorComponent(createResumeEditorFactory(sdk, resume));
    });
  };
}

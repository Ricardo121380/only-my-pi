import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ownershipError } from "../host/ownership.mjs";

// Use the public Pi component, but replace its public deletion callback before
// input starts. Discovery must never mutate a history that has not been admitted.
export function createReadOnlySessionPicker({ sdk, currentSessions, allSessions, onSelect, onCancel, requestRender, keybindings }) {
  const selector = new sdk.SessionSelectorComponent(currentSessions, allSessions,
    onSelect, onCancel, onCancel, requestRender, { showRenameHint: false, keybindings });
  const list = selector.getSessionList();
  list.onDeleteSession = async () => {
    list.onError?.("OMP resume selection is read-only; deletion is disabled");
  };
  return selector;
}

export async function selectResumeSession({ sdk, sdkFile, currentSessions, allSessions }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw ownershipError("SESSION_PICKER_TTY_REQUIRED");
  // Resolve the public TUI package from the selected SDK, not an ambient package.
  const require = createRequire(sdkFile);
  const { ProcessTerminal, TuiMainScreen, Text, KeybindingsManager, TUI_KEYBINDINGS, getKeybindings, setKeybindings } = await import(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
  const previousBindings = getKeybindings();
  const keybindings = new KeybindingsManager({ ...TUI_KEYBINDINGS,
    "app.session.toggleSort": { defaultKeys: "ctrl+s" },
    "app.session.toggleNamedFilter": { defaultKeys: "ctrl+n" },
    "app.session.togglePath": { defaultKeys: "ctrl+p" },
  });
  // No theme watcher or package discovery during read-only selection. Main will
  // load the user's configured theme and resources after session admission.
  sdk.initTheme("dark", false);
  const ui = new TuiMainScreen(new ProcessTerminal());
  try {
    setKeybindings(keybindings);
    return await new Promise((resolve) => {
      const selector = createReadOnlySessionPicker({ sdk, currentSessions, allSessions,
        onSelect: resolve, onCancel: () => resolve(null), requestRender: () => ui.requestRender(), keybindings });
      ui.addChild(new Text("OMP: read-only selection (no delete/rename). Enter: resume; Escape: cancel.", 0, 0));
      ui.addChild(selector);
      ui.setFocus(selector.getSessionList());
      ui.start();
    });
  } finally { ui.stop(); setKeybindings(previousBindings); }
}

export async function confirmStartupProjectTrust({ sdk, sdkFile, cwd }) {
  return startupChoice({ sdk, sdkFile, title: `项目资源信任\n${cwd}\n允许加载项目设置与资源；这不是编程写入授权。`,
    deny: "不信任，继续使用全局资源", allow: "仅本次信任此项目" });
}

export async function confirmStartupSessionCwd({ sdk, sdkFile, file, cwd }) {
  return startupChoice({ sdk, sdkFile, title: `历史工作目录不可用\n${file}\n是否在当前目录 ${cwd} 恢复？历史头中的原目录保持不变。`,
    deny: "取消恢复", allow: "在当前项目目录恢复" });
}

async function startupChoice({ sdk, sdkFile, title, deny, allow }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw ownershipError("TUI_TTY_REQUIRED");
  const require = createRequire(sdkFile);
  const { ProcessTerminal, TuiMainScreen } = await import(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
  sdk.initTheme("dark", false);
  const ui = new TuiMainScreen(new ProcessTerminal());
  let selector;
  try {
    return await new Promise((resolve) => {
      selector = new sdk.ExtensionSelectorComponent(title,
        [deny, allow], (selected) => resolve(selected === allow), () => resolve(false), { tui: ui });
      ui.addChild(selector); ui.setFocus(selector); ui.start();
    });
  } finally { selector?.dispose(); ui.stop(); }
}

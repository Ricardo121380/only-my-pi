import type { AccountAction, AccountInput, HostCommand, HostEvent, HostSnapshot } from "../../packages/host/contracts";
export async function accountApi<T>(input: AccountInput | { accountId: string; action: AccountAction }): Promise<T> {
  const response = await fetch("accountId" in input ? "/api/account-action" : "/api/accounts", { credentials: "same-origin", cache: "no-store", method: "POST", headers: { "content-type": "application/json", "x-omp-account-protocol": "1" }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.code ?? "HOST_REQUEST_FAILED");
  return data;
}
export async function api<T>(url: string, command?: HostCommand, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: "same-origin", cache: "no-store", ...(command ? { method: "POST", headers: { "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify(command) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.code ?? "HOST_REQUEST_FAILED");
  return data;
}
export const query = (route: string, values: Record<string, string | number>) => `/api/${route}?${new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))}`;
export const errorText = (error: unknown) => {
  const code = error instanceof Error ? error.message : "HOST_REQUEST_FAILED";
  const accountMessages: Record<string, string> = {
    MODEL_RESULT_RECONCILIATION_REQUIRED: "分类请求结果未知，额度仍被占用，消息队列已暂停。请按请求编号核对服务端结果；不会自动重试或返还额度。",
    THINKING_LEVEL_UNAVAILABLE: "当前模型不支持所选思考强度，请刷新模型列表后重选。",
    THINKING_LEVEL_MISMATCH: "运行时实际思考强度与选择不一致，任务已停止，未发送提示词。请刷新模型列表后重选。",
    TERMINAL_RECONCILIATION_REQUIRED: "终端清理尚未确认，项目占用仍保留。请核对遗留程序；重新连接不会抢锁或重启命令。",
    TERMINAL_INPUT_CONFLICT: "终端输入序号冲突，可能有另一个页面正在输入。已暂停发送，请重新连接；不会重放命令。",
    TERMINAL_INPUT_LIMIT: "输入过大或发送积压，已暂停发送。请重新连接后分段输入；不会自动重试。",
    TERMINAL_NOT_RUNNING: "终端已经停止或正在清理，不能继续输入。",
    TERMINAL_LIMIT: "最多同时运行 4 个终端，请先结束一个终端。",
    FILE_VERSION_CONFLICT: "磁盘内容已变化，未覆盖文件，草稿已保留。请先复制所需草稿，再重新读取并合并；不会强制覆盖。",
    FILE_ENCODING_UNSUPPORTED: "文件不是有效 UTF-8 文本，不能安全编辑。请使用支持原编码的本机编辑器。",
    MANUAL_MODE_REQUIRED: "手动模式已失效或由其他页面退出。草稿仍在，请重新进入手动模式再保存。",
    FILE_SAVE_UNSAFE: "此文件不是可安全替换的普通文件，可能存在硬链接；保存已拒绝。",
    FILE_SAVE_INVALID: "保存内容无效：仅支持不含 NUL 的 UTF-8 文本，最多 512KB。",
    EDITOR_TAB_LIMIT: "最多同时打开 12 个文件，请先关闭一个标签。",
    APPROVAL_EXPIRED: "此审批已失效或已被处理，不能再次批准；请等待宿主状态更新。",
    RPC_REVOKE_UNCONFIRMED: "撤权未得到确认，宿主已请求停止进程；请检查任务终态，不要重发写入。",
    CONTROLLED_MODE_UNAVAILABLE: "当前宿主尚未开放受控编程，请继续只读分析。",
    OWNERSHIP_HELD: "项目或会话正被其他任务占用，请等待其进程退出后再试。",
    SESSION_IN_USE: "此会话仍在运行，不能同时续接。请查看当前任务，或停止并等待进程退出。",
    SESSION_IDENTITY_CHANGED: "历史文件在检查后发生变化，已拒绝续接；请刷新历史列表重新核对。",
    CONTROLLED_ORPHAN_REQUIRES_RECONCILIATION: "宿主异常退出，遗留执行进程尚未核对。写入锁继续保留，不能直接重试或抢占。",
    RPC_TERMINATION_UNCONFIRMED: "执行进程退出尚未确认，账号及写入锁仍被保留；请先核对遗留进程，不要重发任务。",
    ACCOUNT_BUSY: "账号正在被任务或认证操作使用，请停止任务并等待进程退出后重试。",
    ACCOUNT_READ_ONLY: "CLI 配置是只读引用，请在 CLI 中管理，WebUI 不会修改它。",
    ACCOUNT_NOT_FOUND: "账号已不存在，请刷新并重新选择。",
    ACCOUNT_BINDING_REQUIRED: "请先明确选择账号，再选择模型。",
    ACCOUNT_AUTH_FAILED: "认证未完成。请检查凭据和网络，再查询认证状态；不会自动换用其他账号。",
    ACCOUNT_AUTH_CANCELLED: "认证已取消，可重新查询状态。",
    ACCOUNT_PROVIDER_INVALID: "Provider 配置无效：请检查地址、协议和模型参数。",
    ACCOUNT_INPUT_INVALID: "账号输入无效，请检查 Provider ID 和名称。",
    PROTOCOL_MISMATCH: "页面与 Host 版本不兼容，请刷新页面；不要重复提交旧请求。",
    REQUEST_ID_CONFLICT: "此请求编号已绑定其他内容或账号，请新建任务。",
  };
  if (accountMessages[code]) return accountMessages[code];
  const messages: Record<string, string> = { AUTH_REQUIRED: "连接授权已失效，请在终端重新运行 omp web。", PAIR_EXPIRED: "配对链接已过期或已使用，请重新运行 omp web。", FILE_PREVIEW_LIMIT: "文件超过 512KB，暂不提供预览。", FILE_SYMLINK_DENIED: "为保护项目边界，不预览符号链接。", BINARY_PREVIEW_UNAVAILABLE: "二进制文件不支持文本预览。", MODEL_UNAVAILABLE: "所选模型不可用，请刷新模型列表。", REQUEST_CONFLICT: "请求内容已改变，请新建分析。" };
  return messages[code] ?? `操作未完成（${code}），可刷新重试；原输入已保留。`;
};
export function applyEvent(snapshot: HostSnapshot | null, event: HostEvent): HostSnapshot | null {
  if (event.type === "snapshot") { if (event.protocol !== 2) throw new Error("PROTOCOL_MISMATCH"); return event; }
  if (!snapshot || event.epoch !== snapshot.epoch || event.seq > snapshot.seq + 1) throw new Error("EVENT_GAP");
  if (event.seq <= snapshot.seq) return snapshot;
  return { ...snapshot, seq: event.seq, ...(event.type === "projects" ? { projects: event.data } : { tasks: [event.data, ...snapshot.tasks.filter((task) => task.taskId !== event.data.taskId)].slice(0, 100) }) };
}

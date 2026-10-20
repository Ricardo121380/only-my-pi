import type { McpAction, McpAuthentication } from "../../packages/mcp/contracts";
import { isMcpOAuthActive } from "../../packages/mcp/contracts";

const stateLabel = { not_connected: "尚未登录", connected: "OAuth 身份已保存", token: "已绑定手动凭据", expired: "身份已失效，需要刷新或重新登录", revoked: "凭据已撤销", binding_changed: "凭据与当前项目或目标不匹配", refresh_required: "刷新未完成，需要重新登录或显式刷新" };
const flowLabel = { starting: "正在准备登录", waiting: "等待你在授权页面完成操作", refreshing: "正在刷新，等待请求结束", cancelling: "正在取消，等待请求与存储结束", stored: "身份已原子保存", stored_sync_failed: "身份已保存，公开状态同步失败；请核对当前身份", publication_unconfirmed: "身份发布结果待核对；请重新显式登录", failed: "OAuth 操作失败", cancelled: "OAuth 操作已取消", timed_out: "OAuth 操作已超时", interrupted: "上次操作已中断，需要重新显式发起" };

export function McpOAuthControls({ name, revision, authentication, busy, onAction }: { name: string; revision: number; authentication?: McpAuthentication; busy: boolean; onAction: (action: McpAction, message: string) => void }) {
  const flow = authentication?.flow, active = flow && isMcpOAuthActive(flow.status);
  return <section aria-label={`${name} OAuth 身份`}>
    <p>身份：{stateLabel[authentication?.state ?? "not_connected"]}。登录仅绑定当前项目、此连接和目标。</p>
    {flow && <p role="status">{flowLabel[flow.status]}{flow.code && ` · ${flow.code}`}{flow.authorizationOrigin && flow.status === "waiting" && ` · 授权服务：${flow.authorizationOrigin}`}</p>}
    <div className="account-actions">
      <button className="softbtn" disabled={busy || Boolean(active)} onClick={() => onAction({ type: "oauthStart", name, revision }, "登录已准备；请显式打开授权页面。")}>{authentication?.ref ? "重新 OAuth 登录" : "开始 OAuth 登录"}</button>
      {authentication && ["connected", "expired", "refresh_required"].includes(authentication.state) && <button className="softbtn" disabled={busy || Boolean(active)} onClick={() => onAction({ type: "oauthRefresh", name, revision }, "刷新已开始，等待请求与安全存储结束。")}>显式刷新 OAuth</button>}
      {flow?.status === "waiting" && !flow.opened && <a className="softbtn" href={`/api/mcp-oauth/open?flowId=${encodeURIComponent(flow.flowId)}`} target="_blank" rel="noopener noreferrer">打开授权页面</a>}
      {flow && active && <button className="softbtn" disabled={busy || flow.status === "cancelling"} onClick={() => onAction({ type: "oauthCancel", flowId: flow.flowId }, "操作已结束；若身份已保存，请使用撤销凭据。")}>取消 OAuth {flow.kind === "refresh" ? "刷新" : "登录"}</button>}
    </div>
    <p>页面关闭后可返回查看状态。撤销凭据会阻断 OMP 的后续请求；服务端身份和已发生的效果须在授权服务核对。</p>
  </section>;
}

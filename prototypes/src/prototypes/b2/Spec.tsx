// Live specimen sheet for DESIGN.md. Everything below renders with the real
// tokens and components, so the sheet drifts only if the code does.
import type { CSSProperties, ReactNode } from "react";
import { BookOpen, Check, CheckCircle2, CircleDashed, FileDiff, Loader2, Lock, Moon, Sun, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ShinyText } from "@/components/magic";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/data/mock";
import { ApprovalDockCard, ArtifactLink, CommentRow, Empty, ReadingProse, UserBubble, WorkRecord } from "@/prototypes/ReadingRoomCoder";
import { useLayout } from "@/prototypes/b2/layout";

const palette = {
  surfaces: [
    { v: "--canvas", day: "#e9ece6", night: "#15171a", use: "窗口底色、侧栏、状态栏" },
    { v: "--background", day: "#f4f5f1", night: "#1b1e21", use: "对话面板、设置页" },
    { v: "--card", day: "#fbfcf9", night: "#202428", use: "卡片、工作区、输入框" },
    { v: "--secondary", day: "#e6e9e2", night: "#272c30", use: "用户消息、选中行" },
    { v: "--muted", day: "#eceee8", night: "#23282c", use: "工作记录、系统提示" },
    { v: "--line", day: "#d9ddd4", night: "#30363b", use: "分隔线与外圈" },
  ],
  ink: [
    { v: "--foreground", day: "#1e221d", night: "#e3e6df", use: "正文与标题" },
    { v: "--muted-foreground", day: "#5e655c", night: "#99a095", use: "说明与次要信息" },
    { v: "--primary", day: "#2c4a7c", night: "#9cb6e3", use: "主操作、链接、焦点" },
    { v: "--accent", day: "#e3e9f2", night: "#222d3c", use: "文件链接、选中文件" },
  ],
  states: [
    { v: "--inspect", day: "#6b7568", night: "#8f988b", use: "只读检查" },
    { v: "--planning", day: "#7a5306", night: "#d8a64a", use: "需要你决定" },
    { v: "--coding", day: "#276a48", night: "#6cc596", use: "授权生效、通过" },
    { v: "--destructive", day: "#c8372d", night: "#e8857a", use: "删除、失败" },
  ],
};

const typeScale = [
  { name: "Display", spec: "34px 阅读体 600", cls: "font-read text-[34px] leading-tight font-semibold tracking-tight", text: "在 only-my-pi 里做什么？" },
  { name: "H1", spec: "28px 阅读体 600", cls: "font-read text-[28px] leading-tight font-semibold tracking-tight", text: "账号与模型" },
  { name: "H2", spec: "20px 阅读体 600", cls: "font-read text-[20px] font-semibold", text: "更换“团队试用”的密钥" },
  { name: "Lead", spec: "15.5px 阅读体，次要色", cls: "font-read text-[15.5px] leading-relaxed text-muted-foreground", text: "调用模型时使用的身份。会话会记住所选账号。" },
  { name: "Reading", spec: "--read-size 阅读体，行距 1.75", cls: "font-read text-[length:var(--read-size,16.5px)] leading-[1.75]", text: "侦察完成。Host 的命令白名单在 contracts.mjs，写入者开始在受管克隆里实现。" },
  { name: "Body", spec: "14px 界面体", cls: "text-[14px]", text: "会话列表支持归档" },
  { name: "UI", spec: "13.5px 界面体", cls: "text-[13.5px]", text: "允许编程　先修改计划　不允许" },
  { name: "Meta", spec: "12.5px 次要色", cls: "text-[12.5px] text-muted-foreground", text: "4 个文件，+76 −6，在受管克隆中" },
  { name: "Caption", spec: "11.5px", cls: "text-[11.5px] text-muted-foreground", text: "已查看 2 / 4" },
  { name: "Code", spec: "12.5px 等宽", cls: "font-mono text-[12.5px]", text: "node --test tests/host-minimal-web.test.mjs" },
];

const sampleCalls: ToolCall[] = [
  { id: "s1", tool: "read", target: "packages/host/contracts.mjs", detail: "212 行", ms: 88, status: "done" },
  { id: "s2", tool: "grep", target: "\"sessionNavigation\" webui/src", detail: "2 处匹配", ms: 54, status: "done" },
  { id: "s3", tool: "bash", target: "npm run typecheck", detail: "", ms: 0, status: "running" },
];

export default function Spec() {
  const { night, setNight, readSize } = useLayout();
  return (
    <div className={cn("proto-b h-full overflow-y-auto bg-canvas text-foreground scrollbar-thin", night && "night")} style={{ "--read-size": `${readSize}px` } as CSSProperties}>
      <div className="mx-auto max-w-[1080px] px-8 py-10">
        <header className="mb-12 flex flex-wrap items-end gap-6">
          <div className="min-w-0 flex-1">
            <p className="font-read text-[17px] text-muted-foreground italic">Only My Pi</p>
            <h1 className="mt-1 font-read text-[40px] leading-tight font-semibold tracking-tight">静室，设计规范样张</h1>
            <p className="mt-2 max-w-[38rem] font-read text-[16px] leading-relaxed text-muted-foreground">
              页面里的颜色、字体和组件都来自原型的实际代码。文字说明在 <code className="font-mono text-[13px]">prototypes/DESIGN.md</code>，两者冲突时以代码为准并更新文档。
            </p>
          </div>
          <div className="flex gap-1 rounded-xl bg-secondary p-1" role="radiogroup" aria-label="主题">
            {[{ v: false, label: "日间", icon: Sun }, { v: true, label: "夜间", icon: Moon }].map((t) => (
              <button key={t.label} role="radio" aria-checked={night === t.v} onClick={() => setNight(t.v)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]", night === t.v ? "bg-card shadow-sm" : "text-muted-foreground")}>
                <t.icon className="size-3.5" />{t.label}
              </button>
            ))}
          </div>
        </header>

        <Section id="color" title="颜色" lead="纸色与墨蓝。状态色只表达状态：琥珀表示需要你决定，绿色表示授权生效或通过。">
          {(["surfaces", "ink", "states"] as const).map((group) => (
            <div key={group} className="mb-6">
              <p className="mb-2 text-[13px] text-muted-foreground">{{ surfaces: "表面", ink: "文字与操作", states: "状态" }[group]}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {palette[group].map((c) => (
                  <div key={c.v} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[0_0_0_1px_var(--line)]">
                    <span className="size-12 shrink-0 rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]" style={{ background: `var(${c.v})` }} />
                    <span className="min-w-0">
                      <span className="block font-mono text-[12.5px]">{c.v}</span>
                      <span className="block font-mono text-[11.5px] text-muted-foreground">{night ? c.night : c.day}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">{c.use}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Tint className="bg-planning/15 text-planning">待批准</Tint>
            <Tint className="bg-coding/12 text-coding">exit 0</Tint>
            <Tint className="bg-accent text-accent-foreground">待审查</Tint>
            <Tint className="bg-primary/12 text-primary">使用中</Tint>
            <Tint className="bg-secondary text-muted-foreground">继承默认</Tint>
            <Tint className="bg-destructive/10 text-destructive">密钥被拒绝</Tint>
          </div>
        </Section>

        <Section id="type" title="字体" lead="界面用 Inter Tight，Pi 的回复与标题用 Source Serif 4，路径和命令用 JetBrains Mono。阅读字号可在设置里调整。">
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
            {typeScale.map((t) => (
              <div key={t.name} className="grid items-baseline gap-2 px-5 py-4 sm:grid-cols-[9rem_1fr]">
                <p className="text-[12.5px]"><span className="font-medium">{t.name}</span><br /><span className="text-muted-foreground">{t.spec}</span></p>
                <p className={cn("min-w-0", t.cls)}>{t.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="shape" title="形状与层级" lead="层级越外圆角越大。面板用 1px 外圈，浮起的输入框与停靠栏才有柔和投影。">
          <div className="grid gap-4 sm:grid-cols-3">
            <Specimen label="面板 rounded-2xl，外圈"><div className="h-20 rounded-2xl bg-background shadow-[0_0_0_1px_var(--line)]" /></Specimen>
            <Specimen label="卡片 rounded-2xl，描边"><div className="h-20 rounded-2xl border border-line bg-card" /></Specimen>
            <Specimen label="浮起 rounded-[22px]，投影"><div className="h-20 rounded-[22px] border border-line bg-card shadow-[0_10px_30px_-18px_rgba(30,34,29,0.35)]" /></Specimen>
            <Specimen label="行内区块 rounded-xl"><div className="h-12 rounded-xl bg-muted" /></Specimen>
            <Specimen label="列表行 rounded-lg"><div className="h-9 rounded-lg bg-secondary" /></Specimen>
            <Specimen label="胶囊 rounded-full"><div className="flex gap-2"><Button size="sm" className="rounded-full">允许编程</Button><Tint className="bg-secondary text-muted-foreground">只读检查</Tint></div></Specimen>
          </div>
        </Section>

        <Section id="state" title="状态" lead="状态图标是固定的一套。状态胶囊里的文字依次对应任务的各个阶段。">
          <div className="mb-5 flex flex-wrap gap-5 text-[13px]">
            <span className="flex items-center gap-1.5"><Loader2 className="size-4 animate-spin text-primary" />运行中</span>
            <span className="flex items-center gap-1.5"><Check className="size-4 text-coding" />完成</span>
            <span className="flex items-center gap-1.5"><CircleDashed className="size-4 text-muted-foreground" />排队</span>
            <span className="flex items-center gap-1.5"><X className="size-4 text-destructive" />失败</span>
            <span className="flex items-center gap-1.5"><TriangleAlert className="size-4 text-planning" />需要处理</span>
            <span className="flex items-center gap-1.5"><Lock className="size-4 text-muted-foreground" />没有授权</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["bg-inspect", "只读检查"], ["bg-planning", "等待批准"], ["bg-coding", "写入中"], ["bg-coding", "待你决定"],
              ["bg-coding", "工作树验证中"], ["bg-coding", "已应用，未提交"], ["bg-coding", "已停止"],
            ].map(([dot, label]) => (
              <span key={label} className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", dot)} />{label}</span>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-muted-foreground">在任务里，状态点表示授权状态（编程中为绿色），文字表示当前阶段。<ShinyText>进行中的文字带扫光</ShinyText>，完成后立刻停止。</p>
        </Section>

        <Section id="components" title="组件" lead="下面都是原型里的实际组件，交互可用，但不连接任务状态。">
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen label="用户消息：普通、即时补充、审查意见">
              <div className="space-y-4">
                <UserBubble text="给侧栏加一个归档功能，归档后折叠到底部。" />
                <UserBubble text="归档按钮用图标就行，不要文字" tag="steer" landed={false} />
                <UserBubble text={"contracts.mjs:49  archived 需要校验为布尔值"} tag="review" landed />
              </div>
            </Specimen>
            <Specimen label="Pi 的回复，文件名可点">
              <ReadingProse text="侦察完成。Host 的命令白名单在 `contracts.mjs`，侧栏会话行由 `MinimalApp.tsx` 渲染；运行 `npm run typecheck` 验证。" />
            </Specimen>
            <Specimen label="工作记录，运行中自动展开">
              <WorkRecord calls={sampleCalls} summary="读了 1 个文件，搜索 1 次" thinking={6} />
            </Specimen>
            <Specimen label="产物链接">
              <div className="space-y-3">
                <ArtifactLink icon={BookOpen} title="实施计划" meta="5 步，5 个文件，两项风险" onOpen={() => {}} />
                <ArtifactLink icon={FileDiff} title="补丁 v2 已生成" meta="4 个文件，+76 −6，在受管克隆中" onOpen={() => {}} />
                <ArtifactLink icon={CheckCircle2} tone="coding" title="已应用到工作树" meta="补丁 v2，未暂存，未提交" onOpen={() => {}} />
              </div>
            </Specimen>
            <Specimen label="审批停靠栏，决定前一直可见">
              <ApprovalDockCard onApprove={() => {}} onRevise={() => {}} onDeny={() => {}} onPlan={() => {}} />
            </Specimen>
            <Specimen label="行内意见：审查者、你、已处理">
              <table className="w-full"><tbody>
                <CommentRow comment={{ id: "c1", file: "a", line: 49, author: "reviewer", resolved: false, text: "archived 没有校验类型，建议写成 archived === true。" }} onRemove={() => {}} />
                <CommentRow comment={{ id: "c2", file: "a", line: 44, author: "you", resolved: false, text: "导出一个 ARCHIVE_COMMANDS 常量，测试里也复用" }} onRemove={() => {}} />
                <CommentRow comment={{ id: "c3", file: "a", line: 12, author: "you", resolved: true, text: "命名和 restoreSession 保持一致" }} onRemove={() => {}} />
              </tbody></table>
            </Specimen>
            <Specimen label="按钮">
              <div className="flex flex-wrap items-center gap-2">
                <Button className="rounded-full">允许编程</Button>
                <Button variant="outline" className="rounded-full">先修改计划</Button>
                <Button variant="ghost" className="rounded-full text-muted-foreground">不允许</Button>
                <Button className="rounded-full bg-coding text-[var(--coding-foreground)] hover:bg-coding/90">确认应用 v2</Button>
                <Button variant="destructive" className="rounded-full">删除“团队试用”</Button>
                <Button className="rounded-full" disabled>应用到工作树</Button>
              </div>
              <p className="mt-3 text-[12.5px] text-muted-foreground">绿色按钮只用于最终确认应用；红色只用于删除。</p>
            </Specimen>
            <Specimen label="空状态">
              <div className="h-56 rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
                <Empty icon={Lock} title="还没有改动" body="允许编程后，写入者在受管克隆中生成的补丁会出现在这里。" />
              </div>
            </Specimen>
          </div>
        </Section>

        <Section id="keys" title="快捷键" lead="">
          <div className="grid gap-2 sm:grid-cols-2">
            {[["⌘K", "命令面板"], ["⌘N", "新会话"], ["⌘J", "打开或收起工作区"], ["⌘B", "展开或收起侧栏"], ["⌘,", "设置"], ["Enter", "发送；运行中为补充"], ["⌘Enter", "保存行内意见"], ["Esc", "取消或关闭"]].map(([k, d]) => (
              <p key={k} className="flex items-center gap-3 rounded-xl bg-card px-4 py-2.5 text-[13.5px] shadow-[0_0_0_1px_var(--line)]"><Kbd>{k}</Kbd>{d}</p>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={`spec-${id}`} className="mb-14">
      <h2 className="font-read text-[26px] font-semibold tracking-tight">{title}</h2>
      {lead && <p className="mt-1 mb-6 max-w-[40rem] font-read text-[15.5px] leading-relaxed text-muted-foreground">{lead}</p>}
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="rounded-2xl bg-background p-4 shadow-[0_0_0_1px_var(--line)]">
      <div>{children}</div>
      <figcaption className="mt-3 border-t border-line pt-2 text-[12px] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function Tint({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("rounded-full px-2.5 py-0.5 text-[12px]", className)}>{children}</span>;
}

import type { Session } from "../../packages/host/contracts";
import { Icon, type IconName } from "./Icon";
const cards: { icon: IconName; title: string; desc: string; prompt: string }[] = [
  { icon:"zap", title:"实现一个新的功能", desc:"从想法出发，逐步实现", prompt:"请分析这个项目实现新功能的方案。当前仅做只读分析，不修改文件。" },
  { icon:"book", title:"分析和理解代码库", desc:"读懂结构，找到切入点", prompt:"请分析这个项目的结构，解释核心模块与数据流。" },
  { icon:"bug", title:"修复问题", desc:"找到原因，再验证修复", prompt:"请只读排查这个项目可能的问题，整理复现与修复建议，不修改文件。" },
  { icon:"search", title:"探索和研究", desc:"比较方案，整理成结论", prompt:"请研究这个项目的下一步设计方案，并整理取舍和建议。" },
];
export function ProjectHome({ hasProject, projectName, onSuggest, recent, onHistory, onAdd }: { hasProject: boolean; projectName?: string; onSuggest: (text: string) => void; recent: Session[]; onHistory: (s: Session) => void; onAdd: () => void }) {
  return <div className="home"><div className="home-kicker"><span className="tide-orb" aria-hidden="true" /><span>留一点空间，给新的想法。</span></div><h2 className="greeting">你好</h2><p className="hero-line">让想法，<span>向前一步。</span></p><p className="hero-caption">提出目标，和 Agent 一起探索、构建与验证。</p><div className="suggestions">{cards.map((c,i) => <button className="suggestion" key={c.title} onClick={() => hasProject ? onSuggest(c.prompt) : onAdd()} title="当前阶段仅做只读分析"><span className={`suggestion-icon tone-${i}`}><Icon name={c.icon} /></span><span className="grow"><b>{c.title}</b><p>{c.desc}</p></span><span className="suggestion-arrow"><Icon name="arrow-right" /></span></button>)}</div><div className="between section-heading"><span>继续上次的想法</span><span className="recent-project">{projectName}</span></div><div className="recents">{recent.length ? recent.map((s) => <button className="recent" key={s.sessionKey} onClick={() => onHistory(s)}><span className="recent-icon"><Icon name="file" /></span><span className="grow"><span className="recent-title cut">{s.name}</span><span className="recent-excerpt cut">只读历史 · 不续接执行</span></span><span className="recent-end"><Icon name="chevron" /></span></button>) : <div className="empty-state">这个项目还没有会话。<br />从下方输入框开始，不需要先做复杂配置。</div>}</div><div className="home-footnote"><Icon name="shield" />你决定方向，也决定每一步的执行权限。</div></div>;
}

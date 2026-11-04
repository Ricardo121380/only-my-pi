import { errorText } from "./api";
import { useNativeSession, isTaskActive as active } from "./useNativeSession";
import { MessageView, SafeMarkdown } from "./Messages";
import { HostDialog } from "./HostDialog";
import { TaskControl } from "./TaskControl";
import { MinimalComposer } from "./MinimalComposer";
import { Icon } from "./Icon";
import { AppearanceSettings, SessionDetails, ToolActivity, runLabels as labels } from "./MinimalPanels";

export function MinimalApp() {
  const { projectId, taskId, selectedKey, host, snapshot, setError, connection, connected, account, history, appearance, setAppearance, settingsOpen, setSettingsOpen, detailsOpen, setDetailsOpen, navigationOpen, setNavigationOpen, collapsed, suggestion, armed, setArmed, composerVersion, pending, acknowledged, reconciling, submissionNotice, addOpen, setAddOpen, projectPath, setProjectPath, addError, adding, scroller, follow, setFollow, project, projectTasks, visibleTask, taskLoading, selectedSession, currentSummary, sessionRunning, messages, sessionTitle, lookup, dispatch, send, navigate, openSession, stop, addProject, historyReady, title, toggleNavigation, suggest, sending } = useNativeSession();
  if (snapshot && snapshot.capabilities?.minimal !== true) return <main className="notice" role="alert">此页面需要最小会话 Host。请使用 omp web --minimal 启动并配对。</main>;
  const sessionNavigation = <nav className="session-nav" aria-label="会话列表">
    {projectTasks.filter(t => !t.sessionId || !history.sessions.some(s => s.sessionId === t.sessionId)).map(t => <button key={t.taskId} className={t.taskId === taskId ? "selected" : ""} aria-current={t.taskId === taskId ? "page" : undefined} onClick={() => navigate(projectId, t.taskId)}><span>{t.prompt || "新会话"}</span><small>{labels[t.status]}</small></button>)}
    {history.sessions.map(s => { const running = projectTasks.find(t => t.sessionId === s.sessionId && active(t.status)); const selected = selectedKey === s.sessionKey || visibleTask?.sessionId === s.sessionId; return <button key={s.sessionKey} className={selected ? "selected" : ""} aria-current={selected ? "page" : undefined} onClick={() => openSession(s)}><span>{sessionTitle(s)}</span><small>{running ? labels[running.status] : "查看历史"}</small></button>; })}
    {!projectTasks.length && !history.sessions.length && <p className="empty-hint">新建一个会话，从这里开始。</p>}
  </nav>;
  const navigationContent = <>
    <button className="new-session" aria-label="新建会话" title="新建会话" disabled={!project} onClick={() => navigate(projectId)}><Icon name="plus" /><span>新建会话</span></button>
    <div className="sidebar-scroll"><div className="sidebar-heading"><h2>项目</h2><div><button disabled={!project || !connected} onClick={history.refresh} aria-label="刷新会话列表" title="刷新会话列表"><Icon name="clock" /></button><button aria-label="添加项目" title="添加项目" onClick={() => { setNavigationOpen(false); setAddOpen(true); }}><Icon name="plus" /></button></div></div>
      <nav aria-label="选择项目">{snapshot?.projects.map(p => <div key={p.projectId} className="project-tree"><button className={`project-button ${p.projectId === projectId ? "is-current" : ""}`} aria-current={p.projectId === projectId ? "true" : undefined} title={p.path} onClick={() => navigate(p.projectId)}><Icon name={p.projectId === projectId ? "chevron-down" : "chevron"} /><Icon name="folder" /><span>{p.name}</span>{!p.available && <Icon name="info" />}</button>{p.projectId === projectId && sessionNavigation}</div>)}</nav>
      {!snapshot?.projects.length && <p className="empty-hint">添加本机目录，开始第一个会话。</p>}
    </div>
    <div className="sidebar-bottom"><div className="workspace-card"><span className="project-emblem"><Icon name="folder" /></span><div><strong>{project?.name || "本地工作区"}</strong><small><i className={connected ? "connected-dot" : "offline-dot"} />{connection}</small></div></div><button className="settings-button" aria-label="界面设置" title="界面设置" onClick={() => { setNavigationOpen(false); setSettingsOpen(true); }}><Icon name="settings" /><span>界面设置</span></button></div>
  </>;
  return <div className={`minimal-app ${collapsed ? "nav-collapsed" : ""}`}>
    <aside className="minimal-sidebar" aria-label="项目与会话">
      <div className="minimal-brand"><span className="brand-emblem" aria-hidden="true">π</span><strong>Only My Pi</strong><button className="icon-button" aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"} onClick={toggleNavigation}><Icon name="sidebar" /></button></div>
      {navigationContent}
    </aside>
    <main className="minimal-main">
      <header className="minimal-header"><button className="icon-button mobile-navigation" aria-label="打开项目与会话" onClick={() => setNavigationOpen(true)}><Icon name="sidebar" /></button><h1 title={title}>{title}</h1><div className="header-actions">{currentSummary && <span className={`run-label ${active(currentSummary.status) ? "is-running" : ""}`} role="status">{labels[currentSummary.status]}</span>}<button className="icon-button" aria-label="查看会话详情" title="查看会话详情" onClick={() => setDetailsOpen(true)}><Icon name="panel-right" /></button></div></header>
      {host.error && <div className="notice" role="alert">{host.error}<button onClick={() => setError("")} aria-label="关闭错误提示">×</button></div>}
      {!!snapshot?.diagnostics.length && <p className="notice">部分历史无法读取，请检查会话文件。</p>}
      {project && !project.available && <p className="notice">项目目录不可访问，仍可查看历史。</p>}
      {pending && <div className="notice" role="status"><div>{submissionNotice || "正在核对上次提交…"}<small>项目：{snapshot?.projects.find(p => p.projectId === pending.projectId)?.name || pending.projectId} · 模型：{pending.model} · {pending.mode === "controlled" ? "受控编程" : "只读分析"}</small><pre>{pending.prompt}</pre><small>请求 {pending.requestId}</small></div><button disabled={!connected || reconciling} onClick={() => void lookup()}>核对提交结果</button><button disabled={!connected || reconciling || !!sending.current} onClick={() => void dispatch(pending).catch(() => {})}>重试同一请求</button></div>}
      <section ref={scroller} className={`minimal-conversation ${!selectedKey && !visibleTask && !taskLoading ? "is-home" : ""}`} aria-label="对话" onScroll={() => { const n = scroller.current; if (n) setFollow(n.scrollHeight - n.scrollTop - n.clientHeight < 80); }}>
        {taskLoading ? <p className="loading-state" role="status">正在读取运行状态，请稍候…</p> : !selectedKey && !visibleTask ? <div className="home-content"><div className="conversation-empty"><div className="home-emblem" aria-hidden="true"><span>π</span><i /><i /></div><p className="home-greeting">你的想法，下一步就开始。</p><h2>让每一个想法，<br /><span>都有一个好的开始。</span></h2>{project ? <div className="home-project" title={project.path}><Icon name="folder" />{project.name}</div> : <button className="home-project" onClick={() => setAddOpen(true)}><Icon name="plus" />添加项目</button>}<p className="home-capabilities"><span><Icon name="code" />理解代码</span><span><Icon name="layers" />梳理思路</span><span><Icon name="shield" />受控执行</span></p></div><div className="starter-grid">
          <button disabled={!project} onClick={() => suggest("请阅读这个项目，介绍目录结构、核心模块和主要入口。")}><span className="starter-icon"><Icon name="code" /></span><strong>读懂这个项目</strong><small>梳理项目结构与关键模块</small><Icon name="arrow-up" /></button>
          <button disabled={!project} onClick={() => suggest("请只读检查这个项目中的潜在问题，说明依据与验证建议，不修改文件。")}><span className="starter-icon"><Icon name="bug" /></span><strong>检查潜在问题</strong><small>寻找遗漏，核对边界情况</small><Icon name="arrow-up" /></button>
          <button disabled={!project} onClick={() => suggest("请先帮我梳理实施思路，列出需要明确的问题和建议步骤，暂不修改文件。")}><span className="starter-icon"><Icon name="layers" /></span><strong>把想法变成计划</strong><small>从一个清晰的下一步开始</small><Icon name="arrow-up" /></button>
        </div></div> : <div className="minimal-feed">
          {selectedKey && !historyReady ? <p role="status">正在读取会话历史…</p> : messages.map(m => <MessageView key={`${selectedKey || taskId}:${m.id}`} message={m} sessionKey={selectedKey || undefined} branded />)}
          {visibleTask?.partial && <article className="assistant-message"><div className="agent-mark pi-emblem" aria-hidden="true">π</div><div className="assistant-content"><div className="sender"><b>Only My Pi</b><span>正在回复</span></div><SafeMarkdown text={visibleTask.partial} /></div></article>}
          {visibleTask?.toolCalls?.filter(call => call.status === "running").map(call => <details className="live-tool" key={call.toolCallId} open><summary><Icon name="activity" />{call.name}<span>运行中</span></summary>{call.output && <pre>{call.output}</pre>}</details>)}
          {active(visibleTask?.status) && !visibleTask?.partial && <div className="working-indicator" role="status"><span className="working-pixels" aria-hidden="true"><i /><i /><i /><i /></span>{visibleTask?.approvals?.length ? "等待你的决定" : "Pi 正在处理…"}</div>}
          {visibleTask && <TaskControl key={visibleTask.taskId} task={visibleTask} connected={connected} />}
          {currentSummary?.error && <p className="notice" role="alert">{errorText(new Error(currentSummary.error))}</p>}
          {selectedKey && <div className="history-actions"><button disabled={!historyReady || history.offset === 0} onClick={() => history.setOffset(Math.max(0, history.offset - 50))}>上一页</button><span>第 {Math.floor(history.offset / 50) + 1} 页</span><button disabled={!historyReady || history.page.nextOffset === null} onClick={() => history.setOffset(history.page.nextOffset!)}>下一页</button></div>}
        </div>}
      </section>
      {!follow && <button className="latest" onClick={() => setFollow(true)}><Icon name="chevron-down" />回到最新</button>}
      <div className="minimal-input-area">
        {currentSummary && <ToolActivity key={currentSummary.taskId} task={currentSummary} />}
        {selectedKey && <div className="resume-bar"><span>{armed ? "下一条消息将继续此会话，旧授权不继承。" : "正在查看历史，尚未继续执行。"}</span><button disabled={armed || !connected || !historyReady || !!sessionRunning || !!pending || !project?.available} onClick={() => { setArmed(true); document.getElementById("minimal-prompt")?.focus(); }}>{armed ? "已选择继续" : "继续会话"}<Icon name="arrow-right" /></button></div>}
        <MinimalComposer key={`${projectId}:${composerVersion}`} accounts={account.accounts} accountId={account.accountId} models={account.models} model={account.selectedModel} onAccount={account.selectAccount} onModel={account.selectModel}
          projectName={project?.name} suggestion={suggestion} thinkingLevel={account.thinkingLevel} onThinking={account.setThinkingLevel}
          acknowledged={acknowledged} onSend={send} onCancel={() => void stop()} disabled={!connected || !!taskId || !project?.available || !!pending || !!selectedKey && !armed} running={active(visibleTask?.status)} cancelling={visibleTask?.status === "cancelling"} controlled={snapshot?.capabilities?.controlled === true} />
        <footer className="workspace-status"><span role="status"><Icon name="monitor" />本地<i className={connected ? "connected-dot" : "offline-dot"} />{connection}</span>{currentSummary ? <button onClick={() => setDetailsOpen(true)} title="查看本轮模型用量"><Icon name="database" />{currentSummary.usage?.tokens ? `${currentSummary.usage.tokens.totalTokens.toLocaleString()} tokens` : "用量未报告"}</button> : <span>由 Pi 驱动</span>}</footer>
      </div>
    </main>
    <HostDialog open={navigationOpen} onClose={() => setNavigationOpen(false)} title="项目与会话" className="minimal-navigation-dialog">{navigationOpen && navigationContent}</HostDialog>
    <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} value={appearance} onChange={setAppearance} />
    <SessionDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} project={project} task={currentSummary} sessionId={selectedSession?.sessionId || visibleTask?.sessionId} />
    <HostDialog open={addOpen} onClose={() => setAddOpen(false)} title="添加项目" className="minimal-dialog"><form onSubmit={addProject}><label htmlFor="project-directory">本机目录的绝对路径</label><input id="project-directory" value={projectPath} placeholder="项目目录的绝对路径" onChange={e => setProjectPath(e.target.value)} required /><p>选择已有目录。添加项目不会修改目录内容。</p>{addError && <p role="alert">{addError}</p>}<button className="primary" disabled={adding || !projectPath.trim()}>{adding ? "正在添加…" : "添加"}</button></form></HostDialog>
  </div>;
}

import { useState } from "react";
import { Icon } from "./Icon";
import { ProductSettings } from "./ProductSettings";
import { McpPanel } from "./McpPanel";
import { ClassifierPanel } from "./ClassifierPanel";

export function WorkspaceSettings({ projectId, projectName, hasProject, onUseSkill }: {
  projectId: string; projectName?: string; hasProject: boolean; onUseSkill: (name: string) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [classifierOpen, setClassifierOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  // Dialogs portal to body. Keep each panel's mount/key semantics independent
  // of responsive navigation and Composer draft/task selection.
  return <>
    <button className="nav-item" onClick={() => setSettingsOpen(true)}><Icon name="box" />产品工具与技能</button>
    <button className="nav-item" onClick={() => setMcpOpen(true)}><Icon name="box" />MCP 工具</button>
    <button className="nav-item" disabled={!hasProject} onClick={() => setClassifierOpen(true)}><Icon name="box" />分类模型</button>
    <button className="nav-item" disabled={!hasProject} onClick={() => setImageOpen(true)}><Icon name="box" />生图模型</button>
    {settingsOpen && <ProductSettings key={projectId} projectId={projectId || undefined} projectName={projectName} onUseSkill={onUseSkill} onClose={() => setSettingsOpen(false)} />}
    {mcpOpen && <McpPanel projectId={projectId || undefined} projectName={projectName} onClose={() => setMcpOpen(false)} />}
    {classifierOpen && projectId && <ClassifierPanel key={projectId} projectId={projectId} projectName={projectName} onClose={() => setClassifierOpen(false)} />}
    {imageOpen && projectId && <ClassifierPanel key={`image:${projectId}`} kind="image" projectId={projectId} projectName={projectName} onClose={() => setImageOpen(false)} />}
  </>;
}

import { useEffect } from "react";
import { motion } from "motion/react";
import { useProto, type PrototypeId } from "@/store";
import { cn } from "@/lib/utils";

import Workbench from "@/prototypes/Workbench";
import ReadingRoom from "@/prototypes/ReadingRoom";
import ReadingRoomCoder from "@/prototypes/ReadingRoomCoder";
import Spec from "@/prototypes/b2/Spec";
import PiNative from "@/prototypes/PiNative";
import MissionControl from "@/prototypes/MissionControl";

const directions: { id: PrototypeId; name: string; ref: string; note: string }[] = [
  { id: "a", name: "工作台", ref: "参考 Codex", note: "三栏可拖拽，右侧常驻审查面板，权限轨道在顶部" },
  { id: "b", name: "静室", ref: "参考 Claude 桌面版", note: "居中阅读列，计划像文档一样批注，改动在侧页展开" },
  { id: "b2", name: "静室·编码", ref: "B 的风格，为编码重排结构", note: "阅读列与常驻工作区并排，审批停靠在输入框上方，状态栏与 ⌘K 命令面板" },
  { id: "spec", name: "规范", ref: "B2 设计规范样张", note: "颜色、字体、形状、状态与组件，全部由实际代码渲染；文字版在 DESIGN.md" },
  { id: "c", name: "原生", ref: "参考 Pi Desktop", note: "深色高密度，子代理树与文件工作区并排" },
  { id: "d", name: "指挥台", ref: "参考 DeepSeek Harness", note: "任务看板、预算仪表与审批队列一屏掌握" },
];

export default function App() {
  const { prototype, setPrototype } = useProto();
  const current = directions.find((d) => d.id === prototype)!;

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.slice(1) as PrototypeId;
      if (directions.some((d) => d.id === id)) setPrototype(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [setPrototype]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const index = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
      if (index >= 0) setPrototype(directions[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPrototype]);

  return (
    <div className="flex h-full flex-col bg-[#1b1c1f] text-[#e8e8ea]" style={{ fontFamily: '"Inter Tight Variable", system-ui, sans-serif' }}>
      <header className="flex h-11 shrink-0 items-center gap-4 px-4 text-[13px]">
        <span className="hidden shrink-0 font-medium text-white/90 xl:inline">Only-My-Pi 原型</span>
        <nav aria-label="选择原型" className="relative flex rounded-lg bg-white/[0.06] p-0.5">
          {directions.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setPrototype(d.id)}
              aria-pressed={prototype === d.id}
              title={`${d.ref}（Alt+${i + 1}）`}
              className={cn(
                "relative z-10 whitespace-nowrap rounded-md px-3 py-1 transition-colors",
                prototype === d.id ? "text-[#141518]" : "text-white/65 hover:text-white",
              )}
            >
              {prototype === d.id && (
                <motion.span layoutId="proto-pill" className="absolute inset-0 -z-10 rounded-md bg-white" transition={{ type: "spring", bounce: 0.18, duration: 0.45 }} />
              )}
              {d.id !== "spec" && <span className="mr-1.5 opacity-50">{d.id.toUpperCase()}</span>}
              {d.name}
            </button>
          ))}
        </nav>
        <p className="hidden min-w-0 truncate text-white/50 lg:block">
          <span className="text-white/75">{current.ref}</span>，{current.note}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-t-xl">
        {prototype === "a" && <Workbench />}
        {prototype === "b" && <ReadingRoom />}
        {prototype === "b2" && <ReadingRoomCoder />}
        {prototype === "spec" && <Spec />}
        {prototype === "c" && <PiNative />}
        {prototype === "d" && <MissionControl />}
      </div>
    </div>
  );
}

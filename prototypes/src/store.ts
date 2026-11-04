import { create } from "zustand";
import { queueTasks, type AccessState } from "@/data/mock";

export type PrototypeId = "a" | "b" | "b2" | "spec" | "c" | "d";

interface ProtoState {
  prototype: PrototypeId;
  setPrototype: (id: PrototypeId) => void;

  access: AccessState;
  grantedAt: string | null;
  approve: () => void;
  revise: () => void;
  deny: () => void;
  revoke: () => void;
  reopen: () => void;

  running: boolean;
  stop: () => void;

  sessionId: string;
  setSession: (id: string) => void;
  accountId: string;
  model: string;
  thinking: string;
  setModel: (accountId: string, model: string) => void;
  setThinking: (level: string) => void;

  queue: typeof queueTasks;
  moveTask: (taskId: string, column: string, overId?: string) => void;
}

const initialPrototype = (): PrototypeId => {
  const hash = window.location.hash.replace("#", "");
  return (["a", "b", "b2", "spec", "c", "d"] as const).includes(hash as PrototypeId) ? (hash as PrototypeId) : "a";
};

export const useProto = create<ProtoState>((set) => ({
  prototype: initialPrototype(),
  setPrototype: (prototype) => {
    window.history.replaceState(null, "", `#${prototype}`);
    set({ prototype });
  },

  access: "awaiting",
  grantedAt: null,
  approve: () => set({ access: "coding", grantedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), running: true }),
  revise: () => set({ access: "planning", grantedAt: null }),
  deny: () => set({ access: "inspect", grantedAt: null }),
  revoke: () => set({ access: "inspect", grantedAt: null, running: false }),
  reopen: () => set({ access: "awaiting", grantedAt: null }),

  running: false,
  stop: () => set({ running: false }),

  sessionId: "s1",
  setSession: (sessionId) => set({ sessionId }),
  accountId: "ds-personal",
  model: "deepseek-v4-pro",
  thinking: "高",
  setModel: (accountId, model) => set({ accountId, model }),
  setThinking: (thinking) => set({ thinking }),

  queue: queueTasks,
  moveTask: (taskId, column, overId) =>
    set((state) => {
      const task = state.queue.find((item) => item.id === taskId);
      if (!task) return state;
      const rest = state.queue.filter((item) => item.id !== taskId);
      const moved = { ...task, column };
      const index = overId ? rest.findIndex((item) => item.id === overId) : -1;
      if (index < 0) return { queue: [...rest, moved] };
      return { queue: [...rest.slice(0, index), moved, ...rest.slice(index)] };
    }),
}));

/** Coding, plan reveal and child agents only appear after approval. */
export const useCoding = () => useProto((s) => s.access === "coding");

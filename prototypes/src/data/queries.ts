import { useQuery } from "@tanstack/react-query";
import * as mock from "@/data/mock";

// Simulated local Host. Latency is small but real enough to exercise loading states.
const host = <T,>(value: T, ms = 220) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => host(mock.projects) });
export const useSessions = () => useQuery({ queryKey: ["sessions"], queryFn: () => host(mock.sessions, 320) });
export const useTimeline = (sessionId: string) =>
  useQuery({ queryKey: ["timeline", sessionId], queryFn: () => host(mock.timeline, 380) });
export const useDiff = () => useQuery({ queryKey: ["diff"], queryFn: () => host(mock.diffFiles, 260) });
export const useBudget = () =>
  useQuery({ queryKey: ["budget"], queryFn: () => host({ ...mock.budget, series: mock.tokenSeries }, 300) });

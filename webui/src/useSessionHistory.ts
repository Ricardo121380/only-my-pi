import { useEffect, useState } from "react";
import type { Message, Project, Session, TaskStatus } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";

interface HistoryPage { messages: Message[]; nextOffset: number | null }
interface Options {
  projectId: string;
  connected: boolean;
  taskStatus?: TaskStatus;
  projects?: Project[];
  onError: (message: string) => void;
}

// Owns read-only history selection and queries. Explicit resume authority and
// task commands stay in App; opening a historical session cannot submit it.
export function useSessionHistory({ projectId, connected, taskStatus, projects, onError }: Options) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [page, setPage] = useState<HistoryPage>({ messages: [], nextOffset: null });
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const visibleTaskStatus = session ? undefined : taskStatus;

  useEffect(() => {
    if (!projectId || !connected) return;
    const controller = new AbortController();
    void api<{ sessions: Session[] }>(query("sessions", { projectId }), undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setSessions(data.sessions); })
      .catch(cause => { if (!controller.signal.aborted) onError(errorText(cause)); });
    return () => controller.abort();
  }, [projectId, connected, visibleTaskStatus, projects, revision, onError]);

  useEffect(() => {
    if (!session) { setBusy(false); return; }
    const controller = new AbortController();
    setBusy(true); setPage({ messages: [], nextOffset: null });
    void api<HistoryPage>(query("history", { sessionKey: session.sessionKey, offset }), undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setPage(data); })
      .catch(cause => { if (!controller.signal.aborted) onError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [session, offset, revision, onError]);

  function open(item: Session) { setSession(item); setOffset(0); }
  return { session, sessions, page, busy, offset, revision, open, setOffset,
    leave: () => setSession(null), clearSessions: () => setSessions([]), refresh: () => setRevision(n => n + 1) };
}

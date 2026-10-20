export interface RunReceipt {
  runId: string; status: string; receiptDigest?: string | null;
  directWriter?: { stage: string; application: string; verification: string; patchDigest: string | null; receiptDigest: string | null; failureCode: string | null; needsReconciliation: boolean };
}
const stages: Record<string, string> = { PREPARING: "准备中", PATCH_CAPTURED: "补丁已捕获", CLONE_VERIFIED: "副本验证通过", REVIEWED: "审查已完成", APPLYING: "正在应用", APPLICATION_UNKNOWN: "应用结果未知", APPLIED_PENDING_VERIFICATION: "已应用，待验证", VERIFYING: "正在验证真实工作区", VERIFIED: "真实工作区验证通过", BLOCKED: "已阻止" };
export function RunReceipts({ runs }: { runs: RunReceipt[] }) {
  return <div className="host-run-receipts">{runs.map((run) => {
    const writer = run.directWriter;
    const verified = writer?.stage === "VERIFIED" && writer.application === "APPLIED" && writer.verification === "PASS" && !!writer.receiptDigest;
    const unknown = writer?.application === "UNKNOWN" || writer?.stage === "APPLICATION_UNKNOWN";
    return <section className="host-control" key={run.runId} aria-label="执行回执">
      <strong>{verified ? "真实工作区验证通过" : writer ? writer.stage === "VERIFIED" ? "回执不完整，不能确认通过" : stages[writer.stage] ?? writer.stage : `执行状态：${run.status}`}</strong>
      <p className="muted">Run：{run.runId}</p>
      {writer && <><dl><dt>补丁应用</dt><dd>{writer.application === "APPLIED" ? "已应用（不等于验证通过）" : unknown ? "未知" : "尚未应用"}</dd><dt>真实工作区验证</dt><dd>{writer.verification}</dd></dl>
        {unknown && <p role="alert">应用结果不确定。请核对工作区和回执；禁止自动重试或重复应用。</p>}
        {!unknown && writer.needsReconciliation && <p role="status">该步骤需要状态核对，不能据此认定完成。</p>}
        {writer.failureCode && <p role="alert">{writer.failureCode}</p>}
        <details><summary>回执标识</summary><p>Patch：{writer.patchDigest ?? "未产生"}</p><p>Receipt：{writer.receiptDigest ?? "未产生"}</p></details>
      </>}
    </section>;
  })}</div>;
}

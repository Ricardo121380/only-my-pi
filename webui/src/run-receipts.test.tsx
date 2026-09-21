import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RunReceipts, type RunReceipt } from "./RunReceipts";
afterEach(cleanup);
function receipt(stage: string, application: string, verification: string, digest: string | null = null): RunReceipt {
  return { runId: "run", status: "completed", directWriter: { stage, application, verification, receiptDigest: digest, patchDigest: null, failureCode: null, needsReconciliation: application === "UNKNOWN" } };
}
it("never equates applied, clone-verified or incomplete receipts with verified", () => {
  const { rerender } = render(<RunReceipts runs={[receipt("APPLIED_PENDING_VERIFICATION", "APPLIED", "PENDING")]} />);
  expect(screen.queryByText("真实工作区验证通过")).toBeNull();
  rerender(<RunReceipts runs={[receipt("CLONE_VERIFIED", "NOT_STARTED", "NOT_RUN")]} />);
  expect(screen.queryByText("真实工作区验证通过")).toBeNull();
  rerender(<RunReceipts runs={[receipt("VERIFIED", "APPLIED", "PASS")]} />);
  expect(screen.getByText("回执不完整，不能确认通过")).toBeTruthy();
  rerender(<RunReceipts runs={[receipt("VERIFIED", "APPLIED", "PASS", "sha256:fixture")]} />);
  expect(screen.getByText("真实工作区验证通过")).toBeTruthy();
});
it("makes unknown application explicit and offers no retry or apply action", () => {
  render(<RunReceipts runs={[receipt("APPLICATION_UNKNOWN", "UNKNOWN", "NOT_RUN")]} />);
  expect(screen.getByRole("alert").textContent).toContain("禁止自动重试或重复应用");
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

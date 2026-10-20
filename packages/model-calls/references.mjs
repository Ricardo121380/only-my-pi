export const IMAGE_ENTRY = "omp-image-artifacts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function validImageEntry(data) {
  return data?.version === 1 && uuid.test(data.requestId ?? "") && Array.isArray(data.artifacts)
    && data.artifacts.length > 0 && data.artifacts.length <= 4 && data.artifacts.every((a, index) =>
      a?.requestId === data.requestId && a.index === index && a.mimeType === "image/png"
      && [a.projectPath, a.sessionId, a.taskId, a.accountId, a.model, a.parentToolCallId, a.inputDigest, a.createdAt].every(v => typeof v === "string" && v.length > 0 && v.length <= 4096)
      && a.projectPath.startsWith("/") && /^[a-f0-9]{64}$/u.test(a.sha256 ?? "")
      && Number.isSafeInteger(a.bytes) && a.bytes > 0 && a.bytes <= 10485760
      && Number.isSafeInteger(a.width) && a.width > 0 && Number.isSafeInteger(a.height) && a.height > 0 && a.width * a.height <= 4000000);
}

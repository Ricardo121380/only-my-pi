// Match the actual model ID, including gateway IDs such as
// commandcode/deepseek/deepseek-v4.1-flash. A provider/name label is not proof.
export function isDeepSeekModel(reference) {
  if (typeof reference !== "string" || !reference.includes("/")) return false;
  const id = reference.slice(reference.indexOf("/") + 1);
  return /^(?:deepseek\/)?deepseek(?:[-.:]|$)/iu.test(id);
}

export function requireDeepSeekModel(reference) {
  if (!isDeepSeekModel(reference)) throw Object.assign(new Error("DEEPSEEK_MODEL_REQUIRED"), { code: "DEEPSEEK_MODEL_REQUIRED", status: 409 });
}

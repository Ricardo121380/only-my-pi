import fs from "node:fs/promises";
import { ownershipError } from "../host/ownership.mjs";
import { resolveLocalPath } from "./session-selection.mjs";

// Pi's CLI file processor is not a public export. Keep attachment assembly here
// and use only the public image detection/conversion/resizing functions.
export async function prepareTuiInput({ sdk, files, messages, cwd, autoResizeImages }) {
  let text = "";
  const images = [];
  for (const file of files) {
    const absolute = resolveLocalPath(file, cwd);
    let bytes, mimeType;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw ownershipError("TUI_ATTACHMENT_NOT_FILE");
      if (!stat.size) continue;
      bytes = await fs.readFile(absolute);
      mimeType = await sdk.detectSupportedImageMimeTypeFromFile(absolute);
    } catch (error) {
      if (error.code === "TUI_ATTACHMENT_NOT_FILE") throw error;
      throw ownershipError("TUI_ATTACHMENT_READ_FAILED");
    }
    if (!mimeType) {
      text += `<file name="${absolute}">\n${bytes.toString("utf8").replace(/^\uFEFF/, "")}\n</file>\n`;
      continue;
    }
    let image = { data: bytes.toString("base64"), mimeType }, hint = "";
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType)) {
      image = await sdk.convertToPng(image.data, mimeType);
      if (image) hint = `[Image converted from ${mimeType} to ${image.mimeType}.]`;
    }
    if (image && autoResizeImages) {
      const resized = await sdk.resizeImage(Buffer.from(image.data, "base64"), image.mimeType);
      image = resized;
      if (resized) hint = [hint, sdk.formatDimensionNote(resized)].filter(Boolean).join("\n");
    }
    if (!image) hint = "[Image omitted: could not be converted or resized to a supported inline image.]";
    else images.push({ type: "image", data: image.data, mimeType: image.mimeType });
    text += `<file name="${absolute}">${hint}</file>\n`;
  }
  // The first message accompanies attachments; remaining messages retain order.
  return { initialMessage: text || messages.length ? text + (messages[0] ?? "") : undefined,
    initialImages: images.length ? images : undefined, initialMessages: messages.slice(1) };
}

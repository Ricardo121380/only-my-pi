import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import { prepareTuiInput } from "../packages/direct-agent/initial-input.mjs";

async function fixture(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return { cwd, prepare: (files, messages = [], autoResizeImages = true) =>
    prepareTuiInput({ sdk, files, messages, cwd, autoResizeImages }) };
}

test("attachments preserve full BOM-free text, skip empty files and consume only the first message", async (t) => {
  const f = await fixture(t), text = "中文内容\n".repeat(3000);
  await fs.writeFile(path.join(f.cwd, "file.txt"), "\uFEFF" + text);
  await fs.writeFile(path.join(f.cwd, "empty"), "");
  const result = await f.prepare(["file.txt", "empty"], ["review", "then explain"]);
  assert.equal(result.initialMessage, `<file name="${path.join(f.cwd, "file.txt")}">\n${text}\n</file>\nreview`);
  assert.deepEqual(result.initialMessages, ["then explain"]);
  assert.equal(result.initialImages, undefined);
});

test("image attachments use public SDK processing and preserve prompt ordering", async (t) => {
  const f = await fixture(t);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
  await fs.writeFile(path.join(f.cwd, "image.png"), png);
  for (const resize of [false, true]) {
    const result = await f.prepare(["image.png"], ["describe"], resize);
    assert.equal(result.initialImages?.length, 1);
    assert.equal(result.initialImages[0].type, "image");
    assert.match(result.initialImages[0].mimeType, /^image\//);
    assert.ok(result.initialMessage.endsWith("</file>\ndescribe"));
    if (!resize) assert.deepEqual(Buffer.from(result.initialImages[0].data, "base64"), png);
  }
});

test("missing and non-file attachments fail explicitly without leaking raw filesystem errors", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.prepare(["missing"]), { code: "TUI_ATTACHMENT_READ_FAILED" });
  await assert.rejects(f.prepare(["."]), { code: "TUI_ATTACHMENT_NOT_FILE" });
  assert.deepEqual(await f.prepare([]), { initialMessage: undefined, initialImages: undefined, initialMessages: [] });
});

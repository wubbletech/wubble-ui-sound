import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Produces a standard unified patch from the same hash-bound preview used by apply.
 * The patch is review-first: it never mutates the source tree.
 * @param {{ generatedEdits: Array<any>, approval: { root: string } }} preview
 */
export async function createPatchText(preview) {
  const parts = [];
  for (const fileEdit of preview.generatedEdits) {
    const before = await readFile(fileEdit.file, "utf8");
    const after = applyEdits(before, fileEdit.edits);
    const relative = path.relative(preview.approval.root, fileEdit.file).split(path.sep).join("/");
    parts.push(formatFileDiff(relative, before, after));
  }
  return parts.join("\n");
}

/** @param {string} source @param {Array<any>} edits */
function applyEdits(source, edits) {
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    if (output.slice(edit.start, edit.end) !== edit.original) throw new Error("Patch preview no longer matches its source file. Re-run the audit before exporting a patch.");
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}

/** @param {string} file @param {string} before @param {string} after */
function formatFileDiff(file, before, after) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix && beforeLines.at(-1 - suffix) === afterLines.at(-1 - suffix)) suffix += 1;
  const context = 3;
  const start = Math.max(0, prefix - context);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + context);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + context);
  const commonPrefix = beforeLines.slice(start, prefix);
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const commonSuffix = beforeLines.slice(beforeLines.length - suffix, beforeEnd);
  const beforeCount = beforeEnd - start;
  const afterCount = afterEnd - start;
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start + 1},${beforeCount} +${start + 1},${afterCount} @@`,
    ...commonPrefix.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...commonSuffix.map((line) => ` ${line}`),
    ""
  ].join("\n");
}

/** @param {string} value */
function splitLines(value) {
  const lines = value.replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

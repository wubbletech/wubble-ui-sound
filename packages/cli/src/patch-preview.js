import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const MAX_HANDLER_BODY_BYTES = 12_000;

/**
 * Creates a reviewable patch plan from an explicit approval record.
 * This command deliberately never modifies application source files.
 * @param {{ approval: string, output?: string, force?: boolean, dryRun?: boolean }} options
 */
export async function createPatchPreview(options) {
  const approvalPath = path.resolve(options.approval);
  const approvalBytes = await readFile(approvalPath, "utf8");
  const approval = readApproval(approvalBytes);
  const root = path.resolve(approval.audit.root);
  const candidateEdits = [];
  const manualReview = [];

  for (const candidate of approval.approved) {
    const result = await previewCandidate({ root, candidate });
    if (result.edit) candidateEdits.push(result.edit);
    else manualReview.push({ candidateId: candidate.id, location: candidate.location, reason: result.reason });
  }

  const preview = {
    schemaVersion: 1,
    kind: "wubble-ui-sounds-patch-preview",
    approval: {
      root,
      source: approvalPath,
      sha256: createHash("sha256").update(approvalBytes).digest("hex")
    },
    prerequisites: [
      "Run wubble-ui-sounds setup before applying this preview so src/lib/wubble-ui-sounds.js exists in the application.",
      "Review every generated diff and every manual-review recommendation before any source mutation."
    ],
    generatedEdits: mergeFileEdits(candidateEdits),
    manualReview
  };
  const output = path.resolve(options.output ?? path.join(root, ".wubble-ui-sounds", "patch-preview.json"));
  const serialized = `${JSON.stringify(preview, null, 2)}\n`;
  const sha256 = hashText(serialized);

  if (!options.dryRun) {
    if (await fileExists(output) && !options.force) {
      throw new Error(`Patch preview already exists: ${output}. Review it or re-run with --force to replace it.`);
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, serialized, "utf8");
  }

  return { preview, output, sha256, dryRun: Boolean(options.dryRun) };
}

/** Groups safe handler edits by file so review and apply have one coherent change per source file. */
function mergeFileEdits(candidateEdits) {
  const files = new Map();
  for (const candidateEdit of candidateEdits) {
    const existing = files.get(candidateEdit.file);
    if (!existing) {
      files.set(candidateEdit.file, {
        ...candidateEdit,
        locations: [candidateEdit.location],
        edits: candidateEdit.edits.map((edit) => ({ ...edit, candidateIds: [...(edit.candidateIds ?? [])] }))
      });
      continue;
    }
    if (existing.sourceSha256 !== candidateEdit.sourceSha256) {
      throw new Error(`Safe edits disagree on the original source for ${candidateEdit.file}. Re-run the audit before creating a preview.`);
    }
    existing.locations.push(candidateEdit.location);
    for (const edit of candidateEdit.edits) {
      const duplicate = existing.edits.find((current) => current.start === edit.start && current.end === edit.end && current.replacement === edit.replacement && current.original === edit.original);
      if (duplicate) {
        duplicate.candidateIds = [...new Set([...(duplicate.candidateIds ?? []), ...(edit.candidateIds ?? [])])];
      } else {
        existing.edits.push({ ...edit, candidateIds: [...(edit.candidateIds ?? [])] });
      }
    }
  }
  return [...files.values()]
    .map((entry) => ({ ...entry, location: entry.locations.join(", ") }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

/** @param {string} approvalBytes */
function readApproval(approvalBytes) {
  let approval;
  try {
    approval = JSON.parse(approvalBytes);
  } catch (error) {
    throw new Error(`Unable to read approval record: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (approval?.schemaVersion !== 1 || approval?.kind !== "wubble-ui-sounds-approval" || typeof approval.audit?.root !== "string" || !Array.isArray(approval.approved)) {
    throw new Error("Patch preview requires a Wubble approval record.");
  }
  return approval;
}

/** @param {{ root: string, candidate: any }} options */
async function previewCandidate({ root, candidate }) {
  if (!candidate?.id || !candidate.file || !Number.isInteger(candidate.line)) {
    return { reason: "The approved recommendation is incomplete; re-run the audit before generating a patch preview." };
  }
  const file = path.resolve(candidate.file);
  const relativeFile = path.relative(root, file);
  if (relativeFile.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFile)) {
    return { reason: "The approved recommendation points outside the audited project." };
  }
  if (!["named-handler", "inline-handler"].includes(candidate.anchor?.type)) {
    return { reason: "This recommendation is not a supported async handler. Add it manually after reviewing the surrounding product flow." };
  }
  if (!sameEvents(candidate.events, ["processing", "success", "error"])) {
    return { reason: "Only approved async outcome recommendations receive an automatic patch preview in this release." };
  }
  if (candidate.recommendation?.mode && candidate.recommendation.mode !== "sound") {
    return { reason: `This recommendation is ${candidate.recommendation.mode}; it does not receive an automatic sound-code patch.` };
  }

  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    return { reason: `The original source file is unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isClientModule(contents, file)) {
    return { reason: "This file is not an explicit client module. Keep server boundaries intact and add feedback in a reviewed client component." };
  }
  if (/\bfeedback\b/.test(contents)) {
    return { reason: "This file already declares or references feedback, so adding a generated import would be ambiguous." };
  }

  const handler = findHandler(contents, candidate);
  if (!handler) {
    return { reason: "The approved handler no longer matches the audited source. Re-run the audit before applying feedback." };
  }
  if (!handler.async || handler.body?.type !== "BlockStatement") {
    return { reason: "Only async named handlers with block bodies receive an automatic patch preview in this release." };
  }
  if (Buffer.byteLength(contents.slice(handler.body.start, handler.body.end), "utf8") > MAX_HANDLER_BODY_BYTES) {
    return { reason: "This handler is larger than the 12 KB review limit. Keep it manual so the product behavior can be assessed in context." };
  }

  const integration = path.join(root, "src", "lib", "wubble-ui-sounds.js");
  const importPath = toModulePath(path.relative(path.dirname(file), integration));
  const importAt = clientDirectiveEnd(contents);
  const importEdit = {
    start: importAt,
    end: importAt,
    original: "",
    originalSha256: hashText(""),
    replacement: `\nimport { feedback } from ${JSON.stringify(importPath)};\n`,
    candidateIds: [candidate.id],
    purpose: "Import the local feedback client generated by Wubble export."
  };
  const bodyEdit = {
    start: handler.body.start,
    end: handler.body.end,
    original: contents.slice(handler.body.start, handler.body.end),
    originalSha256: hashText(contents.slice(handler.body.start, handler.body.end)),
    replacement: wrapAsyncOutcome(contents, handler.body),
    candidateIds: [candidate.id],
    purpose: "Play processing, success, and error feedback around the existing async action without changing its visible states."
  };

  return {
    edit: {
      file,
      location: candidate.location,
      sourceSha256: hashText(contents),
      edits: [importEdit, bodyEdit]
    }
  };
}

/** @param {string} source @param {any} candidate */
function findHandler(source, candidate) {
  let program;
  try {
    program = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "typescript"], errorRecovery: true });
  } catch {
    return undefined;
  }
  let match;
  walk(program, (node) => {
    if (match) return;
    if (candidate.anchor.type === "named-handler" && node.type === "FunctionDeclaration" && node.id?.name === candidate.anchor.name && node.loc?.start.line === candidate.line) {
      match = node;
    }
    if (candidate.anchor.type === "named-handler" && node.type === "VariableDeclarator" && node.id?.name === candidate.anchor.name && node.loc?.start.line === candidate.line && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)) {
      match = node.init;
    }
    if (candidate.anchor.type === "inline-handler" && node.type === "JSXAttribute" && ["onClick", "onPress", "onSubmit"].includes(node.name?.name) && node.value?.expression?.type === "ArrowFunctionExpression" && node.value.expression.loc?.start.line === candidate.line) {
      match = node.value.expression;
    }
  });
  return match;
}

/** @param {string} source @param {any} body */
function wrapAsyncOutcome(source, body) {
  const baseIndent = indentationAt(source, body.start);
  const wrappedIndent = `${baseIndent}      `;
  const original = indentOriginalBody(source.slice(body.start + 1, body.end - 1), wrappedIndent);
  return [
    "{",
    `${baseIndent}  void feedback.processing();`,
    `${baseIndent}  try {`,
    `${baseIndent}    const wubbleResult = await (async () => {`,
    original || `${wrappedIndent}// The original handler body was empty.`,
    `${baseIndent}    })();`,
    `${baseIndent}    void feedback.success();`,
    `${baseIndent}    return wubbleResult;`,
    `${baseIndent}  } catch (error) {`,
    `${baseIndent}    void feedback.error();`,
    `${baseIndent}    throw error;`,
    `${baseIndent}  }`,
    `${baseIndent}}`
  ].join("\n");
}

/** @param {string} source @param {number} index */
function indentationAt(source, index) {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  return source.slice(lineStart, index).match(/^\s*/)?.[0] ?? "";
}

/** @param {string} body @param {string} prefix */
function indentOriginalBody(body, prefix) {
  const lines = body.replace(/\r/g, "").split("\n");
  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();
  if (lines.length === 0) return "";
  const indentation = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const commonIndent = Math.min(...indentation);
  return lines.map((line) => line.trim() ? `${prefix}${line.slice(commonIndent)}` : "").join("\n");
}

/** @param {string} source */
function isClientModule(source, file) {
  if (/^\s*["']use client["']\s*;?/.test(source)) return true;
  return /\.(?:jsx|tsx)$/.test(file) && !/(?:^|[\\/])app[\\/]/.test(file);
}

/** @param {string} source */
function clientDirectiveEnd(source) {
  const match = source.match(/^\s*["']use client["']\s*;?/);
  return match ? match[0].length : 0;
}

/** @param {string} value */
function toModulePath(value) {
  const normalized = value.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

/** @param {unknown} root @param {(node: any) => void} visit */
function walk(root, visit) {
  if (!root || typeof root !== "object") return;
  if (Array.isArray(root)) {
    for (const entry of root) walk(entry, visit);
    return;
  }
  if (typeof root.type === "string") visit(root);
  for (const [key, value] of Object.entries(root)) {
    if (["comments", "end", "extra", "loc", "start"].includes(key)) continue;
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** @param {string[]} actual @param {string[]} expected */
function sameEvents(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((event, index) => event === expected[index]);
}

/** @param {string} value */
function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} file */
async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

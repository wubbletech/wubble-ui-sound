import { parse } from "@babel/parser";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".html", ".vue"]);
const PARSER_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set([".git", ".next", ".wubble-ui-sounds", "coverage", "dist", "build", "node_modules"]);
const MAX_FILES = 4_000;
const MAX_FILE_BYTES = 1024 * 1024;
const CACHE_SCHEMA_VERSION = 3;

/**
 * Produces a read-only, reviewable feedback-placement plan for a source tree.
 * @param {string} projectDirectory
 */
export async function auditProject(projectDirectory, options = {}) {
  const root = path.resolve(projectDirectory);
  const scopes = resolveScopes(root, options.scopes);
  const sourceInventory = await listSourceFiles(root, scopes);
  const sourceFiles = sourceInventory.files;
  const cachePath = path.join(root, ".wubble-ui-sounds", "audit-cache.json");
  const cache = options.cache ? await readCache(cachePath) : { schemaVersion: CACHE_SCHEMA_VERSION, files: {} };
  const nextCache = { schemaVersion: CACHE_SCHEMA_VERSION, files: {} };
  const candidates = [];
  let skippedGenericControls = 0;
  let skippedLargeFiles = 0;
  let skippedExistingFeedbackFiles = 0;
  let parseFallbackFiles = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const file of sourceFiles) {
    const metadata = await stat(file);
    if (metadata.size > MAX_FILE_BYTES) {
      skippedLargeFiles += 1;
      continue;
    }
    const contents = await readFile(file, "utf8");
    if (usesWubbleFeedback(contents)) {
      skippedExistingFeedbackFiles += 1;
      continue;
    }
    const contentHash = hashText(contents);
    const cached = cache.files[file];
    const result = cached?.sha256 === contentHash ? cached.result : addCandidateContext(analyzeSourceFile(root, file, contents), contents, file);
    if (cached?.sha256 === contentHash) cacheHits += 1;
    else cacheMisses += 1;
    nextCache.files[file] = { sha256: contentHash, result };
    candidates.push(...result.candidates);
    skippedGenericControls += result.skippedGenericControls;
    if (result.usedFallback) parseFallbackFiles += 1;
  }

  const uniqueCandidates = deduplicateCandidates(candidates);
  const highConfidence = uniqueCandidates.filter((candidate) => candidate.confidence === "high").length;
  const mediumConfidence = uniqueCandidates.length - highConfidence;

  if (options.cache) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(nextCache, null, 2)}\n`, "utf8");
  }

  return {
    schemaVersion: 1,
    mode: "read-only",
    root,
    framework: inferFramework(sourceFiles),
    scopes: scopes.map((scope) => path.relative(root, scope).split(path.sep).join("/") || "."),
    scannedFiles: sourceFiles.length - skippedLargeFiles - skippedExistingFeedbackFiles,
    summary: {
      recommended: uniqueCandidates.length,
      highConfidence,
      mediumConfidence,
      skippedGenericControls,
      skippedLargeFiles,
      skippedExistingFeedbackFiles,
      parseFallbackFiles,
      reachedFileLimit: sourceInventory.reachedFileLimit,
      cacheHits,
      cacheMisses
    },
    candidates: uniqueCandidates
  };
}

/** @param {Awaited<ReturnType<typeof auditProject>>} report */
export function formatAudit(report) {
  const lines = [
    "Wubble UI Sounds Audit (read-only)",
    `Scanned ${report.scannedFiles} source files${report.framework ? ` (${report.framework})` : ""}.`,
    "",
    `Recommended moments: ${report.summary.recommended} (${report.summary.highConfidence} high confidence, ${report.summary.mediumConfidence} needs review)`
  ];

  if (report.candidates.length === 0) {
    lines.push("No high-confidence moments found. This is normal for an unfamiliar codebase; do not add feedback blindly.");
  } else {
    for (const candidate of report.candidates) {
      lines.push(`  ${candidate.id}  ${candidate.confidence.toUpperCase()}  ${candidate.label}`);
      lines.push(`      ${candidate.recommendation.mode}: ${candidate.events.join(" -> ")}  ${candidate.location}  ${candidate.reason}`);
    }
  }

  lines.push("");
  lines.push(`Skipped ${report.summary.skippedGenericControls} generic controls to avoid noisy feedback.`);
  if (report.summary.skippedExistingFeedbackFiles > 0) lines.push(`Skipped ${report.summary.skippedExistingFeedbackFiles} files that already import Wubble feedback.`);
  if (report.summary.skippedLargeFiles > 0) lines.push(`Skipped ${report.summary.skippedLargeFiles} files over the 1 MiB audit limit.`);
  if (report.summary.reachedFileLimit) lines.push(`Stopped at the ${MAX_FILES.toLocaleString()}-file audit limit. Re-run with --scope to inspect another area.`);
  if (report.summary.parseFallbackFiles > 0) lines.push(`Used conservative text fallback for ${report.summary.parseFallbackFiles} non-JavaScript source files.`);
  if (report.summary.cacheHits > 0) lines.push(`Reused ${report.summary.cacheHits} unchanged local analysis result${report.summary.cacheHits === 1 ? "" : "s"}.`);
  lines.push("Nothing was changed. Review this plan before applying feedback to application code.");
  lines.push("For a machine-readable plan, run: wubble-ui-sounds audit . --format json");
  return lines.join("\n");
}

/** @param {string} root @param {string} file @param {string} contents */
function analyzeSourceFile(root, file, contents) {
  if (!PARSER_EXTENSIONS.has(path.extname(file))) return analyzeTextFile(root, file, contents);
  try {
    const program = parse(contents, {
      sourceType: "unambiguous",
      plugins: ["jsx", "typescript"],
      errorRecovery: true
    });
    return analyzeProgram(root, file, program);
  } catch {
    return analyzeTextFile(root, file, contents);
  }
}

/** @param {string} root @param {string} file @param {any} program */
function analyzeProgram(root, file, program) {
  const candidates = [];
  let skippedGenericControls = 0;

  walk(program, (node) => {
    if (node.type === "FunctionDeclaration" && node.id?.type === "Identifier") {
      const signal = isLikelyHandlerName(node.id.name) ? classifyIntent(node.id.name) : undefined;
      if (signal) candidates.push(createCandidate(root, file, node.loc.start.line, signal, handlerAnchor(node, node.id.name)));
      return;
    }

    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)) {
      const signal = isLikelyHandlerName(node.id.name) ? classifyIntent(node.id.name) : undefined;
      if (signal) candidates.push(createCandidate(root, file, node.loc.start.line, signal, handlerAnchor(node.init, node.id.name)));
      return;
    }

    if (node.type === "CallExpression") {
      const signal = classifyCall(node.callee);
      if (signal) candidates.push(createCandidate(root, file, node.loc.start.line, signal));
      return;
    }

    if (node.type === "JSXElement" && isInteractiveElement(node.openingElement?.name)) {
      const directHandler = jsxAttribute(node.openingElement, "onClick") ?? jsxAttribute(node.openingElement, "onPress") ?? jsxAttribute(node.openingElement, "onSubmit");
      if (directHandler?.type === "Identifier" && /^(handle|on)[A-Z]/.test(directHandler.name)) return;
      const signal = classifyIntent(jsxText(node));
      const inlineHandler = jsxExpressionAttribute(node.openingElement, "onClick") ?? jsxExpressionAttribute(node.openingElement, "onPress") ?? jsxExpressionAttribute(node.openingElement, "onSubmit");
      if (signal && inlineHandler?.type === "ArrowFunctionExpression" && inlineHandler.async) {
        candidates.push(createCandidate(root, file, inlineHandler.loc.start.line, signal, inlineHandlerAnchor(inlineHandler)));
      } else if (signal) candidates.push(createCandidate(root, file, node.loc.start.line, signal));
      else skippedGenericControls += 1;
    }
  });

  // A named handler is more specific than a nearby button label. Keep the
  // handler so the plan does not ask the developer to review the same outcome twice.
  const handlerEvents = new Set(candidates
    .filter((candidate) => candidate.anchor?.type === "named-handler")
    .map((candidate) => candidate.events.join(",")));
  return {
    candidates: candidates.filter((candidate) => candidate.anchor || !handlerEvents.has(candidate.events.join(","))),
    skippedGenericControls,
    usedFallback: false
  };
}

/** @param {string} root @param {string} file @param {string} contents */
function analyzeTextFile(root, file, contents) {
  const candidates = [];
  let skippedGenericControls = 0;
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const signal = classifyTextCall(line) ?? classifyIntent(extractButtonText(line));
    if (signal) candidates.push(createCandidate(root, file, index + 1, signal));
    else if (/<button\b/i.test(line)) skippedGenericControls += 1;
  }
  return { candidates, skippedGenericControls, usedFallback: true };
}

/** @param {unknown} callee */
function classifyCall(callee) {
  const name = memberName(callee);
  if (name === "toast.success" || name === "notify.success") return directOutcome("success", "Visible success notification");
  if (name === "toast.error" || name === "notify.error") return directOutcome("error", "Visible error notification");
  if (name === "toast.warning" || name === "notify.warning") return directOutcome("warning", "Visible warning notification");
  if (name === "toast.info" || name === "notify.info") return directOutcome("notify", "Visible information notification");
  if (["router.push", "router.replace", "history.pushState", "history.replaceState"].includes(name)) {
    return { label: "Navigation transition", events: ["navigate"], confidence: "medium", recommendation: { mode: "none", reason: "Navigation already has a visible destination change; add sound only after a deliberate product review." }, reason: "A route transition was detected; confirm that this navigation is user-initiated and meaningful." };
  }
  return undefined;
}

/** @param {string} line */
function classifyTextCall(line) {
  const normalized = line.toLowerCase();
  if (/\b(?:toast|notify)\.(success|error|warning|info)\b/.test(normalized)) {
    const outcome = normalized.match(/\b(?:toast|notify)\.(success|error|warning|info)\b/)?.[1];
    return directOutcome(outcome === "info" ? "notify" : outcome, `Visible ${outcome} notification`);
  }
  if (/\b(?:router\.(?:push|replace)|navigate\s*\(|history\.(?:pushstate|replaceState))/.test(normalized)) {
    return { label: "Navigation transition", events: ["navigate"], confidence: "medium", recommendation: { mode: "none", reason: "Navigation already has a visible destination change; add sound only after a deliberate product review." }, reason: "A route transition was detected; confirm that this navigation is user-initiated and meaningful." };
  }
  return undefined;
}

/** @param {string | undefined} text */
function classifyIntent(text) {
  const words = toSemanticWords(text ?? "").toLowerCase();
  if (!words) return undefined;
  if (/\b(?:delete|remove|discard|destroy)\b/.test(words)) {
    return { label: "Destructive action committed", events: ["deleteConfirm"], confidence: "high", reason: "The handler or control indicates a destructive action; play only after the visible action succeeds." };
  }
  if (/\b(?:send|reply)\b/.test(words)) {
    return { label: "Message sent", events: ["send"], confidence: "high", reason: "The handler or control indicates an outbound communication event." };
  }
  if (/\b(?:save|submit|publish|upload|create|update)\b/.test(words)) {
    return { label: "Async action outcome", events: ["processing", "success", "error"], confidence: "high", reason: "The handler or control indicates a meaningful action; preserve visible pending, success, and error states." };
  }
  if (/\b(?:toggle|switch|enable|disable)\b/.test(words)) {
    return { label: "Binary setting transition", events: ["toggleOn", "toggleOff"], confidence: "medium", recommendation: { mode: "haptic", reason: "A brief native haptic is usually less distracting than repeated sound for a setting transition." }, reason: "The handler or control looks like a setting transition; confirm it is not a dense or repeated control." };
  }
  if (/\b(?:open|expand)\b/.test(words)) {
    return { label: "Surface opened", events: ["open"], confidence: "medium", reason: "The handler or control looks like a panel or modal transition; confirm it benefits from feedback." };
  }
  if (/\b(?:close|hide|collapse|dismiss)\b/.test(words)) {
    return { label: "Surface closed", events: ["close"], confidence: "medium", reason: "The handler or control looks like a panel or modal transition; confirm it benefits from feedback." };
  }
  return undefined;
}

/** Component names conventionally use PascalCase; handlers and actions do not. */
function isLikelyHandlerName(name) {
  return !/^[A-Z]/.test(name);
}

/** @param {string} event @param {string} label */
function directOutcome(event, label) {
  return { label, events: [event], confidence: "high", recommendation: { mode: "visual-only", reason: "The visible notification already carries the meaning; do not add sound by default." }, reason: "A visible notification already communicates a semantic outcome." };
}

/** @param {unknown} value */
function memberName(value) {
  if (value?.type === "Identifier") return value.name;
  if (value?.type === "MemberExpression" && !value.computed) {
    const object = memberName(value.object);
    const property = memberName(value.property);
    return object && property ? `${object}.${property}` : undefined;
  }
  return undefined;
}

/** @param {unknown} value */
function jsxName(value) {
  return value?.type === "JSXIdentifier" ? value.name : undefined;
}

/** @param {unknown} value */
function isInteractiveElement(value) {
  return ["button", "Pressable", "TouchableOpacity", "TouchableHighlight"].includes(jsxName(value));
}

/** @param {any} openingElement @param {string} name */
function jsxAttribute(openingElement, name) {
  const attribute = openingElement?.attributes?.find((entry) => entry.type === "JSXAttribute" && entry.name?.name === name);
  const expression = attribute?.value?.expression;
  return expression?.type === "Identifier" ? expression : undefined;
}

/** @param {any} openingElement @param {string} name */
function jsxExpressionAttribute(openingElement, name) {
  return openingElement?.attributes?.find((entry) => entry.type === "JSXAttribute" && entry.name?.name === name)?.value?.expression;
}

/** @param {any} element */
function jsxText(element) {
  return element.children
    .filter((child) => child.type === "JSXText")
    .map((child) => child.value.trim())
    .filter(Boolean)
    .join(" ");
}

/** @param {string} line */
function extractButtonText(line) {
  return line.match(/>\s*([^<>{}]{2,72})\s*<\//)?.[1];
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

/** @param {string} root @param {string} file @param {number} line @param {{ label: string, events: string[], confidence: "high" | "medium", reason: string }} signal */
function createCandidate(root, file, line, signal, anchor = undefined) {
  const relativeFile = path.relative(root, file).split(path.sep).join("/");
  return {
    id: `F${String(line).padStart(3, "0")}-${signal.events.join("-")}`,
    file,
    line,
    ...signal,
    group: signal.group ?? recommendationGroup(signal.events, signal.recommendation?.mode),
    recommendation: signal.recommendation ?? { mode: "sound", reason: "This is a meaningful, infrequent product moment with a matching local cue." },
    ...(anchor ? { anchor } : {}),
    location: `${relativeFile}:${line}`
  };
}

/** @param {string[]} events */
function recommendationGroup(events, mode = undefined) {
  if (mode === "haptic") return "Settings";
  if (mode === "visual-only") return "Visible outcomes";
  if (mode === "none") return "Navigation and surfaces";
  if (events.includes("processing") || events.includes("success") || events.includes("error") || events.includes("complete")) return "Save and submit";
  if (events.includes("send") || events.includes("receive")) return "Messaging";
  if (events.includes("deleteConfirm")) return "Destructive actions";
  if (events.includes("toggleOn") || events.includes("toggleOff")) return "Settings";
  if (events.includes("open") || events.includes("close") || events.includes("navigate")) return "Navigation and surfaces";
  if (events.includes("warning") || events.includes("notify")) return "Visible outcomes";
  return "Product feedback";
}

/** @param {{ candidates: Array<any>, skippedGenericControls: number, usedFallback: boolean }} result @param {string} contents @param {string} file */
function addCandidateContext(result, contents, file) {
  const lines = contents.split(/\r?\n/);
  return {
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      context: sourceSnippet(lines[candidate.line - 1]),
      implementation: implementationGuidance(candidate, contents, file)
    }))
  };
}

/** @param {any} candidate @param {string} contents @param {string} file */
function implementationGuidance(candidate, contents, file) {
  const isAsyncOutcome = candidate.events.join(",") === "processing,success,error";
  const supportedAnchor = ["named-handler", "inline-handler"].includes(candidate.anchor?.type);
  if (candidate.recommendation.mode === "sound" && isAsyncOutcome && supportedAnchor && candidate.anchor.async && candidate.anchor.body === "BlockStatement" && isClientSource(contents, file)) {
    return { mode: "safe-patch-candidate", reason: "Eligible for a reviewable local patch after approval; final source and handler checks still apply." };
  }
  if (candidate.recommendation.mode === "sound" && isAsyncOutcome && supportedAnchor && !isClientSource(contents, file)) {
    return { mode: "manual-review", reason: "Server or non-client code: keep this feedback decision in the reviewed client component that owns the visible interaction." };
  }
  if (candidate.recommendation.mode === "sound") {
    return { mode: "manual-review", reason: "This cue needs a product-specific success boundary, so no automatic code patch will be generated." };
  }
  return { mode: "guidance-only", reason: "This is intentional non-sound guidance and receives no code patch." };
}

/** @param {string} source @param {string} file */
function isClientSource(source, file) {
  if (/^\s*["']use client["']\s*;?/.test(source)) return true;
  return /\.(?:jsx|tsx)$/.test(file) && !/(?:^|[\\/])app[\\/]/.test(file);
}

/** @param {string | undefined} line */
function sourceSnippet(line) {
  if (!line) return undefined;
  const normalized = line.trim().replace(/\s+/g, " ");
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

/** @param {any} node @param {string} name */
function handlerAnchor(node, name) {
  return {
    type: "named-handler",
    name,
    async: Boolean(node.async),
    body: node.body?.type
  };
}

/** @param {any} node */
function inlineHandlerAnchor(node) {
  return { type: "inline-handler", async: Boolean(node.async), body: node.body?.type };
}

/** @param {Array<any>} candidates */
function deduplicateCandidates(candidates) {
  const seen = new Set();
  const unique = candidates.filter((candidate) => {
    const key = `${candidate.file}:${candidate.line}:${candidate.events.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  const idCounts = new Map();
  return unique.map((candidate) => {
    const count = (idCounts.get(candidate.id) ?? 0) + 1;
    idCounts.set(candidate.id, count);
    return count === 1 ? candidate : { ...candidate, id: `${candidate.id}-${count}` };
  });
}

/** @param {string} directory */
async function listSourceFiles(directory, scopes) {
  const files = [];
  let reachedFileLimit = false;
  async function visit(current) {
    if (files.length >= MAX_FILES) {
      reachedFileLimit = true;
      return;
    }
    const currentMetadata = await stat(current);
    if (currentMetadata.isFile()) {
      if (SOURCE_EXTENSIONS.has(path.extname(current)) && !isGeneratedMetadataFile(path.basename(current))) files.push(current);
      return;
    }
    if (!currentMetadata.isDirectory()) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        reachedFileLimit = true;
        return;
      }
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(target);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !isGeneratedMetadataFile(entry.name)) {
        files.push(target);
      }
    }
  }
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) throw new Error(`Audit target must be a directory: ${directory}`);
  for (const scope of scopes) await visit(scope);
  return { files: [...new Set(files)].sort(), reachedFileLimit };
}

/** @param {string} root @param {string[] | undefined} requested */
function resolveScopes(root, requested) {
  if (!requested?.length) return [root];
  return requested.map((scope) => {
    const resolved = path.resolve(root, scope);
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Audit scope points outside the project: ${scope}`);
    return resolved;
  });
}

/** @param {string} cachePath */
async function readCache(cachePath) {
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    return cache?.schemaVersion === CACHE_SCHEMA_VERSION && cache.files && typeof cache.files === "object" ? cache : { schemaVersion: CACHE_SCHEMA_VERSION, files: {} };
  } catch {
    return { schemaVersion: CACHE_SCHEMA_VERSION, files: {} };
  }
}

/** @param {string} name */
function isGeneratedMetadataFile(name) {
  return /(?:^|[-_.])(manifest|generated)(?:[-_.]|$)/i.test(name);
}

/** @param {string} contents */
function usesWubbleFeedback(contents) {
  return /(?:from\s+["'](?:@wubbleai\/(?:ui-sounds|sounds|react|react-native)|[^"']*wubble-ui-sounds(?:\.[cm]?[jt]sx?)?)["']|create(?:Native)?FeedbackClient|useAsyncFeedback)/.test(contents);
}

/** @param {string[]} files */
function inferFramework(files) {
  if (files.some((file) => /(?:^|\/)app\/.+\.(?:jsx|tsx)$/.test(file))) return "React or Next.js";
  if (files.some((file) => /\.(?:jsx|tsx)$/.test(file))) return "React";
  if (files.some((file) => file.endsWith(".vue"))) return "Vue";
  return undefined;
}

/** @param {string} value */
function toSemanticWords(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
}

/** @param {string} value */
function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditProject } from "../packages/cli/src/audit.js";
import { scoreAudit } from "../packages/cli/src/audit-evaluation.js";
import { writeAuditCorpus } from "./audit-evaluation-corpus.mjs";

test("labeled audit corpus has no missed or spurious recommendations", async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-corpus-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  const expected = await writeAuditCorpus(project);

  const first = await auditProject(project, { cache: true });
  const score = scoreAudit(first, expected);
  assert.deepEqual(score, {
    expected: expected.length,
    found: expected.length,
    truePositives: expected.length,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1
  });
  assert.equal(first.summary.cacheHits, 0);
  assert.equal(first.summary.cacheMisses, 22);
  assert.equal(first.summary.skippedExistingFeedbackFiles, 1);
  assert.equal(first.candidates.find((candidate) => candidate.file.endsWith("toggle.jsx")).recommendation.mode, "haptic");
  assert.equal(first.candidates.find((candidate) => candidate.file.endsWith("toast-success.jsx")).recommendation.mode, "visual-only");
  assert.equal(first.candidates.find((candidate) => candidate.file.endsWith("navigate.jsx")).recommendation.mode, "none");

  const second = await auditProject(project, { cache: true });
  assert.equal(second.summary.cacheHits, 22);
  assert.equal(second.summary.cacheMisses, 0);
});

test("scoped audit limits analysis to explicitly selected folders", async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-scope-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  const expected = await writeAuditCorpus(project);

  const report = await auditProject(project, { scopes: ["save.jsx", "send.jsx"] });
  const score = scoreAudit(report, expected.filter((entry) => ["save.jsx", "send.jsx"].includes(entry.file)));
  assert.equal(report.scannedFiles, 2);
  assert.equal(score.precision, 1);
  assert.equal(score.recall, 1);
});

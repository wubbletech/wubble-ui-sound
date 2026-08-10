import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditProject } from "../packages/cli/src/audit.js";
import { scoreAudit } from "../packages/cli/src/audit-evaluation.js";
import { writeAuditCorpus } from "../tests/audit-evaluation-corpus.mjs";

const project = await mkdtemp(path.join(os.tmpdir(), "wubble-ui-sounds-corpus-"));
try {
  const expected = await writeAuditCorpus(project);
  const report = await auditProject(project, { cache: true });
  const score = scoreAudit(report, expected);
  console.log("Wubble UI Sounds controlled audit benchmark");
  console.log(`Fixtures: ${score.expected}; detected: ${score.found}`);
  console.log(`Precision: ${(score.precision * 100).toFixed(1)}%; recall: ${(score.recall * 100).toFixed(1)}%`);
  console.log("This is a regression fixture, not a claim about arbitrary production codebases.");
  if (score.falsePositives || score.falseNegatives) process.exitCode = 1;
} finally {
  await rm(project, { recursive: true, force: true });
}

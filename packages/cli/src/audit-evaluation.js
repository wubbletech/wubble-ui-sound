/**
 * Scores a labeled audit corpus. A match requires the same fixture file and semantic event sequence.
 * It is intentionally a controlled benchmark, not a claim about arbitrary production codebases.
 * @param {{ candidates: Array<any> }} report
 * @param {Array<{ file: string, events: string[] }>} expected
 */
export function scoreAudit(report, expected) {
  const key = (entry) => `${entry.file}:${entry.events.join(",")}`;
  const expectedKeys = new Set(expected.map(key));
  const found = report.candidates.map((candidate) => ({
    file: path.relative(report.root, candidate.file).split(path.sep).join("/"),
    events: candidate.events
  }));
  const foundKeys = new Set(found.map(key));
  const truePositives = [...foundKeys].filter((entry) => expectedKeys.has(entry)).length;
  const falsePositives = [...foundKeys].filter((entry) => !expectedKeys.has(entry)).length;
  const falseNegatives = [...expectedKeys].filter((entry) => !foundKeys.has(entry)).length;
  const precision = truePositives / Math.max(1, truePositives + falsePositives);
  const recall = truePositives / Math.max(1, truePositives + falseNegatives);
  return { expected: expectedKeys.size, found: foundKeys.size, truePositives, falsePositives, falseNegatives, precision, recall };
}
import path from "node:path";

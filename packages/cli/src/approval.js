import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Creates a durable approval record from a read-only audit plan.
 * This intentionally never edits application source files.
 * @param {{ plan: string, select: string, output?: string, force?: boolean, dryRun?: boolean }} options
 */
export async function approveAuditPlan(options) {
  const auditPath = path.resolve(options.plan);
  const audit = await readAuditPlan(auditPath);
  const selection = resolveSelection(audit.candidates, options.select);
  const output = path.resolve(options.output ?? path.join(audit.root, ".wubble-ui-sounds", "approved-plan.json"));
  const approval = {
    schemaVersion: 1,
    kind: "wubble-ui-sounds-approval",
    audit: {
      root: audit.root,
      source: auditPath,
      sha256: createHash("sha256").update(JSON.stringify(audit)).digest("hex")
    },
    approved: selection.approved,
    rejectedCandidateIds: selection.rejected.map((candidate) => candidate.id)
  };

  if (!options.dryRun) {
    const exists = await fileExists(output);
    if (exists && !options.force) {
      throw new Error(`Approval record already exists: ${output}. Review it or re-run with --force to replace it.`);
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  }

  return { approval, output, dryRun: Boolean(options.dryRun), approved: selection.approved, rejected: selection.rejected };
}

/** @param {string} auditPath */
async function readAuditPlan(auditPath) {
  let audit;
  try {
    audit = JSON.parse(await readFile(auditPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read audit plan: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (audit?.schemaVersion !== 1 || audit?.mode !== "read-only" || typeof audit.root !== "string" || !Array.isArray(audit.candidates)) {
    throw new Error("Approval requires a Wubble read-only audit JSON plan.");
  }
  const ids = new Set();
  for (const candidate of audit.candidates) {
    if (!candidate || typeof candidate.id !== "string" || !Array.isArray(candidate.events) || candidate.events.length === 0) {
      throw new Error("Audit plan contains an invalid candidate.");
    }
    if (ids.has(candidate.id)) throw new Error(`Audit plan has duplicate candidate id: ${candidate.id}.`);
    ids.add(candidate.id);
  }
  return audit;
}

/** @param {Array<any>} candidates @param {string} selection */
function resolveSelection(candidates, selection) {
  if (selection === "all") return { approved: candidates, rejected: [] };
  if (selection === "none") return { approved: [], rejected: candidates };
  const requested = new Set(selection.split(",").map((value) => value.trim()).filter(Boolean));
  if (requested.size === 0) throw new Error("--select must be all, none, or a comma-separated list of candidate ids.");
  const available = new Set(candidates.map((candidate) => candidate.id));
  const unknown = [...requested].filter((id) => !available.has(id));
  if (unknown.length > 0) throw new Error(`Audit plan does not contain: ${unknown.join(", ")}.`);
  return {
    approved: candidates.filter((candidate) => requested.has(candidate.id)),
    rejected: candidates.filter((candidate) => !requested.has(candidate.id))
  };
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

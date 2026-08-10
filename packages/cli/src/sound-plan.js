const MODE_GUIDANCE = {
  sound: "Review the proposed local cue and patch. Audio stays supplemental to visible feedback.",
  haptic: "Prefer a brief native haptic for this repeated setting transition; do not add sound by default.",
  "visual-only": "Keep the existing visible notification. Do not add sound unless the product team explicitly chooses it.",
  none: "Do not add feedback by default. The navigation or existing visual transition already carries the meaning."
};

/** @param {Array<any>} candidates */
export function groupRecommendations(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const group = candidate.group ?? "Product feedback";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(candidate);
  }
  return [...groups.entries()].map(([label, entries]) => ({ label, candidates: entries }));
}

/** @param {{ root: string, framework?: string, candidates: Array<any> }} report @param {Array<any>} selected */
export function formatSoundPlan(report, selected) {
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const lines = [
    "# Wubble UI Sounds Plan",
    "",
    "This local plan is a review artifact. It does not make source-code changes.",
    report.framework ? `Framework signal: ${report.framework}.` : "Framework signal: no specific framework detected.",
    ""
  ];

  for (const group of groupRecommendations(report.candidates)) {
    lines.push(`## ${group.label}`, "");
    for (const candidate of group.candidates) {
      const selectedMark = selectedIds.has(candidate.id) ? "x" : " ";
      lines.push(`- [${selectedMark}] ${candidate.label} (${candidate.recommendation.mode})`);
      lines.push(`  - Location: ${candidate.location}`);
      lines.push(`  - Why: ${candidate.reason}`);
      if (candidate.context) lines.push(`  - Context: \`${candidate.context.replace(/`/g, "'")}\``);
      if (candidate.implementation) lines.push(`  - Implementation: ${candidate.implementation.mode} - ${candidate.implementation.reason}`);
      lines.push(`  - Guidance: ${candidate.recommendation.reason ?? MODE_GUIDANCE[candidate.recommendation.mode]}`);
    }
    lines.push("");
  }

  lines.push("## Review boundary", "", "Only selected `sound` recommendations can receive a generated code patch. Haptic, visual-only, navigation, and ambiguous moments remain product decisions.", "");
  return lines.join("\n");
}

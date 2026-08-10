# First Run

The fastest useful path is one command from an application directory:

```bash
npm install @wubble/ui-sounds
npx wubble-ui-sounds start .
```

Wubble scans only local source. It groups likely feedback moments by flow and
asks which ones belong in the application. Selecting a flow exports compact
local audio and writes review artifacts, but does not modify application source.

```text
Wubble UI Sounds: local scan complete
Scanned 14 source files (React). Found 4 feedback moments; 2 sound recommendations selected.

+ Save and submit: Save profile at src/components/save-profile.tsx:18
  Why: Explicit async outcome has a visible success/failure boundary.
  Implementation: An explicit client-side async handler can receive a safe patch.

Saved audit: .wubble-ui-sounds/latest-audit.json
Saved sound plan: .wubble-ui-sounds/sound-plan.md
Exported compact local audio so the reviewed patch has files to import.
1 safe handler patch across 1 file; 1 needs manual review.
PR-ready patch: .wubble-ui-sounds/recommended.patch
Review confirmation SHA-256: <hash>
Next: review the patch. Source files stay unchanged until you re-run with --apply in an interactive terminal.
```

Review the standard patch using the team's usual workflow. The CLI includes a
hash-bound `--apply` path for the exact preview, but `git apply` remains equally
valid after review:

```bash
git apply --check .wubble-ui-sounds/recommended.patch
git apply .wubble-ui-sounds/recommended.patch
```

For large projects, start from a meaningful slice and cache unchanged analysis:

```bash
npx wubble-ui-sounds start . --scope src/app,src/features --cache
```

The scan ignores dependencies and generated output, skips files above 1 MiB, and
stops at 4,000 source files. It reports when those limits are reached. Use
`wubble-ui-sounds start --help` for the concise command reference and
`wubble-ui-sounds --help` for advanced release, archive, and rollback commands.

To choose a deliberate sound direction rather than the default delivery set:

```bash
wubble-ui-sounds directions
wubble-ui-sounds start . --style minimal
```

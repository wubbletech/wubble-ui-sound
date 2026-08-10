# Complex Audit Fixture

This intentionally non-runnable fixture represents a medium-sized product with
separate account, billing, inbox, settings, workspace, and shared UI surfaces.
It exists to rehearse the local `wubble-ui-sounds audit` and `add` workflow.

Expected review plan:

- Generated safe patches: profile save, project creation, avatar upload, and
  report publish. Each is an explicit async client-side action.
- Manual sound review: send invoice, send message, delete workspace, and
  open/close surfaces, plus the server-side workspace update. The scanner should
  identify these moments but must not guess their precise success boundary or
  cross a server/client boundary.
- Deliberate non-sound guidance: settings toggle is haptic, toast outcomes are
  visual-only, and route navigation is none by default.
- No recommendation: search, help, pagination, and other generic controls.
- Existing Wubble surface: skipped entirely to avoid duplicate instrumentation.

This fixture is a controlled developer-experience rehearsal, not evidence of
accuracy in arbitrary customer applications.

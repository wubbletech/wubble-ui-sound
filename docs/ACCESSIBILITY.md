# Accessibility Contract

Wubble feedback is an optional supplement to product feedback. It must never be the only way a person can understand, complete, or recover from an action.

## Application Rules

- Keep commands, navigation, forms, confirmations, and error recovery usable when `play()` returns `disabled`, `locked`, `unavailable`, or any other non-playing result.
- Provide visible pending, success, warning, error, and destructive-action states independently of the feedback runtime.
- Keep sound off by default and expose a keyboard-accessible user preference. `FeedbackSettings` provides a grouped sound switch, volume, reduced-feedback, and quiet-context controls.
- Use `setReducedFeedback(true)` for people who want fewer frequent cues and `setQuietMode(true)` for an application context that should suppress low-priority cues. The React provider persists both preferences locally.
- On React Native, use `setHapticsEnabled(false)` when a person disables haptics. Keep haptics supplemental and preserve native visible and assistive-technology feedback.
- Treat browser audio unlock failure and missing local assets as normal outcomes. Do not gate the product action on a successful playback result.

## SDK Behavior

The web and React Native clients return a structured non-playing result instead of throwing when feedback is disabled, unavailable, rate-limited, reduced, or suppressed for a quiet context. `runFeedbackAction()` still runs the underlying action and reports its `pending`, `success`, or `error` state when audio is disabled.

The reference Next.js flow intentionally keeps every product action available with sound off. Its visible, polite live-region status remains the source of feedback; the sound result is secondary.

Manual screen-reader and physical-device validation remain release requirements. See the [browser/device matrix](BROWSER_MATRIX.md) before claiming support for a particular assistive technology or operating system setting.

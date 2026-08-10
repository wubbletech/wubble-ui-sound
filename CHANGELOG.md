# Changelog

All notable changes to Wubble UI Sounds are documented here.

## Unreleased

## 0.1.0 - 2026-08-10

### Added

- Local-first manifest validation and browser sound runtime.
- Safe local export CLI with inspection, budget validation, content-hashed assets, dry runs, and overwrite protection.
- React bindings with a persisted user setting.
- Next.js App Router integration example.
- Guided `start` workflow that scans local source, records developer approval, exports local audio, and produces a reviewable patch.
- Explicit local sound directions through `wubble-ui-sounds directions` and `--style`.
- Web and React Native local export, signed archive verification, upgrade, and rollback workflows.
- Accessibility controls for optional sound, volume, reduced feedback, quiet contexts, and haptics.

## Release policy

- Packages follow semantic versioning once published.
- Breaking manifest changes require a new `schemaVersion`, a migration path, and a documented support window.
- Security fixes are released for the current supported package line.

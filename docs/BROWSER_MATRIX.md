# Browser Matrix

Run this checklist against a release candidate of `@wubble/sounds`, `@wubble/react`, and `@wubble/ui-sounds`. Record the actual package revision, device, browser version, and result for each row. Do not mark an untested combination as passed.

## Required environments

| Environment | Device | Browser | Owner | Result |
| --- | --- | --- | --- | --- |
| Desktop | macOS or Windows | Current Chrome |  |  |
| Desktop | macOS or Windows | Current Firefox |  |  |
| Desktop | macOS | Current Safari |  |  |
| Mobile | iPhone or iPad | Current Safari |  |  |
| Mobile | Android phone | Current Chrome |  |  |

## Test script

Run the same sequence in every environment:

1. Load the app with sound disabled; confirm no audio plays automatically.
2. Complete an interaction with sound disabled; confirm the visual outcome is complete and meaningful.
3. Enable sound using the settings control; confirm the browser accepts the first user-gesture unlock.
4. Trigger `tap`, `success`, and `error`; confirm the local asset plays once at a conservative volume.
5. Use browser developer tools or the pack audit record to confirm an eligible browser selects the declared local WebM Opus source; confirm the MP3 primary still plays when that source is unavailable.
6. Activate the controls using the keyboard where available; confirm feedback behavior matches pointer activation.
7. Lower volume, disable sound, re-enable sound, and reload; confirm the preference behaves as documented.
8. Trigger repeated actions rapidly; confirm playback remains bounded and never blocks the application action.
9. Temporarily remove one asset or corrupt its path; confirm the product action still succeeds and no user-facing error appears.
10. Use the app in a noisy environment or with low device volume; confirm visual feedback remains sufficient.

## Pass criteria

- No sound plays before an explicit user choice and eligible browser interaction.
- No playback error rejects, delays, or changes an application action.
- Sound-off and inaccessible/missing-audio flows remain fully usable.
- Local assets resolve from the customer application origin, with no runtime Wubble request or credential.
- The runtime selects only a local codec source that `HTMLMediaElement.canPlayType()` reports as playable; the MP3 primary remains available as the compatibility fallback.
- No overlapping burst exceeds the configured concurrency limit.
- Any failure includes a reproducible environment and a linked issue before release.

## Result record

## Initial verification evidence

| Date | Revision | Environment | Completed checks | Result |
| --- | --- | --- | --- | --- |
| 2026-08-06 | `4df7075` | macOS, Headless Chrome 150 | Initial sound-off state, explicit opt-in, pointer activation for `tap`, `success`, and `error`, and Enter-key activation for `tap` | Passed |
| 2026-08-08 | `cbfda83` | Local Node 20 validation | `npm run check`, 9 automated tests, optimized Next.js build, clean-target CLI export and re-validation, and dry-run packaging of all four public packages | Passed |
| 2026-08-09 | `fc67e1d` | Local Chromium browser, Vanilla example | Sound-off initial state, explicit opt-in/unlock, local `success` and `error` playback requests, and zero browser-console errors. The local `tap.wav` asset returned `200` from the example origin. | Passed with headless-audio limits |
| 2026-08-09 | `fc67e1d` | Local Node 23, macOS | `npm run check`, 25 automated tests, and optimized Next.js production build. CLI inspection measured the complete 16-event fixture pack at 93.5 KB / 120 KB (77.9%). | Passed |
| 2026-08-09 | Local prototype pack | Physical Android phone, Chrome (model/version not recorded) | Manual sound enablement, single-cue playback, task flow, send/receive flow, persisted preferences after reload, and bounded rapid taps. User reported all checks looked and sounded good. | Passed; capture model/version before release candidate approval |

The automated runs confirm local playback behavior, policy enforcement, byte budget, and a clean Next.js build. The browser exercise reached sound opt-in and local playback without console errors. In that headless environment, an audio element did not emit its natural `ended` event, so later cues correctly hit the configured concurrency limit; it cannot establish physical audibility, natural cue completion, or rapid-repeat behavior on a real device. This is runtime evidence, not a substitute for device-level listening checks.

Still pending: Firefox, Safari, iOS Safari, Android Chrome codec-source selection with a recorded device/version, a missing-asset fallback on a physical browser, and the remaining supported-device accessibility checks. These rows remain untested and must be completed before a public release candidate is approved.

For each failed case, capture:

```text
Package revision:
Device / browser / version:
Network condition:
Steps to reproduce:
Expected behavior:
Actual behavior:
Console error, if any:
Screen recording or screenshot location:
```

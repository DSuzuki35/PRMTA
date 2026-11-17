# Changelog

## 0.2.4 - Voice-aware highlight pacing

- Added optional smooth voice highlighting per output profile, enabled by default for local Whisper.
- Uses the microphone RMS envelope and recent confirmed speaking pace (a rolling two-minute window) to preview at most two words between recognition results.
- Stops advancing during silence or missing audio; corrects against new recognition and withdraws stale guesses after 2.5 seconds without a fresh match.
- Keeps the confirmed script position, read-text dimming and page changes independent of visual predictions. Manual navigation and take changes reset prediction.
- Synchronizes the visual estimate across studio, display/browser and VR outputs without extra inference requests.
- Increased the gap before the logo underscore and removed the inactive workspace menu dots.

## 0.2.3 - UI accessibility and voice continuity

- Removed decorative long dashes from window/browser titles, duplicate names and the end marker.
- Increased spacing below flow selectors and enlarged switch, slider and icon-button targets.
- Improved control borders, muted text contrast, keyboard focus and forced-colors styling.
- Exposed switch/button states, labeled navigation and added a skip link.
- Made Help and Version history modal keyboard dialogs with focus containment, Escape handling and opener restoration; modal keys no longer affect playback.
- Added automated accessibility checks across the four main views, wide and narrow layouts, plus keyboard regressions.
- Prevented distant accidental speech matches from moving the prompter; matches must connect to the current position and progress is bounded. Manual navigation remains available for intentional skips.

## 0.2.2 — Natural page endings

- Automatic pages now keep whole sentences together around a 60-word target; overlong sentences may split at clause punctuation instead of arbitrary words.
- Kept unpunctuated passages intact and preserved manually placed page breaks.
- Fixed punctuation and quotation marks disappearing at page boundaries.
- Added an optional muted, single-line preview of the next page, configured separately per output profile and included in page fitting.

## 0.2.1 — Responsive controls and rendering

- Bounded continuous text rendering to a viewport-sized word window (512 words minimum), removed the oversized compositor hint and fixed the visible position after loading another script.
- Added mouse-wheel navigation and a per-output Smooth line transitions option.
- Fixed inverted page-mode font sizing with stable fitting in studio, browser and VR outputs; explained the size limit in the inspector.
- Added background opacity from 0–100% without dimming text.
- Added a live microphone test meter with peak hold, clipping indication and input cleanup.
- Added Assign button controls requiring a release → press → release cycle; held buttons and disconnects cannot finish assignment.
- Added Responsive and Steady voice response settings, shorter overlapping audio windows, paused-inference gating and stale-result rejection.
- Made voice activation visible above the preview.
- Fixed Copy link in Electron through a restricted native clipboard bridge, with browser fallback and success feedback.

## 0.2.0 — PRMTA

- Renamed the app from PRMPT to PRMTA with compatibility for existing profiles and cloud revisions.
- Translated the interface, status messages, errors and sample script to English.
- Applied Dan Suzuki UI Kit colors, typography, controls and accessible focus states; bundled the fonts locally.
- Added verified downloads and selection for Tiny, Base, Small Q5, Small and Large v3 Turbo Q5.
- Added one-button voice setup with model download progress and startup; removed terminal instructions from the app UI.
- Fixed the model-selector label layout and aligned the purple wordmark bar with the baseline of PRMTA.
- Applied Claude Code review improvements: cached script tokenization and library lists, indexed single-script loading, iterative revision graph validation, memoized word rendering and stable resize observation.
- Hardened draft recovery, model process ownership and microphone failure handling.
- Added English documentation, screenshots and release verification records.

## 0.1.0 — PRMPT prototype

Initial Windows Electron teleprompter with a revisioned TXT library, local Whisper voice follow, display/browser/OpenKneeboard output, keyboard/gamepad navigation and cloud-folder sync.

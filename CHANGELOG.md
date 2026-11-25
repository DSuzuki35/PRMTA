# Changelog

## Unreleased

- Added optional stage directions in `[square brackets]`. Prompter outputs show cues while voice follow, pacing and navigation use only the spoken text. Source TXT and editor content remain unchanged.
- Added per-output stage direction visibility and text color, including browser, external display and VR outputs. Existing profiles default to visible amber cues.

## 0.4.1

- Prevented older settings-save responses from overwriting newer edits, including rapid language changes. Preference writes are serialized and acknowledgements are matched to the current edit.

- macOS now connects to independently managed Whisper servers on every supported loopback address without requiring Windows binaries or model files. Windows bundled Whisper startup and model selection are preserved.
- Mac settings identify Apple on-device speech, expose Whisper as an external server, disable Windows-only Parakeet selection, and remove unsupported model downloads. The backend also rejects unmanaged model installation.
- New Mac profiles and explicit keyboard reset use Cmd + arrows for sentence and paragraph navigation. Existing language choices and shortcut assignments are preserved.
- Mac test builds explain manual DMG updates without recommending Windows Setup. They remain ad-hoc signed and are not notarized; Windows automatic updates are unchanged.
- Native speech smoke checks reject empty/unrelated fixture transcripts. Mac CI now runs on pull requests/main and checks UI workflows plus actual packaged-app startup, external Whisper, settings and shutdown on each architecture, without recording a microphone.

## 0.4.0 - Custom shortcuts, voice commands and system speech

- Released PRMTA as open source under the MIT License, with the license included in Windows and Mac packages. Third-party components and models retain their existing licenses.

- Added configurable keyboard shortcuts for playback, word/sentence/paragraph/page/chapter navigation, held scrolling, speed, microphone, display and reading modes. Capture waits for key release, rejects duplicate/reserved combinations and supports clearing or restoring defaults.
- Added independent keyboard scrolling speed and an option to keep an active Voice take running after keyboard navigation.
- Added opt-in voice commands with a configurable wake phrase, including “prompta, next sentence”, “previous chapter”, play, pause and speed changes. Complete phrases, silence boundaries and stale-audio checks prevent premature or repeated actions. Command text never advances script matching.
- Added chapter navigation using Markdown headings, or explicit page separators when no headings exist.
- Added local Windows System.Speech recognition using installed speech languages. English is the default; existing language choices are retained.
- Prepared macOS 13+ Apple Silicon/Intel builds with on-device Apple speech, permission descriptions, signing configuration and a manual build workflow. Real Mac permission/microphone testing remains required.
- Added grid/list library views, overview delete buttons and a close button for the script editor with draft-save safeguards.
- Fixed cloud TXT preservation when changing only title capitalization on case-insensitive macOS volumes, using filesystem identity instead of operating-system assumptions.
- Provided both Windows Setup with automatic updates and the portable executable; updated English guides and screenshots.

## 0.3.1 - Background controllers and optional Parakeet

- Added native SDL controller input in the Windows app, including generic joysticks/HOTAS and up to 128 raw buttons. Input continues while another app has focus or PRMTA is minimized.
- Added **Controller input in background** and **Keep voice follow active**, both enabled by default. Active voice following continues after controller navigation; held scrolling takes priority until release, then fresh speech resumes following.
- Unified native assignment snapshots and live button handling, preserved standard gamepad shoulder defaults, and retained full release/press/release capture and disconnect safeguards.
- Added optional local NVIDIA Parakeet TDT 0.6B v3 INT8 recognition, automatic detection of 25 supported languages, and guided setup of the verified model and private runtime (about 731 MB).
- Added recommended CPU processing and optional DirectML GPU processing for Parakeet, with setup progress, cancellation, retry and processor status.
- Changed the default script language for new profiles to English. Existing language preferences remain unchanged; Parakeet detects language automatically.
- Updated English setup instructions, controller guidance and third-party attribution.

## 0.3.0 - Controller navigation and Windows updates

- Added eight assignable controller actions: previous/next page, paragraph and sentence, plus hold-to-scroll up/down.
- Added independent controller scrolling speed, smooth synchronized movement and stop safeguards for release, disconnect and lost input.
- Preserved release/press/release assignment, rejected duplicate assignments and added clearing of optional bindings.
- Added a Windows Setup installer with automatic update checks, background downloads and an explicit restart-and-install action in Settings. Portable builds remain available for manual updates.
- Included configurable local Whisper ports and validation for external loopback speech servers.
- Updated English documentation and controller/update screenshots.

## 0.2.5 - Cloud libraries and expanded editor

- Separate local and cloud libraries, with an explicit copy-current-scripts or open-folder-only choice.
- One current readable TXT per cloud script; edits, renames and deletions are reflected in the folder and external changes are imported.
- Local history/trash and verified local backups when converting old revision folders.
- Workspace labels on script cards and safeguards against stale editor saves after switching libraries.
- Expand the script editor inside the app window; Escape restores the layout and preserves the draft.


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

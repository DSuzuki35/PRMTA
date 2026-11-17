# Changelog

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

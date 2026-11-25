# Release verification — PRMTA

## 0.4.1 macOS test-build verification

- On an Apple Silicon Mac: production build and 242 unit/integration tests passed; two Windows-only tests were skipped. Both Python prerequisite tests passed. The final complete Chromium suite passed all 74 workflows.
- The first full UI run exposed an existing settings-save race: an older response could overwrite a newer language edit. A controlled response/WebSocket regression reproduced it before the fix; revision guards and serialized saves passed the regression and final full suite.
- ARM64 and x64 DMG/ZIP packages were built locally. Both app bundles passed deep strict signature checks and their speech helpers passed the corresponding architecture check. The Intel package was cross-built, not run on physical Intel hardware in this local check.
- The final packaged ARM64 app passed isolated startup, Apple locale inventory, default Mac shortcuts/provider, external Whisper startup/transcription, model-download rejection, Mac settings, zero renderer errors and orderly shutdown.
- Apple Speech also transcribed the public whisper.cpp JFK fixture twice through a Launch Services app launch (22 words each), rejected unavailable German support, recovered to English and shut down. No microphone was captured. The initial direct IDE-spawn attempt aborted in TCC because the IDE was the responsible process; the permission-sensitive harness now launches PRMTA using macOS Launch Services.
- Independent code review found no blocking Windows regression. The remaining misleading saved-Parakeet pane and Mac background-input control were removed, with focused Mac/Windows UI checks passing. Windows bundled Whisper process/model behavior and Windows update guards remain covered by the shared tests; native Windows verification is delegated to the PR CI.
- These are ad-hoc-signed test builds with manual Mac updates. No Developer ID signing, notarization, physical microphone/denied-permission sequence, real controller hardware, multi-monitor setup, or physical Intel test is claimed.

## 0.4.0 update verification

- [Windows CI passed](https://github.com/DSuzuki35/PRMTA/actions/runs/45010763506) for source `a543c8e`: production build, 237 unit/integration tests, two Python prerequisite tests and 70 Chromium workflows. Local focused cloud/library workflows also passed after the macOS case-only filename correction.
- Keyboard tests cover configurable capture, reserved/duplicate bindings, Cmd key-release behavior, held-scroll stopping, context suspension and accurate shortcut hints. A real remote client retains safe defaults with public-only preferences.
- Voice-command tests exercise real Chromium PCM capture with generated audio, final-phrase execution, deduplication, intentional repeats, paused listening and stale navigation responses. Deterministic audio tests verify wake-word pre-roll, final snapshots during slow inference, ordinary narration across pauses, and rejection of stale commands and command fragments. These are routing/capture checks, not real-microphone command-accuracy benchmarks.
- Library tests cover persistent grid/list views, editor close and failed-save retention, close/switch races, pending autosaves before deletion, cancellation after a failed deletion, cloud TXT removal, workspace isolation and focus restoration. The original Mac CI exposed a case-only rename deleting its own cloud TXT; the filesystem-identity fix includes distinct-hard-link protection.
- The actual Claude Code CLI reviewed the controls, speech path, native workers, packaging and library changes, including a focused speech follow-up. Confirmed findings were reproduced and addressed with regressions. Review metadata remains private.
- Final Windows Setup and portable artifacts were built. Setup SHA-256: `64af675e0488a9bd36b535d219861c71631d5c78f1fd68e0a385b98d8cd049e7`; portable SHA-256: `b9fed38ae43980a665b4001ad5ae16167e2628c24e090f59be3413facc67c387`. The update manifest references only Setup, with verified size and SHA-512. The real updater passed isolated current-version detection, higher-version download, integrity, ready-state UI and active-take installation guard; the test installer was not executed.
- Final portable extraction, sample loading, bundled Whisper setup and clean shutdown passed. The public Whisper speech fixture reached position 12 with confidence 1.0, 35 audio-activity heartbeats and a one-word visual lead after about 7.9 seconds, with no renderer errors. No user microphone was recorded.
- Packaged Windows system speech successfully inventoried en-GB, started English, transcribed two public fixtures, rejected missing German support and recovered to English. App and owned helpers exited cleanly, without microphone capture or renderer errors. Fixture recognition was less accurate than Parakeet; this is not an accuracy or speed recommendation. Packaged Parakeet also advanced the public fixture with confidence 1.0 and no renderer errors.
- Native controller smoke tests passed while the fixture window was minimized and unfocused. Physical joystick presses, Elgato/VR combinations, Mac microphone permissions and real-device speech remain hardware acceptance checks. English screenshots were refreshed and inspected; automated accessibility checks passed at standard and narrow widths. The production npm audit reported zero vulnerabilities at verification time.
- [macOS CI passed on Apple Silicon and Intel](https://github.com/DSuzuki35/PRMTA/actions/runs/45011306731), including 235 tests with two Windows-only tests skipped, native Swift compilation, DMG/ZIP packaging, helper architecture checks, deep signature validation, usage descriptions and permission-free language inventory. These experimental artifacts are ad-hoc signed, not notarized, and still need real-device microphone/permission testing.
- GitHub detects the public repository's MIT License. The final Windows package includes `resources/LICENSE.prmta.txt`, byte-identical to the repository license. Third-party component/model notices remain separate.

## 0.3.1 update verification

- [Windows CI passed](https://github.com/DSuzuki35/PRMTA/actions/runs/44333901616) for source `7494f84`: production build, 124 unit/integration tests, two Python prerequisite tests and 42 Chromium workflows.
- Final Setup and portable artifacts were built for Windows x64. Portable extraction, sample loading, bundled one-button Whisper setup and clean shutdown passed. Setup SHA-256: `7af254bc6c61bcb0bf7b051487e14a22e362e19f6c2f787dc49fe445a7ae56c4`; portable SHA-256: `aef3a026bc58eae7a9007d1db924c73538d43c0fe4dcec58a1696bad9dd1cd16`.
- The real packaged updater passed current-version detection, a higher-version local download, SHA-512 validation, ready-state UI and the active-take installation guard. It used an isolated profile/cache and did not execute the test installer.
- Native Electron 45.3.3 testing exercised page navigation and a held scroll while the test window was minimized and unfocused. SDL enumerated a real USB device. Physical controller button presses were not tested. Unit coverage checks per-device open/read failures, bounded backoff, disconnects, assignment gating and foreground fallback only when native initialization cannot start.
- Managed Parakeet setup, cancellation/retry, failed-worker repair, CPU and DirectML transcription, processor reporting and owned-worker shutdown were tested. Downloads total 731,175,365 bytes. Short warmed English fixture chunks processed on the test PC in about 65 ms on CPU versus roughly 550 ms for Whisper Base; this excludes microphone collection and alignment and is not a total highlighting-latency guarantee.
- The final packaged app captured a public JFK fixture through its microphone pipeline, submitted 11 Parakeet chunks and 30 waveform activity updates, reached word position 10 with confidence 1.0 after about 6.6 seconds, and reported no renderer errors. A source-app run also observed a one-word waveform-gated visual lead. Native controller initialization was ready in the packaged app, verifying the shipped SDL module and DLL.
- Missing Microsoft C++ runtime errors are tested without changing system DLLs. A live module inspection confirmed the actual prerequisite; setup checks DLL loading after the small Python download and before model downloads. A completely clean Windows VM has not been exercised.
- The actual Claude Code CLI reviewed the change and a focused follow-up. The follow-up found no concrete controller regressions or release blockers after per-device isolation and safe foreground fallback were added. Review metadata remains private.
- English screenshots were refreshed and visually inspected. Automated accessibility checks passed for the standard screens. The production npm dependency audit reported zero vulnerabilities at verification time; this does not audit downloaded Python wheels or model weights.

## 0.3.0 update verification

- [Windows CI passed](https://github.com/DSuzuki35/PRMTA/actions/runs/44307130417) for release source `5645038`, including the production build, unit suite and all browser workflows.
- Final portable extraction, sample loading, bundled one-button Whisper setup and clean shutdown passed. The real packaged updater passed current-version discovery, a local higher-version download, SHA-512 validation, ready-state UI and refusal to install during an active take, using an isolated profile/cache and never executing the fixture installer. Setup SHA-256: `1c0f5917c947f56e9f5ad5b0c34e81d94a01e8e78f492afeffc4d51a7fa6eacf`; portable SHA-256: `daee05676ad95852c85373a0b55052a988f393e0ba5c4a3802217eb4138c7961`.
- Production build, 96 unit/integration tests and 37 Chromium workflows passed. The controller tests cover assignment/clearing, duplicate rejection, simultaneous inputs, sentence/paragraph/page navigation, release, blur, dialogs, Settings, disconnect and expiring input heartbeats.
- Motion checks cover studio/output synchronization, page-profile manual scrolling, forward and previously visited reverse rendering boundaries, and stopping the visible animation on release. Long-paragraph checks keep the current word rendered at boundary positions and in a 4K output.
- Updater tests cover automatic and deferred checks, retry/error states, explicit installation, unload veto and blocked playback during handoff. Browser tests verify that an unmounted editor's pending save delays installation, failed saves block it, and reopening/saving the draft allows retry.
- The actual Claude Code CLI reviewed the change and a focused follow-up. The follow-up reported no reproducible blockers. Native testing then caught a deferred ordinary-quit hang; completing normal shutdown with `app.exit` after service cleanup fixed it, while update handoff retains its separate `quitAndInstall` path. Native screenshot capture now closes successfully.
- Automated accessibility checks passed at 800 and 1440 pixels. English screenshots were refreshed and inspected. Production dependency audit reported zero vulnerabilities at verification time.
- Physical controllers remain untested. Reversing into an unseen virtual text window after a distant seek in a very long paragraph may reflow a line; ordinary forward and previously visited reverse boundaries are covered by motion tests. The updater download fixture does not execute an update installer or simulate a future production release.

## 0.2.5 update verification

- Windows CI passed for final source `c83c06d`. The final portable executable passed extraction, sample loading, bundled one-button voice setup and clean shutdown. SHA-256: `b3c6d4063aba010d3c8398ae88ec6060dafd21ebdb33b9786fec8607e674100f`.

- Production build, 68 unit/integration tests and 30 browser workflows passed. New tests cover current TXT publication, rename/delete/restore, external edits, name collisions, case-only Windows renames and unavailable folders.
- Migration tests verify local backups before removal, interrupted cleanup, preserving files changed since backup, conflict preflight and no repeated backup growth on retries. A private migration rehearsal against a copied existing revision folder produced one current script with unchanged text; the original folder was not modified by the rehearsal.
- A local write-ahead journal recovers interrupted renames without losing identity or notes. A conflicting interrupted draft becomes an exportable/restorable copy, while external edits and ordinary synchronization continue.
- Browser workflows verify separate libraries, explicit copy/open choices, confirmation before legacy upgrade, stale-workspace rejection, external changes discovered during a failed save, and exporting/restoring a recovered draft without replacing the external version.
- Expanded-editor tests verify window-sized geometry, no operating-system fullscreen, preserved text, inert background and Escape/focus restoration. Native English screenshots were inspected.
- Claude Code reviewed the change and two follow-ups. Its final focused review confirms the remaining recovery and repeated-backup issues were resolved without new blockers in those fixes. Corrupt shared metadata intentionally fails closed; it is not silently rebuilt at the expense of IDs or notes.

## 0.2.4 update verification

- Windows CI passed for release source `d0ae10f`. The final portable executable passed extraction, sample loading, one-button bundled voice setup, the real Base audio fixture and clean shutdown. SHA-256: `eb3caebad53db9a6673b3d7a31bf40d5e549a778fbb222560e8507e4faa3ef73`.

- TypeScript/production build, 56 unit/integration tests and 24 browser workflows passed. New coverage exercises waveform attack/release, steady room-noise adaptation, learned pace, stale audio, the two-word bound, correction and preserving correct predictions.
- Session tests keep confirmed progress separate from the preview and reject stale activity after a fresh match following navigation. Browser tests verify studio/output synchronization, no predicted read-text dimming, correction on mismatch, page boundaries and the per-profile opt-out.
- The real bundled Base audio fixture reached position 10 with confidence 1.0 after 7.9 seconds, observed 34 activity heartbeats and a one-word visual lead, with no renderer errors. This demonstrates the waveform-to-preview path; it is not a per-word latency guarantee or a noisy-room recognition benchmark.
- The actual Claude Code CLI reviewed the implementation and follow-up fixes. The follow-up found no blockers or regressions. The code and tests address unnecessary rewinds on correct predictions, stable background noise and vacuous assertions. Private review metadata remains outside the repository.
- Updated native screenshots, including the Reading area controls, were inspected. Automated accessibility and long-script rendering regressions remain passing. Energy-based voice gating is deliberately bounded and is not a semantic speech detector.

## 0.2.3 update verification

- Production build, 48 unit/integration tests and 22 browser workflows passed for the UI pass and voice continuity guard. The 0.2.3 portable passed extraction, sample loading, bundled voice setup and clean shutdown. SHA-256: `ebfd777037a7a1dcda390c0e252c114114f365c0218cc07dfa1151a10d586963`.
- Axe reported no tagged WCAG A/AA violations in the four standard screens at 1440 and 800 pixels wide, and in the Help dialog. This is an automated check of those states, not full conformance certification or screen-reader user testing.
- Keyboard tests cover switch activation/focus, spacing, modal Tab containment, Escape/opener restoration and preventing arrow shortcuts from moving playback inside a dialog.
- A regression reproduced a three-word phrase jumping from position 0 to 43 before the fix. Distant and chained accidental matches now hold; nearby variations and deliberate seek/resume are covered.
- The real Base audio fixture reached position 12 with confidence 1.0 after 7.9 seconds, with no renderer errors. This confirms ordinary voice progression still works, not a per-word latency guarantee.
- Native screenshots were refreshed and inspected. Focus-ring contrast against the panel is 7.04:1, control borders 3.87:1 and inactive switch borders 5.27:1. Claude Code found no release blockers in the reviewed UI and alignment changes.

## 0.2.2 update verification

- Production build, 42 unit/integration tests and 18 Chromium workflows passed locally and in Windows CI. The portable 0.2.2 executable passed extraction, sample loading, bundled voice setup and clean shutdown. SHA-256: `699d143caa00f4e21489ba3b815b58a8cc1327ddbdaf6747079be418935f4cf5`.
- New regressions cover whole-sentence packing, clause fallback in overlong sentences, decimal separators, quotations, unpunctuated passages and explicit page breaks.
- Browser tests verify preserved ending punctuation, a one-line muted next-page preview, profile synchronization, and hiding the preview on the final page.
- A native Electron screenshot of the page preview was rendered and inspected. Claude Code found no hard blockers; its observations about single-letter sentence endings, clock times and preferring sentence endings before long clauses were addressed with regression tests.

## 0.2.1 update verification

- TypeScript and production build passed. 35 unit/integration tests and 17 browser workflows cover the updated controls and renderer.
- The font regression test failed on the old renderer (increasing the setting reduced the rendered font from about 17 px to 9 px) and passes after the fix. Additional checks confirm exact 24/48/96 px sizing for short pages and sufficient rendered text at a 3840 × 2160 browser viewport.
- A 3,000-word navigation fixture produced no observed renderer tasks of 50 ms or longer during the local test. This measures the browser main thread; it does not prove absence of driver-level or whole-system stalls on every machine.
- Continuous rendering uses a viewport-sized window, with a 512-word minimum. Animation frames stop when the text settles. Loading another script resets the actual visible transform.
- Fake microphone audio verified the live meter and responsive 500 ms request cadence, bounded windows, one request at a time, and no inference while paused. Unit coverage rejects stale transcripts after navigation from another controller.
- Simulated gamepad assignment verifies release → press → release, ignores held inputs and disconnects, and rejects duplicate assignments. Physical gamepads remain untested.
- `node scripts/clipboard-smoke.mjs` clicked Copy link in native Electron and compared the Windows clipboard with the output URL. The pre-test clipboard was restored without logging its contents.
- The real local Base speech fixture reached position 10 with confidence 1.0 after 7.9 seconds of playback, with no renderer errors (`node scripts/voice-runtime-smoke.mjs`). This is a fixture-progress result, not a per-word latency guarantee.
- Updated English studio and Settings screenshots were inspected. The final 0.2.1 portable executable passed extraction, sample loading, one-button bundled voice setup and clean shutdown. SHA-256: `18751cc6cf4fc70ad3b874f501ef07768cef1db989519be9e1329ef162ceceab`.
- The actual Claude Code CLI reviewed these changes. Follow-up fixes include demand-driven animation, viewport capacity, transport revision checks, microphone startup generation guards, wheel thresholds, and assignment safeguards. The follow-up review found no blockers in the scoped fixes; its StrictMode cleanup observation was also applied. Review reports remain local because they include session metadata.

## 0.2.0 baseline verification


Verified on Windows x64, 17 November 2026. Source checks use Node 24; the Windows app uses Electron 45.3.3 / Node 24.22.3.

## Executed checks

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed (`npm run build`). |
| Unit/integration suite | 30 tests passed across 7 files (`npm test`). |
| Chromium workflows | 8 tests passed (`npm run test:e2e`). |
| Native Electron smoke | Sample loaded, monitor enumeration succeeded, no renderer errors, clean process exit. |
| Packaged Windows smoke | Unpacked PRMTA executable started, loaded the sample, enumerated the display, and started its bundled Whisper server successfully. |
| Portable distribution | Extraction, sample script, one-button bundled voice setup and clean shutdown passed (`node scripts/portable-smoke.mjs`). |
| Real model lifecycle | Base started; Tiny downloaded from the official artifact source and passed SHA-256/size checks; switched to Tiny, then back to Base. |
| Real speech fixture | Fake Chromium microphone played the JFK WAV fixture through local Whisper; voice alignment reached word position 14, confidence 1.0, with no renderer errors. |
| Draft close/relaunch | Closed a native window with an unfinished empty title; reopened the same profile and recovered the unsaved text. |
| Visual QA | Five native app screenshots reviewed; access links and local data paths masked. |
| Production dependency audit | `npm audit --omit=dev` reported zero vulnerabilities at verification time. Development tooling has separate advisories and is not covered by this result. |

Browser coverage includes lossless multilingual TXT import/export, editing and reload, pinned output, blackout, trash restore, draft recovery, external revisions, vertical mirroring, voice-driven page changes, keyboard and simulated gamepad navigation, VR transparency, restoring font size after page mode, the model-label layout at 800 and 1600 px widths, and one-button voice setup with download progress.

Core coverage includes stale-write rejection, cloud branches/collisions/invalid chains, revision history, timing/looping/matching, a 12,000-revision graph, cached-list invalidation across connections, cached token matching, malformed drafts, model allowlisting and corrupted/truncated download rejection. The initial full-file 12,000-revision stress check passed locally but exceeded the hosted Windows runner's time budget. The CI regression now tests the same deep graph and a deep cycle in memory; file transport remains covered by separate integration fixtures. This changes test construction, not application behavior.

## Claude Code review and optimization

The actual local Claude Code CLI was used, authenticated through its existing session. The initial configured model was unavailable due to usage credits; the Sonnet selection succeeded. The CLI reported `claude-sonnet-5-5` for the completed reviews.

1. A read-only baseline review identified rendering, library, alignment, draft and lifecycle improvements.
2. Claude Code directly implemented cached library lists, indexed single-script access, cached transcript tokenization, iterative revision validation and regression tests in a restricted set of files. The main implementation process inspected and executed those changes.
3. A second read-only review found a dirty-editor close blocker, retained page-fit font size, and model-download/process edge cases.
4. The fixes were applied and checked. Claude's closing review reported no outstanding reproducible release blockers in the reviewed scope. It did not execute tests; the executed results above came from the main implementation process.

Review logs are intentionally not published because they contain local session/account metadata. This is a code review, not a security certification.

## Known limits and untested hardware

- Native monitor enumeration was tested on the available Windows display. An actual Elgato Prompter was not attached during verification.
- VR output transparency and web integration were tested in Chromium; no physical headset/OpenXR runtime was used. This is OpenKneeboard web output, not a standalone OpenXR API layer.
- Gamepad input was simulated through the browser API. Physical joysticks, foot pedals and presenter models need device-specific testing.
- Cloud revision logic was tested against local folders. Dropbox, OneDrive and iCloud client transport and conflict delivery were not exercised end to end.
- Base and Tiny were started locally. Small/Small Q5/Turbo Q5 catalog metadata is pinned, but runtime latency and recognition quality for those models were not benchmarked here.
- The audio test used a known recording, not the user's live microphone, accent, room or headset. Voice matching is tolerant nearby alignment, not arbitrary semantic paraphrase understanding.
- Very large revision folders still use synchronous scans. Draft backups remain origin-scoped when the studio port changes. After a forced crash, an orphaned Whisper process may need to be closed manually. These are documented limitations.
- Windows executables are unsigned. Automatic updates require the installed NSIS build introduced in 0.3.0; portable builds use manual downloads.

## Reproduce

See [architecture and development](ARCHITECTURE.md) for the main commands. Additional native checks:

```powershell
node scripts/draft-close-smoke.mjs
node scripts/model-smoke.mjs
node scripts/updater-runtime-smoke.mjs release/0.3.0/win-unpacked/PRMTA.exe release/0.3.0/PRMTA-Setup-0.3.0-x64.exe
$env:PRMTA_EXE = "$PWD\release\win-unpacked\PRMTA.exe"
$env:PRMTA_CHECK_WHISPER = '1'
node scripts/electron-smoke.mjs
Remove-Item Env:PRMTA_EXE
Remove-Item Env:PRMTA_CHECK_WHISPER
```

The model smoke downloads Tiny into an isolated temporary profile and removes it after the check. For `scripts/voice-smoke.ts`, place the official whisper.cpp `samples/jfk.wav` fixture at `.tools/whisper/jfk.wav` and run the local server first. All tests use temporary script libraries; they do not modify a production cloud folder.

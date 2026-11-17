# Release verification — PRMTA

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
- The portable executable is unsigned. No auto-update service is included.

## Reproduce

See [architecture and development](ARCHITECTURE.md) for the main commands. Additional native checks:

```powershell
node scripts/draft-close-smoke.mjs
node scripts/model-smoke.mjs
$env:PRMTA_EXE = "$PWD\release\win-unpacked\PRMTA.exe"
$env:PRMTA_CHECK_WHISPER = '1'
node scripts/electron-smoke.mjs
Remove-Item Env:PRMTA_EXE
Remove-Item Env:PRMTA_CHECK_WHISPER
```

The model smoke downloads Tiny into an isolated temporary profile and removes it after the check. For `scripts/voice-smoke.ts`, place the official whisper.cpp `samples/jfk.wav` fixture at `.tools/whisper/jfk.wav` and run the local server first. All tests use temporary script libraries; they do not modify a production cloud folder.

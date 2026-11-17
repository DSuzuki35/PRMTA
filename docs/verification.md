# Release verification — PRMTA 0.2.0

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

Core coverage includes stale-write rejection, cloud branches/collisions/invalid chains, revision history, timing/looping/matching, a 12,000-revision graph, cached-list invalidation across connections, cached token matching, malformed drafts, model allowlisting and corrupted/truncated download rejection. The large-chain test creates temporary files and can take tens of seconds on Windows.

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

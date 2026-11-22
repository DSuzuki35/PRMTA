# PRMTA

**Your words. Your pace.** A local-first teleprompter studio for Windows, external displays, browsers and VR.

[Download Windows Setup](https://github.com/DSuzuki35/PRMTA/releases/latest) · [User guide](docs/USER-GUIDE.md) · [Voice & models](docs/VOICE.md) · [macOS preparation](docs/MACOS.md) · [Development](docs/ARCHITECTURE.md)

![PRMTA studio](docs/images/studio.png)

## What it does

- **External displays:** dedicated fullscreen output on any Windows monitor, including Elgato Prompter.
- **Browser and OBS:** clean, synchronized output with adjustable background opacity and mirroring.
- **VR:** transparent OpenKneeboard Web Dashboard output with an independent appearance profile.
- **Local voice follow:** bundled multilingual Whisper Base, optional NVIDIA Parakeet TDT v3 and Windows system speech, forgiving nearby script alignment and waveform-gated predictive word highlighting. The experimental Mac build uses Apple on-device speech. Whisper also offers Tiny, Small, quantized Small and quantized Large v3 Turbo models.
- **Your pace:** timed WPM scrolling, voice following or manual navigation; continuous reading-line and page-by-page layouts, optional smooth line transitions and wheel navigation.
- **Script library:** grid and list views, delete directly from the overview, a closable and expandable editor, UTF-8 TXT revisions, SQLite indexing, folders, tags, favorites, search, autosave, draft recovery, local version history and reversible local trash.
- **Cloud libraries:** one current, readable TXT per script in a Dropbox, OneDrive or iCloud Drive folder. Edits and deletions work both ways; choose whether to copy current scripts when switching libraries.
- **Control options:** eight assignable gamepad/joystick actions for pages, paragraphs, sentences and smooth held scrolling. Native Windows controller input works while another app is focused or PRMTA is minimized, with an option to keep voice following active. Keyboard shortcuts, keyboard foot pedals and a private-LAN phone remote are also available.
- **Windows updates:** the installed app checks for new releases and downloads updates in the background. Restart and install when your take is finished.
- **Custom controls:** assign keyboard shortcuts for playback, pages, paragraphs, sentences, chapters, held scrolling and more. Optional voice commands such as “prompta, next sentence” work while the microphone is on, including during pauses.
- **English interface:** designed with the [Dan Suzuki UI Kit](https://dansuzuki.com/ui-kit/), with locally bundled fonts. Script content can remain in its original language.

## Get started

1. Download the **Windows x64 Setup** installer from [Releases](https://github.com/DSuzuki35/PRMTA/releases/latest).
2. Install and open PRMTA, then choose **Try a sample** or **Create script**.
3. Press **Play**. For voice following, click **Enable voice** above the preview, then Play.
4. In **Outputs**, choose an external monitor, copy a browser link or add the VR link to OpenKneeboard.

Both Windows x64 downloads include the local CPU speech engine and Base model. The **Setup installer** enables automatic updates; a **portable executable** is also available for manual updates and extracts at launch. Existing portable users can install PRMTA to keep their current profile and enable automatic updates. No account or API key is required. The executables are not code-signed. Persistent scripts and preferences live in the Windows application profile, not next to the executable.

| Download | Choose this when |
| --- | --- |
| **PRMTA-Setup-0.4.0-x64.exe** | Recommended: install PRMTA, create shortcuts and receive automatic updates. |
| **PRMTA-Portable-0.4.0-x64.exe** | Run without installation and download updates manually. |

macOS 13+ packaging and Apple speech are prepared for Apple Silicon and Intel. See the [Mac build and testing guide](docs/MACOS.md); microphone permissions and real-device behavior still need a Mac test.

PRMTA 0.2.0 preserves the existing PRMPT 0.1 profile when available. Version 0.2.5 converts old cloud revision folders to current TXT files after verifying a local backup. Use 0.2.5 or newer with converted cloud folders.

## Write naturally

```text
Welcome to ==PRMTA==.

This is **important**. Take a breath.

---

A new page, a new thought.
```

Import TXT, Markdown or DOCX. Export plain UTF-8 TXT. `---` (or `\---`) on its own line starts a new page. Select **Continuous at reading line** to keep the current word at your chosen position, or **Page by page** to advance complete pages. Voice follow works with both.

![The library and editor](docs/images/library.png)

## Choose a speech model

Start with **Base** for low overhead. Try **Small Q5** when you need more accurate multilingual recognition, or **Large v3 Turbo Q5** on more powerful hardware. Bigger models can add too much latency on CPU. Model file size is not a promise about runtime speed or memory use.

Optional models install from Settings with progress and SHA-256 verification. A compatible external whisper.cpp server can use other models or GPU acceleration. Browser speech recognition is also offered, but depends on the browser and may use an online service. Read the [voice guide](docs/VOICE.md) for setup, tradeoffs and the exact endpoint contract.

For **Parakeet**, open **Settings > Voice follow > Speech recognition**, select **NVIDIA Parakeet · local**, and click **Set up Parakeet**. Setup downloads about 731 MB of verified model and private runtime files; no separate Python installation or terminal commands are needed. CPU processing is recommended; optional DirectML GPU processing is available. Parakeet automatically detects 25 supported languages, including English and German. New profiles default to English for Whisper and browser recognition; saved language choices are preserved. See the [Parakeet setup guide](docs/VOICE.md#nvidia-parakeet-optional).

## Documentation

| Guide | Contents |
| --- | --- |
| [User guide](docs/USER-GUIDE.md) | Editing, formatting, displays, OBS, OpenKneeboard, shortcuts, controllers, remote and cloud folders. |
| [Voice & models](docs/VOICE.md) | Model choices, local recognition, downloads, external servers and troubleshooting. |
| [macOS preparation](docs/MACOS.md) | Apple speech, Apple Silicon/Intel builds, signing and the Mac testing checklist. |
| [Architecture & development](docs/ARCHITECTURE.md) | Components, storage format, compatibility, security boundaries, build and test commands. |
| [Verification](docs/verification.md) | Release checks, Claude Code review, and what still requires physical hardware testing. |
| [Changelog](CHANGELOG.md) | Release changes. |

## Build from source

Windows x64, Node.js 24 LTS, npm:

```powershell
npm ci
npx playwright install chromium
npm run build
npm test
npm run test:e2e
npm run dev
```

For speech and a distributable build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-whisper.ps1
npm run package
npx electron-builder --win nsis portable --x64 --publish never
```

`npm run serve` starts the browser studio after a build. Managed Parakeet setup, model downloads, background controller input and native display selection are desktop features; configure an external local Whisper server for the standalone browser host.

## Scope and privacy

PRMTA keeps scripts and local speech recognition on your computer. Cloud-folder contents are uploaded by the cloud client you choose. Optional Whisper models use the official whisper.cpp model repository. Parakeet setup downloads pinned model and runtime files from Hugging Face, Python.org and PyPI, verifies their size and SHA-256, and runs locally afterward. LAN sharing is opt-in and intended for trusted private networks; output and remote links are access credentials.

This release uses OpenKneeboard for VR rather than shipping a native OpenXR layer. It does not integrate Wispr Flow or promise semantic paraphrase tracking. Whisper's included engine uses CPU; Parakeet's optional runtime offers CPU or DirectML. Physical Elgato/VR/controller combinations require testing on your hardware. See [verification](docs/verification.md).

The source is public for inspection. No general open-source license has been assigned to PRMTA itself. Third-party components retain their own licenses; see [third-party notices](THIRD-PARTY-NOTICES.md) and [licenses](licenses).

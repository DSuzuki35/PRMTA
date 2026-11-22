# PRMTA on macOS

The macOS build is experimental. Apple Silicon and Intel DMG/ZIP packages have been built in CI, including Swift compilation, helper architecture, ad-hoc signature validation, permission descriptions and native language inventory. Permission dialogs, microphone behavior, recognition accuracy and interactive packaged app launch still need verification on a real Mac. See the [macOS build workflow](https://github.com/DSuzuki35/PRMTA/actions/workflows/macos.yml) for temporary experimental artifacts. Successful CI packaging does not verify microphone behavior.

PRMTA's Electron 45 application requires **macOS 13 Ventura or later**, on Apple silicon (`arm64`) or Intel (`x64`). The speech helper itself targets macOS 12, but that does not lower the application's requirement. [Electron 44 removed macOS 12 support](https://www.electronjs.org/blog/electron-44-0).

## Build and launch on your MacBook

Install Node.js 24 and Xcode command line tools (`xcode-select --install`), then open Terminal in the repository:

```sh
npm ci
node scripts/build-macos-speech.mjs
npm run build
npm start
```

The helper command defaults to your Node process architecture. Use native arm64 Node on Apple silicon; using Intel Node through Rosetta creates an Intel build. For development with live frontend reload, run `npm run dev` after compiling the helper.

Open Settings, select the system/native speech provider and English or German, then connect the microphone. macOS may request Microphone and Speech Recognition permissions at this point. Merely checking native speech status does not request speech permission. If permission was denied, review PRMTA in System Settings > Privacy & Security > Microphone and Speech Recognition, then restart the app. During development, the permission owner may appear as Electron or the helper rather than PRMTA; verify again with the packaged application.

## Native offline speech

The Apple helper uses `SFSpeechRecognizer` only when `supportsOnDeviceRecognition` is true and sets `requiresOnDeviceRecognition = true` for every request. It never falls back to Apple's network recognition. WAV chunks and recognition text travel through private process pipes; the helper keeps audio in memory and does not create recording files. It does not open a microphone itself; the app supplies the audio.

The language inventory is the set of Apple locales reporting on-device support. Availability can vary by OS, hardware, and installed language assets. `auto` selects an installed English recognizer, preferring `en-US`; it is not spoken-language detection. German must be selected explicitly and never silently falls back to English.

If the requested language is unavailable, enable/download that language's Dictation support in System Settings > Keyboard > Dictation, allow any system download to finish, then restart PRMTA. The capability check remains authoritative: enabling Dictation alone is not proof that Apple provides on-device recognition for that language and Mac. No recognition begins if offline support or permission is missing. [Apple documents the on-device capability requirement](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition).

The current Windows Whisper bundle and managed Windows Parakeet runtime are not included in Mac packages. Windows SDL background controller input is also excluded; use the foreground browser controller input available in the app.

## Build DMG and ZIP packages

On macOS:

```sh
npm run build
npx electron-builder --config build/electron-builder.mac.cjs --mac --arm64 --x64 --publish never
```

Use just `--arm64` or `--x64` to build one architecture. Each packaging pass compiles the matching Swift helper and copies it to `PRMTA.app/Contents/Resources/system-speech/prmta-speech`. Packages are written to `release-macos/`; architecture is included in each filename. Both DMG and ZIP are produced. The application identifier stays `studio.prmpt.app`.

By default packages are **ad-hoc signed, not Developer ID signed or notarized**. They are development artifacts and may be blocked by Gatekeeper on another Mac. Build from source locally for testing, or use a properly signed and notarized distribution. Do not disable system security globally. Hardened Runtime is disabled for these ad-hoc application builds to avoid Electron framework library-validation failures.

The manual GitHub Actions workflow **macOS experimental packages** builds each architecture on a matching runner: `macos-15` for arm64 and `macos-15-intel` for x64. It uploads temporary workflow artifacts and does not publish a GitHub release. It has read-only repository permissions and no signing secrets. These labels follow [GitHub's runner inventory](https://github.com/actions/runner-images#available-images); macOS 14 runners were retired in November 2026.

## Developer ID signing and notarization

For a distributable build, install a valid **Developer ID Application** certificate in the build Mac's keychain (or configure electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` securely). Configure notarization credentials through one supported environment-variable set, for example `APPLE_ID`, an app-specific `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Keep credentials out of the repository and shell history. Then run:

```sh
PRMTA_MAC_SIGNED=1 npx electron-builder --config build/electron-builder.mac.cjs --mac --arm64 --x64 --publish never
```

Signed mode requires a signing identity, enables Hardened Runtime, and enables electron-builder notarization. The helper is explicitly listed among additional binaries for signing, so its initial ad-hoc signature is replaced together with the rest of the application. The app and child entitlement files include V8 JIT, microphone audio input, and speech recognition. This is a standard macOS distribution build, not a Mac App Store sandbox build. Both the application Info.plist and embedded helper Info.plist provide the speech usage description; Apple requires that description even when recognition is offline.

Verify the final application signature, notarization ticket, and Gatekeeper assessment before distribution:

```sh
codesign --verify --deep --strict --verbose=2 /path/to/PRMTA.app
xcrun stapler validate /path/to/PRMTA.app
spctl --assess --type execute --verbose=2 /path/to/PRMTA.app
```

If notarization credentials are missing or notarization was skipped, do not describe the build as notarized. Consult [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Electron's default macOS entitlements](https://github.com/electron/osx-sign/blob/main/entitlements/default.darwin.plist), [electron-builder 26 macOS options](https://www.electron.build/v26/docs/mac/), and [Apple's speech permission guidance](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition).

## Real-Mac acceptance checklist

The shared defaults use Ctrl + arrow keys for sentence and paragraph navigation. macOS Mission Control may intercept these combinations. Reassign them in **Settings > Keyboard shortcuts** to keys that are free on your Mac; PRMTA shortcuts require the app to be focused.

- Build and launch the native architecture; verify the helper is executable and the packaged app opens from Applications.
- Open Settings before connecting audio: no Speech Recognition permission prompt should appear just for status.
- Connect the microphone and exercise allow, deny, and later re-enable paths for both privacy permissions.
- Check English and German availability; a missing language must produce an actionable error without switching languages or using network recognition.
- With required language assets already installed, disconnect network access and verify script following and voice commands still work.
- Verify ordinary narration does not trigger commands; test wake phrase, pause/resume, scrolling, and text repetition with a real microphone.
- Disconnect/reconnect repeatedly, change language while idle, close the window/app during recognition, and check for orphaned `prmta-speech` processes.
- Check multiple displays, fullscreen output, foreground controller input, keyboard shortcuts, and remote browser output.
- Repeat launch, permissions, offline recognition, and signature checks on a separate Mac for each distributed architecture.

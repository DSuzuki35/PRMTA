# Voice following and model selection

PRMTA separates speech recognition from script following. Whisper turns short microphone windows into text. A bounded fuzzy alignment matches that text to nearby words in the script. Small omissions, fillers and slightly different wording are tolerated; arbitrary paraphrasing and large jumps are not guaranteed. At least three usable recognized words are required before matching advances.

Recognition is local when using the default Whisper provider. The microphone is resampled to 16 kHz mono WAV and sent over loopback HTTP to whisper.cpp. The default **Responsive** setting keeps approximately three seconds of overlapping audio and checks every 500 ms after the first second of speech. **Steady** uses five seconds and a 1,000 ms check interval. Only one inference request runs at a time; slow inference does not queue additional work. Silence is gated. Pausing a take stops inference and clears buffered speech; resuming or loading a script starts with fresh audio. Actual highlight latency includes model processing time and the words needed for a confident match. The timeout for one inference is 20 seconds.

## Included and downloadable models

The Windows release includes multilingual **Base** and the whisper.cpp CPU server. Additional models download only when requested in Settings, into the application profile's `models` folder. Files are installed after exact size and SHA-256 verification. A failed download can be retried; automatic resume is not implemented.

| Model | Download | Intended use |
| --- | ---: | --- |
| Tiny | 74 MiB | Lower latency on modest hardware, with reduced accuracy. |
| Base | 141 MiB | Included starting point for responsive local voice following. |
| Small Q5 | 181 MiB | Compact multilingual accuracy upgrade. |
| Small | 465 MiB | Full Small model; more storage and compute. |
| Large v3 Turbo Q5 | 547 MiB | Higher-capacity recognition; powerful hardware recommended. |

These are model file sizes, not RAM requirements. Q5 means quantized weights: a smaller file and memory footprint, with possible accuracy differences. It does not guarantee faster inference on every CPU. Larger models can be too slow for this application's short recognition cadence. Try Base first, then Small Q5 if pronunciation or background noise needs better recognition. Test latency on your own hardware before recording.

![Model selection and installation](images/models.png)

Select a model, download it if needed, then turn the microphone off and back on. PRMTA restarts only the server process it owns. It never kills an independently started server. If another server occupies port 8080, its model is controlled externally. A request to apply a different managed model reports that conflict instead of silently pretending to switch.

For a guided setup, click **Set up voice** in Settings. It downloads the selected model when necessary, shows progress, verifies it and starts the included engine. When the button says **Voice ready**, enable the microphone in the studio and press Play. No terminal commands are needed in the Windows app. The commands below are only for developers running a source checkout.

After a forced app termination or system crash, an orphaned `whisper-server.exe` may remain. Close that process in Task Manager before requesting a managed model change. Normal shutdown stops the owned process and waits for model download cleanup.

The catalog uses fixed filenames and verified hashes from the [whisper.cpp model distribution](https://huggingface.co/ggerganov/whisper.cpp/tree/main). English-only `.en` variants, Medium, full Large v3, and full Turbo can be used with your own compatible whisper.cpp server. `.en` models are for English scripts, not German. OpenAI describes Turbo as an optimized Large v3 model; published speed comparisons should not be interpreted as a guarantee for the bundled CPU server. See [OpenAI's model table](https://github.com/openai/whisper#available-models-and-languages) and [whisper.cpp models](https://github.com/ggml-org/whisper.cpp/tree/master/models).

Other engines such as faster-whisper can be useful, particularly with a GPU, but their native Python API is not interchangeable with PRMTA's HTTP endpoint. An adapter must implement the contract below. Distilled models require careful compatibility and quality testing; PRMTA does not claim support for every Whisper derivative.

## External server contract

Set a local HTTP URL in Settings. Allowed hostnames are `127.0.0.1`, `localhost`, and `[::1]`. Remote cloud inference endpoints and URL credentials are rejected.

- `GET /health` returns HTTP 200 and JSON `{ "status": "ok" }`.
- `POST /inference` accepts multipart form data: `file` (WAV), `response_format=json`, `language=de|en|auto`, and `temperature=0`.
- The response contains a string `text` field.

For a source checkout on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-whisper.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-whisper.ps1
```

The setup script downloads pinned whisper.cpp v1.9.2 binaries and multilingual Base. The packaged app already includes these and starts its owned server when the microphone is enabled. The bundled binary uses CPU inference; GPU acceleration is an external-server setup, not a switch in PRMTA.

## Practical recording workflow

1. Choose the correct input device and script language. Click **Test microphone** for a live dBFS meter, peak hold and clipping indicator, then stop the test. Automatic detection may be less stable on very short chunks.
2. Use headphones when playing other audio; keep background speech away from the mic.
3. Start near the passage you intend to read, click **Enable voice** above the preview (or select **Voice**), then Play.
4. Give the recognizer a few words. Watch the recognized transcript and highlighted word.
5. If you skip a large section, click the new passage or use page navigation. If you go off script, PRMTA should wait rather than scroll blindly.
6. If a microphone is unplugged, reconnect it and turn capture on again. Permission errors are shown in the studio.

Browser speech recognition is optional and browser-dependent. It may use an online service and may be unavailable in Electron. Its Automatic language option currently uses German. The local Whisper provider is the supported desktop default. PRMTA does not currently integrate the proprietary Wispr Flow application.

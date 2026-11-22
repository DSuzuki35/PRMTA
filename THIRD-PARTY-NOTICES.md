# Third-party notices

PRMTA's own source code is licensed under the MIT License in `LICENSE` (also shipped as `resources/LICENSE.prmta.txt`). The following third-party components and model weights retain their original licenses and attribution.

## Bundled speech engine and model

The Windows distribution includes whisper.cpp v1.9.2 (https://github.com/ggml-org/whisper.cpp) and the multilingual Whisper base model from OpenAI, converted by whisper.cpp (https://huggingface.co/ggerganov/whisper.cpp).

whisper.cpp: Copyright (c) 2023-2026 The ggml authors. Whisper: Copyright (c) 2022 OpenAI. Both are provided under the MIT license. Original license files are included alongside this notice in the source repository's licenses folder and the packaged application.

The remaining third-party dependencies retain their individual copyright notices and licenses in the packaged node_modules tree. Electron's Chromium and other third-party notices are shipped as LICENSE.electron.txt and LICENSES.chromium.html.

## MIT license

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Fonts and visual design

Inter, Archivo and DM Mono are bundled under the SIL Open Font License 1.1. Exact font license files are included in licenses/Inter-OFL.txt, licenses/Archivo-OFL.txt and licenses/DM-Mono-OFL.txt. Visual styling follows the Dan Suzuki UI Kit (https://dansuzuki.com/ui-kit/). The implementation and screenshots are PRMTA-specific.

## Native Windows controller input

The Windows app includes @kmamal/sdl 0.11.13 (MIT license, https://github.com/kmamal/node-sdl) and SDL 2.32.8 (zlib license, https://github.com/libsdl-org/SDL). Their original license texts are included in licenses/kmamal-sdl-LICENSE.txt and licenses/SDL2-LICENSE.txt. SDL provides native gamepad and generic joystick input independently of browser focus.

## Optional Parakeet downloads

Parakeet setup is optional and downloads the following components into the user's private application profile. The model is **NVIDIA Parakeet TDT 0.6B v3**, by NVIDIA, provided under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). PRMTA uses the INT8 ONNX conversion published by **Ilya Stupakov**, converted and quantized from the original model. Sources and model documentation: [NVIDIA original](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [Ilya Stupakov's ONNX conversion](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx). PRMTA does not claim authorship of these model weights.

| Runtime component | License |
| --- | --- |
| Python 3.13.17 | Python Software Foundation license and included historical/component notices. |
| onnx-asr 0.12.0, copyright Ilya Stupakov | MIT. |
| ONNX Runtime DirectML package 1.24.4, copyright Microsoft Corporation | MIT; bundled components retain the notices distributed with the package. |
| NumPy 2.5.5 | BSD-3-Clause for NumPy; bundled components additionally include 0BSD, MIT, zlib, CC0 and other notices in the wheel. |
| FlatBuffers 25.12.19 | Apache License 2.0. |
| packaging 26.3 | Apache License 2.0 OR BSD-2-Clause. |
| Protocol Buffers 7.36.2 | BSD-3-Clause. |
| SymPy 1.14.0 | BSD. |
| mpmath 1.3.0 | BSD. |

The exact artifact versions, URLs and SHA-256 hashes are recorded in `shared/parakeet-manifest.json`. Original Python licenses, wheel license files and ONNX Runtime's `ThirdPartyNotices.txt` remain in the managed runtime and downloaded wheel archives. These notices summarize attribution; the original component license texts remain authoritative.

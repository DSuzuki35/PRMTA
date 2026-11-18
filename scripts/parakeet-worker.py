"""Persistent local-only Parakeet worker. Audio lives in RAM and private pipes."""
import base64
import io
import json
import os
import pathlib
import runpy
import sys
import time
import wave

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def main():
    runtime = runpy.run_path(str(pathlib.Path(__file__).with_name("parakeet-runtime.py")))
    np, ort, onnx_asr, dll_handles = runtime["load_modules"]()

    ort.disable_telemetry_events()

    root = pathlib.Path(sys.argv[1]).resolve()
    acceleration = sys.argv[2] if len(sys.argv) > 2 else "cpu"
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.enable_mem_pattern = acceleration != "directml"
    requested = "DmlExecutionProvider" if acceleration == "directml" else "CPUExecutionProvider"
    providers = [requested, "CPUExecutionProvider"] if requested != "CPUExecutionProvider" else [requested]
    if requested not in ort.get_available_providers():
        providers = ["CPUExecutionProvider"]
    # All model files must already exist. The runtime is intentionally shipped
    # without huggingface-hub, and can never silently download missing weights.
    def load(selected):
        return onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", root, quantization="int8", providers=selected, sess_options=options)
    try:
        model = load(providers)
    except Exception:
        if requested == "CPUExecutionProvider":
            raise
        model = load(["CPUExecutionProvider"])
    actual = model.asr._encoder.get_providers()[0]
    # Warm common chunk shapes before declaring readiness (especially DirectML).
    for seconds in (2.2, 4.0):
        model.recognize(np.zeros(int(16000 * seconds), dtype=np.float32), sample_rate=16000)
    emit({"type": "ready", "provider": actual})
    while True:
        line = sys.stdin.buffer.readline(1_400_001)
        if not line:
            return
        if len(line) > 1_400_000:
            raise ValueError("Audio request is too large")
        request = json.loads(line)
        request_id = request.get("id")
        try:
            audio = base64.b64decode(request["wav"], validate=True)
            with wave.open(io.BytesIO(audio), "rb") as stream:
                if stream.getnchannels() != 1 or stream.getframerate() != 16000 or stream.getsampwidth() != 2 or not 0 < stream.getnframes() <= 400000:
                    raise ValueError("Expected at most 25 seconds of mono PCM16 audio at 16000 Hz")
                samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2").astype(np.float32) / 32768
            start = time.perf_counter()
            text = model.recognize(samples, sample_rate=16000)
            emit({"id": request_id, "text": text, "ms": round((time.perf_counter() - start) * 1000, 2)})
        except Exception as error:
            emit({"id": request_id, "error": str(error)[:2000]})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "fatal", "error": str(error)[:2000]})
        sys.exit(1)

"""Check Windows runtime prerequisites without relying on registry entries."""
import ctypes
import os
import pathlib
import sys

HELP = (
    "Parakeet requires the Microsoft Visual C++ x64 runtime. "
    "Install or repair the latest Microsoft Visual C++ Redistributable from "
    "https://aka.ms/vc14/vc_redist.x64.exe, then retry Parakeet setup."
)


def prepare_runtime():
    local = pathlib.Path(sys.executable).resolve().parent
    system = pathlib.Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
    handles = []
    for name in ("msvcp140.dll", "msvcp140_1.dll"):
        # NumPy's renamed private msvcp DLL cannot satisfy these ORT imports.
        path = local / name if (local / name).is_file() else system / name
        try:
            handles.append(ctypes.WinDLL(str(path)))
        except OSError as error:
            raise RuntimeError(HELP + f" Windows could not load {name}.") from error
    return handles


def load_modules():
    handles = prepare_runtime()
    try:
        import numpy
        import onnxruntime
        import onnx_asr
    except (ImportError, OSError) as error:
        if "dll" in str(error).lower():
            raise RuntimeError(HELP + " " + str(error)) from error
        raise
    return numpy, onnxruntime, onnx_asr, handles


if __name__ == "__main__":
    try:
        load_modules() if "--verify" in sys.argv else prepare_runtime()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

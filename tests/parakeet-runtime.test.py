"""Run with Python; uses only the standard library and does not change DLLs."""
import pathlib
import runpy
import unittest
from unittest.mock import patch

runtime = runpy.run_path(str(pathlib.Path(__file__).parents[1] / "scripts" / "parakeet-runtime.py"))


class RuntimeCheck(unittest.TestCase):
    def test_missing_vc_runtime_has_actionable_official_help(self):
        with patch.object(runtime["ctypes"], "WinDLL", side_effect=OSError("missing"), create=True):
            with self.assertRaisesRegex(RuntimeError, "Microsoft Visual C\\+\\+.*https://aka.ms/vc14/vc_redist.x64.exe"):
                runtime["prepare_runtime"]()

    def test_loads_both_required_cpp_dlls(self):
        with patch.object(runtime["ctypes"], "WinDLL", return_value=object(), create=True) as loader:
            self.assertEqual(len(runtime["prepare_runtime"]()), 2)
            self.assertEqual([pathlib.Path(call.args[0]).name for call in loader.call_args_list], ["msvcp140.dll", "msvcp140_1.dll"])


if __name__ == "__main__":
    unittest.main()

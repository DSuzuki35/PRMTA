"""Install already checksum-verified wheels into PRMTA's private Python runtime.

No pip, package resolution, subprocesses, or network access is used here.
"""
import pathlib
import sys
import zipfile


def main():
    wheels = pathlib.Path(sys.argv[1]).resolve()
    runtime = pathlib.Path(sys.executable).resolve().parent
    target = runtime / "Lib" / "site-packages"
    target.mkdir(parents=True, exist_ok=True)
    for wheel in sorted(wheels.glob("*.whl")):
        with zipfile.ZipFile(wheel) as archive:
            for member in archive.infolist():
                destination = (target / member.filename).resolve()
                if not destination.is_relative_to(target):
                    raise ValueError("Unsafe wheel path")
            archive.extractall(target)
    (runtime / "python313._pth").write_text(
        "python313.zip\n.\nLib/site-packages\nimport site\n", encoding="utf-8"
    )
    print("Installed private Parakeet runtime", flush=True)


if __name__ == "__main__":
    main()

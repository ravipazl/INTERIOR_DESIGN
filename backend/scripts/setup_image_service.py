#!/usr/bin/env python3
"""
Set up the Python image-edit service (image-service/) in its own virtualenv.

WHAT THIS IS FOR
----------------
image-service/ is a FastAPI app that powers three things in the "Select an
object" screen that the browser cannot do on its own:

    remove object / fill   LaMa      (/api/inpaint, /api/inpaint_mask)
    background removal     rembg     (/api/bgremove)
    select by text         CLIPSeg   (/api/textseg)

Click-to-select is NOT one of them - that runs entirely in the browser via
public/sam.worker.js and keeps working whether or not this service exists.

ISOLATION
---------
Everything is installed into image-service/.venv. Nothing is installed globally
and no running app is touched, so this cannot affect the live Node backend or
frontend. If the install fails, the only thing left behind is that venv folder,
which is safe to delete.

USAGE
-----
    python scripts/setup_image_service.py            # create venv + install
    python scripts/setup_image_service.py --check    # report only, install nothing
    python scripts/setup_image_service.py --python "C:\\Python312\\python.exe"

After it finishes, start the service with the command it prints.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# This file lives at backend/scripts/, so the repo root is TWO levels up:
#   backend/scripts -> backend -> D:\INTERIOR_DESIGN
# parents[1] would land on backend/ and make SERVICE resolve to
# backend/backend/image-service, which does not exist.
REPO = Path(__file__).resolve().parents[2]
# Lives INSIDE backend/ on purpose: the browser never talks to it directly. The
# Node backend proxies /image-edit/* to it on 127.0.0.1, so the app presents ONE
# frontend and ONE backend. See backend/src/image-edit-proxy.js.
SERVICE = REPO / "backend" / "image-service"
VENV = SERVICE / ".venv"
REQUIREMENTS = SERVICE / "requirements-pazl.txt"

# Installed separately, deliberately. Its package metadata wrongly caps
# numpy<2.0, which conflicts with opencv and torch (both need numpy>=2). It runs
# fine on numpy 2.x, so it goes in with --no-deps; every real dependency it has
# is already covered by requirements-pazl.txt.
NO_DEPS_PACKAGE = "simple-lama-inpainting==0.1.2"

# The ML wheels here (torch, opencv, sam2, transformers) are pinned to exact
# versions. Wheels for a brand-new Python often do not exist yet, and pip then
# falls back to building from source, which fails without a compiler toolchain.
PREFERRED_MAX_MINOR = 12


def discover_interpreters() -> dict[tuple[int, int], str]:
    """Real Python installs known to the Windows `py` launcher.

    `py -0p` prints one line per install:
        -V:3.13 *        C:\\Users\\...\\Python313\\python.exe
    """
    found: dict[tuple[int, int], str] = {}
    if sys.platform != "win32":
        return found
    try:
        out = subprocess.check_output(["py", "-0p"], text=True, stderr=subprocess.STDOUT)
    except Exception:
        return found
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("-V:"):
            continue
        tag, _, rest = line[3:].partition(" ")
        path = rest.replace("*", "").strip()
        if not path:
            continue
        try:
            major, minor = (int(x) for x in tag.split(".")[:2])
        except ValueError:
            continue
        found[(major, minor)] = path
    return found


def choose_interpreter() -> tuple[str, str]:
    """Pick the interpreter to BUILD the venv from. Returns (path, why).

    Deliberately avoids `sys.executable` when this script is itself running
    inside a virtualenv. On this machine `python` on PATH resolves to an
    UNRELATED project's venv (srmc_horilla); basing a new venv on another
    project's venv is not something to do silently.

    Prefers the newest real install at or below PREFERRED_MAX_MINOR, because the
    pinned ML wheels are likelier to exist for it.
    """
    installs = discover_interpreters()
    if installs:
        ok = sorted(v for v in installs if v[0] == 3 and v[1] <= PREFERRED_MAX_MINOR)
        if ok:
            best = ok[-1]
            return installs[best], f"py launcher, newest <= 3.{PREFERRED_MAX_MINOR}"
        best = sorted(installs)[0]
        return installs[best], "py launcher (no 3.12-or-lower install found)"

    in_venv = sys.prefix != sys.base_prefix
    return sys.executable, "current interpreter (inside a venv!)" if in_venv else "current interpreter"


def venv_python(venv: Path) -> Path:
    """The interpreter inside a venv - layout differs on Windows vs POSIX."""
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def run(cmd: list[str]) -> int:
    print("\n$ " + " ".join(str(c) for c in cmd), flush=True)
    return subprocess.call(cmd)


def interpreter_version(python: str) -> tuple[int, int] | None:
    try:
        out = subprocess.check_output(
            [python, "-c", "import sys;print(sys.version_info[0],sys.version_info[1])"],
            text=True,
            stderr=subprocess.STDOUT,
        )
        major, minor = out.split()
        return int(major), int(minor)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Set up image-service/ in a venv.")
    parser.add_argument(
        "--check", action="store_true", help="report the plan; install nothing"
    )
    parser.add_argument(
        "--python",
        default=None,
        help="interpreter used to CREATE the venv (default: auto-detected real install)",
    )
    args = parser.parse_args()

    if args.python:
        chosen, why = args.python, "given with --python"
    else:
        chosen, why = choose_interpreter()
    args.python = chosen

    print(f"repo    : {REPO}")
    print(f"service : {SERVICE}")
    print(f"venv    : {VENV}")

    if not SERVICE.is_dir() or not REQUIREMENTS.is_file():
        print(f"\nERROR: {REQUIREMENTS} not found - is image-service/ present?")
        return 2

    version = interpreter_version(args.python)
    if version is None:
        print(f"\nERROR: cannot run the interpreter: {args.python}")
        return 2
    print(f"python  : {args.python}  ({version[0]}.{version[1]})")
    print(f"          chosen via: {why}")

    if version[0] == 3 and version[1] > PREFERRED_MAX_MINOR:
        print(
            f"\n  WARNING: Python 3.{version[1]} is newer than 3.{PREFERRED_MAX_MINOR}.\n"
            "  The pinned ML wheels (torch, opencv, sam2, transformers) may not\n"
            "  publish builds for it yet. If pip starts COMPILING instead of\n"
            "  downloading .whl files, stop it and re-run with a 3.12 interpreter:\n"
            '      python scripts/setup_image_service.py --python "C:\\Python312\\python.exe"\n'
            "  Nothing else on the machine is affected either way."
        )

    if args.check:
        print("\n--check: stopping here. Nothing was created or installed.")
        return 0

    if not VENV.exists():
        if run([args.python, "-m", "venv", str(VENV)]) != 0:
            print("\nERROR: failed to create the virtualenv.")
            return 1
    else:
        print("\nvenv already exists - reusing it.")

    py = venv_python(VENV)
    if not py.exists():
        print(f"\nERROR: interpreter missing after venv creation: {py}")
        return 1

    # A current pip matters here: the pinned "+cpu" torch build is resolved from
    # the extra index declared at the top of requirements-pazl.txt.
    run([str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])

    if run([str(py), "-m", "pip", "install", "-r", str(REQUIREMENTS)]) != 0:
        print(
            "\nERROR: dependency install failed.\n"
            "  Most likely cause is a missing wheel for this Python version.\n"
            "  Re-run with a 3.12 interpreter (see --python above).\n"
            "  Nothing outside image-service/.venv was changed."
        )
        return 1

    if run([str(py), "-m", "pip", "install", "--no-deps", NO_DEPS_PACKAGE]) != 0:
        print(f"\nERROR: failed to install {NO_DEPS_PACKAGE}.")
        return 1

    print("\n" + "=" * 72)
    print("Done. Start the service with:\n")
    print(f'    cd "{SERVICE}"')
    print(f'    "{py}" -m uvicorn app.pazl_api:app --host 127.0.0.1 --port 8199')
    print("\nThen check it with:\n")
    print("    curl http://localhost:8199/api/health")
    print(
        "\nNote: the FIRST request downloads the models (SAM2 / LaMa / rembg /\n"
        "CLIPSeg) - several GB, and slow. Later runs reuse the cache."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

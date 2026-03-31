"""
ARENA Desktop Client - PyInstaller Build Script
Generates a standalone .exe for Windows distribution.

Usage:
    python build.py          # Build .exe
    python build.py --clean  # Clean build artifacts first
"""

import importlib.util
import os
import shutil
import subprocess
import sys
import time


APP_NAME = "ArenaClient"
ICON_PATH = "assets/arena_icon.ico"
MAIN_SCRIPT = "main.py"

# Only config file - no Python modules as data
DATA_FILES = [
    ("config.json", "."),
]

# Client only needs: pystray, PIL, mss, httpx, psutil
# NO cv2, numpy, pytesseract - OCR happens server-side
HIDDEN_IMPORTS = [
    "pystray._win32",
    "PIL._tkinter_finder",
    "psutil",
    "mss",
    "mss.tools",
    "httpx",
    "customtkinter",
    "customtkinter.windows",
    "customtkinter.windows.widgets",
]


def ensure_pyinstaller_installed():
    """Fail fast with a clear message when PyInstaller is missing."""
    if importlib.util.find_spec("PyInstaller") is not None:
        return
    print("ERROR: PyInstaller is not installed in this Python environment.")
    print("Run: python -m pip install -r requirements.txt")
    sys.exit(1)


def stop_running_client_processes():
    """
    Stop running ArenaClient.exe processes that lock dist/ArenaClient.exe.
    This prevents WinError 5 (Access denied) during rebuilds.
    """
    if sys.platform != "win32":
        return

    try:
        import psutil  # type: ignore
    except Exception:
        # If psutil is unavailable, build can still proceed.
        return

    script_dir = os.path.dirname(os.path.abspath(__file__))
    target_exe = os.path.abspath(os.path.join(script_dir, "dist", f"{APP_NAME}.exe")).lower()
    stopped = 0

    for proc in psutil.process_iter(attrs=["pid", "name", "exe"]):
        try:
            exe_path = (proc.info.get("exe") or "").lower()
            name = (proc.info.get("name") or "").lower()
            if exe_path == target_exe or name == f"{APP_NAME.lower()}.exe":
                proc.terminate()
                stopped += 1
        except Exception:
            continue

    if stopped:
        # Give Windows a moment to release file handles.
        time.sleep(1.0)
        print(f"Stopped {stopped} running {APP_NAME}.exe process(es).")


def clean():
    """Remove previous build artifacts."""
    for d in ["build", "dist", f"{APP_NAME}.spec"]:
        path = os.path.join(os.path.dirname(__file__), d)
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
                print(f"Removed {d}/")
            elif os.path.isfile(path):
                os.remove(path)
                print(f"Removed {d}")
        except PermissionError:
            print(f"Warning: Could not remove {d} (file in use?)")


def build():
    """Build .exe using PyInstaller."""
    ensure_pyinstaller_installed()
    stop_running_client_processes()
    print(f"\n  Building {APP_NAME}...\n")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--windowed",
        f"--name={APP_NAME}",
        "--clean",
    ]

    # Add icon if exists
    if os.path.exists(ICON_PATH):
        cmd.append(f"--icon={ICON_PATH}")

    # Add data files
    for src, dest in DATA_FILES:
        if os.path.exists(src):
            sep = ";" if sys.platform == "win32" else ":"
            cmd.append(f"--add-data={src}{sep}{dest}")

    # Add hidden imports
    for imp in HIDDEN_IMPORTS:
        cmd.append(f"--hidden-import={imp}")

    cmd.append(MAIN_SCRIPT)

    print(f"Running: {' '.join(cmd)}\n")
    result = subprocess.run(cmd, cwd=os.path.dirname(__file__) or ".")

    if result.returncode == 0:
        exe_name = f"{APP_NAME}.exe" if sys.platform == "win32" else APP_NAME
        exe_path = os.path.join("dist", exe_name)
        if os.path.exists(exe_path):
            size_mb = os.path.getsize(exe_path) / (1024 * 1024)
            print(f"\n  Build successful!")
            print(f"  Output: {exe_path}")
            print(f"  Size: {size_mb:.1f} MB\n")
    else:
        print("Build failed!")
        sys.exit(1)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    stop_running_client_processes()

    if "--clean" in sys.argv:
        clean()

    build()

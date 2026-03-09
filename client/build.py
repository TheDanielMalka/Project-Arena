"""
ARENA Desktop Client - PyInstaller Build Script
Generates a standalone .exe for Windows distribution.

Usage:
    python build.py          # Build .exe
    python build.py --clean  # Clean build artifacts first
"""

import os
import sys
import shutil
import subprocess


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
]


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

    if "--clean" in sys.argv:
        clean()

    build()

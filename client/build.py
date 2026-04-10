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
import stat
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


def _rmtree_retry(path: str) -> None:
    """Remove a tree; clear read-only bits on Windows so EXE delete works."""
    if not os.path.isdir(path):
        return
    if sys.platform == "win32":
        stop_running_client_processes()
        time.sleep(0.5)
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            fp = os.path.join(root, name)
            try:
                os.chmod(fp, stat.S_IWRITE)
                os.unlink(fp)
            except OSError:
                pass
        for name in dirs:
            dp = os.path.join(root, name)
            try:
                os.chmod(dp, stat.S_IWRITE)
                os.rmdir(dp)
            except OSError:
                pass
    try:
        os.chmod(path, stat.S_IWRITE)
        os.rmdir(path)
    except OSError:
        pass


def clean():
    """Remove previous build artifacts (stops running ArenaClient.exe on Windows first)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    for d in ["build", "dist", f"{APP_NAME}.spec"]:
        path = os.path.join(script_dir, d)
        try:
            if os.path.isdir(path):
                _rmtree_retry(path)
                print(f"Removed {d}/")
            elif os.path.isfile(path):
                try:
                    os.chmod(path, stat.S_IWRITE)
                except Exception:
                    pass
                os.remove(path)
                print(f"Removed {d}")
        except OSError as e:
            print(f"Warning: Could not remove {d}: {e}")
            print("  Close Arena Client (tray), then delete client/dist manually if needed.")


def _copy_distribution_extras() -> None:
    """
    Copy arena_cert.cer + setup.ps1 into dist/ next to the EXE so testers get
    a complete bundle (zip these three files for S3 download).
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(script_dir, "dist")
    os.makedirs(dist_dir, exist_ok=True)
    for name in ("arena_cert.cer", "setup.ps1"):
        src = os.path.join(script_dir, name)
        dst = os.path.join(dist_dir, name)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            print(f"  Dist bundle: copied {name} -> dist/\n")
        else:
            print(f"  WARNING: {name} missing next to build.py - add it for S3 bundle.\n")


def _sign_exe(abs_exe: str) -> None:
    """
    Sign the built EXE with the self-signed ArenaClient certificate.

    arena_sign.pfx is generated once via client/make_cert.ps1 (run as admin).
    It lives in the client/ folder and is listed in .gitignore so the private
    key is never committed.  If the PFX is absent the build still succeeds but
    prints a warning — the EXE may be blocked by Windows Smart App Control on
    machines where the cert is not trusted.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    pfx_path   = os.path.join(script_dir, "arena_sign.pfx")

    if not os.path.exists(pfx_path):
        print("  WARNING: arena_sign.pfx not found — EXE not signed.")
        print("  Run client/make_cert.ps1 as Administrator once to create it.\n")
        return

    sign_cmd = (
        f"$b=[System.IO.File]::ReadAllBytes('{pfx_path}');"
        f"$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("
        f"$b,'arena2026',"
        f"[System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable);"
        f"$r=Set-AuthenticodeSignature -FilePath '{abs_exe}' -Certificate $c -HashAlgorithm SHA256;"
        f"Write-Host $r.Status"
    )
    result = subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-Command", sign_cmd],
        capture_output=True, text=True,
    )
    status = result.stdout.strip()
    if status == "Valid":
        print("  Code signing: OK (SAC will not block this EXE)\n")
    else:
        print(f"  Code signing failed: {status} {result.stderr.strip()}\n")


def _unblock_exe(abs_exe: str) -> None:
    """Remove Zone.Identifier (Mark of the Web) when present."""
    if sys.platform != "win32":
        return
    subprocess.run(
        [
            "powershell", "-NoProfile", "-Command",
            f"Unblock-File -LiteralPath '{abs_exe}' -ErrorAction SilentlyContinue",
        ],
        capture_output=True,
    )


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
            # Sign the EXE with self-signed cert so SAC (Smart App Control)
            # does not block it. arena_sign.pfx must exist next to build.py.
            abs_exe = os.path.abspath(exe_path)
            if sys.platform == "win32":
                _sign_exe(abs_exe)
                _unblock_exe(abs_exe)
            _copy_distribution_extras()
    else:
        print("Build failed!")
        sys.exit(1)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    stop_running_client_processes()

    if "--clean" in sys.argv:
        clean()

    build()

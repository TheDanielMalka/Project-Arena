"""
ARENA Desktop Client — Windows Auto-Start Manager
Adds/removes the client from Windows startup registry.
"""

import os
import sys
import logging

logger = logging.getLogger("arena.client.autostart")

APP_NAME = "ArenaClient"


def get_exe_path() -> str:
    """Get the path to the current executable (works for both .py and .exe)."""
    if getattr(sys, "frozen", False):
        return sys.executable
    return os.path.abspath(sys.argv[0])


def enable_autostart():
    """Add Arena Client to Windows startup."""
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        )
        exe_path = get_exe_path()
        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{exe_path}" --minimized')
        winreg.CloseKey(key)
        logger.info(f"✅ Auto-start enabled: {exe_path}")
        return True
    except ImportError:
        logger.warning("winreg not available — not on Windows")
        return False
    except Exception as e:
        logger.error(f"Failed to enable auto-start: {e}")
        return False


def disable_autostart():
    """Remove Arena Client from Windows startup."""
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        )
        try:
            winreg.DeleteValue(key, APP_NAME)
            logger.info("⏹️ Auto-start disabled")
        except FileNotFoundError:
            logger.info("Auto-start was not enabled")
        winreg.CloseKey(key)
        return True
    except ImportError:
        return False
    except Exception as e:
        logger.error(f"Failed to disable auto-start: {e}")
        return False


def is_autostart_enabled() -> bool:
    """Check if Arena Client is set to auto-start."""
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_READ,
        )
        try:
            winreg.QueryValueEx(key, APP_NAME)
            return True
        except FileNotFoundError:
            return False
        finally:
            winreg.CloseKey(key)
    except ImportError:
        return False
    except Exception:
        return False


if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "enable":
            enable_autostart()
        elif sys.argv[1] == "disable":
            disable_autostart()
        elif sys.argv[1] == "status":
            print(f"Auto-start: {'enabled' if is_autostart_enabled() else 'disabled'}")
    else:
        print("Usage: python autostart.py [enable|disable|status]")

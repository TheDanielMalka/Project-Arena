"""
conftest.py — Client test configuration.
Mocks GUI/display dependencies before any test module imports main.py,
so tests run correctly in headless CI environments (no X display needed).
"""
import sys
from unittest.mock import MagicMock

# Mock pystray and Xlib before main.py is imported — prevents
# "Bad display name" error in headless Linux CI environments.
sys.modules["pystray"] = MagicMock()
sys.modules["pystray._xorg"] = MagicMock()
sys.modules["Xlib"] = MagicMock()
sys.modules["Xlib.display"] = MagicMock()

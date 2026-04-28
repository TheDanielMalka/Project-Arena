# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('config.json', '.'), ('assets', 'assets'), ('C:\\Users\\LENOVO\\AppData\\Local\\Programs\\Python\\Python313\\tcl\\tcl8.6', '_tcl_data'), ('C:\\Users\\LENOVO\\AppData\\Local\\Programs\\Python\\Python313\\tcl\\tk8.6', '_tk_data')],
    hiddenimports=['pystray._win32', 'PIL._tkinter_finder', 'psutil', 'mss', 'mss.tools', 'httpx', 'customtkinter', 'customtkinter.windows', 'customtkinter.windows.widgets', 'websockets', 'websockets.asyncio', 'websockets.asyncio.client', 'websockets.asyncio.connection', 'websockets.asyncio.messages', 'websockets.asyncio.server', 'websockets.exceptions', 'websockets.http11', 'websockets.connection', 'websockets.frames', 'websockets.streams', 'websockets.legacy', 'websockets.legacy.client', 'websockets.legacy.protocol', 'websockets.protocol', 'websockets.uri', 'websockets.version', 'win32api', 'win32con', 'win32gui', 'win32print'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ArenaClient',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['assets\\arena_icon.ico'],
)

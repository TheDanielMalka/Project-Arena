@echo off
REM Arena Client launcher — runs via pythonw.exe (PSF-signed, trusted by
REM Windows Device Guard / Smart App Control). Avoids SmartScreen prompts
REM that fire on every new EXE hash. Functionally identical to the EXE.
cd /d "%~dp0"
start "" pythonw main.py
exit

# ARENA Desktop Client

## 🎮 Overview
A lightweight background application that runs on the player's machine. When a CS2 match (or any supported title) concludes, the client automatically captures the screen, performs OCR-based result recognition, and reports the outcome to the Engine API for verification and payout processing.

## 📁 Project Structure
```
client/
├── main.py           # Entry point — System Tray + Match Monitor
├── autostart.py      # Windows auto-start via Registry
├── build.py          # PyInstaller build script → .exe
├── config.json       # Runtime configuration (URL, token, interval, game)
├── requirements.txt  # Python dependencies
└── assets/           # Icons & bundled resources
```

## 🚀 Development Setup

### Prerequisites
- **Python 3.12+**
- **Tesseract OCR** installed and added to PATH
  - Windows: [UB-Mannheim Tesseract Installer](https://github.com/UB-Mannheim/tesseract/wiki)

### Quick Start
```bash
cd client
python -m venv venv
source venv/bin/activate   # Linux/macOS
venv\Scripts\activate      # Windows
pip install -r requirements.txt
python main.py
```

## ⚙️ Configuration (`config.json`)

| Field                  | Description                          | Default                |
|------------------------|--------------------------------------|------------------------|
| `engine_url`           | Engine API base URL                  | `http://localhost:8000` |
| `auth_token`           | Authentication token (JWT)           | `""`                   |
| `screenshot_interval`  | Capture interval in seconds          | `5`                    |
| `monitor`              | Display index to capture             | `1`                    |
| `auto_start`           | Begin monitoring on launch           | `true`                 |
| `game`                 | Target game to monitor               | `"CS2"`                |

## 🖥️ System Tray

When running, the application sits in the system tray with the following controls:

| Action                | Description                              |
|-----------------------|------------------------------------------|
| **▶ Start Monitoring** | Begin screen capture and OCR pipeline   |
| **⏹ Stop Monitoring** | Pause all capture activity              |
| **📡 Check Engine**   | Test connectivity to the Engine API      |
| **❌ Quit**           | Gracefully shut down the client          |

### Automatic Game Detection
The client monitors running processes to detect supported games. When the target game launches, the capture pipeline starts automatically. When the game exits, monitoring pauses until the next session.

## 🔄 How It Works

```
1. Player installs Arena Client on their machine
2. Client launches as a system tray application
3. When CS2 is detected → screen capture begins every 5 seconds
4. At match end → color analysis determines win (green) / loss (red)
5. OCR extracts player names and final score
6. Results are submitted to Engine API → POST /validate/screenshot
7. Engine updates the database → Frontend reflects changes in real time
```

## 📦 Building for Distribution

### Standard Build
```bash
cd client
pip install -r requirements.txt
python build.py
```
Output: `client/dist/ArenaClient.exe`

### Clean Build
```bash
python build.py --clean
```
Removes all previous build artifacts before compiling.

## 🔧 Auto-Start (Windows Boot)

```bash
# Enable auto-start
python autostart.py enable

# Disable auto-start
python autostart.py disable

# Check current status
python autostart.py status
```

## 🧪 Supported Titles

| Game          | Process Name                           |
|---------------|----------------------------------------|
| CS2           | `cs2.exe`                              |
| Valorant      | `VALORANT-Win64-Shipping.exe`          |
| Fortnite      | `FortniteClient-Win64-Shipping.exe`    |
| Apex Legends  | `r5apex.exe`                           |

## 🔐 Security

- Authentication tokens are stored locally in `config.json` — never transmitted in plain text.
- All Engine communication uses HTTPS in production environments.
- Screenshots are stored locally and purged after successful verification.

## 🛡️ Anti-Cheat Compatibility

The Arena Client is fully compatible with anti-cheat systems (VAC, Riot Vanguard, Easy Anti-Cheat) because it uses a **screen-only capture approach**:

| What we do | What we never do |
|---|---|
| ✅ Screen capture via Windows GDI (`mss`) | ❌ Game memory reading |
| ✅ Process name detection (`psutil`) | ❌ DLL injection |
| ✅ Screenshot upload to Engine API | ❌ Kernel-level hooks |
| ✅ Randomized capture intervals | ❌ Game file modification |

### Why this is safe
- `mss` captures the screen at the OS level — identical to taking a screenshot manually
- No interaction with the game process beyond detecting that it is running
- Anti-cheat engines do not block OS-level screen capture
- Tested on live CS2 with VAC enabled — no flags, no bans

# ARENA — Competitive Gaming Platform

> Automated match verification and wagering platform for competitive FPS titles.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ARENA Platform                         │
├──────────────┬──────────────────┬───────────────────────────┤
│   Frontend   │   Engine API     │   Desktop Client          │
│   (React)    │   (FastAPI)      │   (Python / System Tray)  │
│              │                  │                           │
│  Dashboard   │  /health         │  Game detection           │
│  Match Lobby │  /validate       │  Screen capture           │
│  Wallet      │  /match/result   │  OCR recognition          │
│  History     │  /match/lobby    │  Result submission         │
│  Profile     │                  │                           │
└──────┬───────┴────────┬─────────┴─────────────┬─────────────┘
       │                │                       │
       │         ┌──────┴──────┐                │
       └────────►│  PostgreSQL │◄───────────────┘
                 │  Database   │
                 └─────────────┘
```

## 📁 Project Structure

```
├── src/                    # Frontend — React + TypeScript + Tailwind
│   ├── pages/              # Dashboard, MatchLobby, Wallet, History, Profile
│   ├── components/         # Reusable UI components
│   ├── stores/             # Zustand state management
│   ├── hooks/              # Custom hooks (polling, engine status)
│   └── lib/                # API client, utilities
│
├── engine/                 # Backend — FastAPI + Vision Pipeline
│   ├── main.py             # API server entry point
│   ├── src/vision/         # Screen capture, OCR, result matching
│   └── tests/              # Unit tests for vision modules
│
├── client/                 # Desktop Client — Python System Tray App
│   ├── main.py             # Background monitor + tray controls
│   ├── autostart.py        # Windows auto-start management
│   ├── build.py            # PyInstaller → .exe builder
│   └── config.json         # Local configuration
│
├── infra/
│   ├── sql/init.sql        # Database schema + seed data
│   └── nginx/default.conf  # Reverse proxy configuration
│
├── docker-compose.yml      # Full-stack orchestration (3 containers)
├── Dockerfile.frontend     # Frontend production build
└── .github/workflows/      # CI/CD pipeline
```

## 🚀 Quick Start

### Prerequisites
- **Docker & Docker Compose** (recommended)
- **Node.js 18+** (frontend development)
- **Python 3.12** (recommended for engine/client)
- **Tesseract OCR** (required for OCR tests/runtime on Windows)

### Option 1: Docker (Full Stack)
```bash
cp .env.example .env
# Edit .env with your configuration
docker compose up --build
```

Services:
| Service   | URL                    |
|-----------|------------------------|
| Frontend  | http://localhost:3000   |
| Engine    | http://localhost:8000   |
| Database  | localhost:5432          |

### Option 2: Local Development

**Frontend:**
```bash
npm install
npm run dev
```

**Engine:**
```bash
cd engine
python3 -m venv .venv
# Linux/macOS/WSL-created venv:
source .venv/bin/activate
# Git Bash / Windows-created venv:
# source .venv/Scripts/activate
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Desktop Client:**
```bash
cd client
python3 -m venv .venv
# Linux/macOS/WSL-created venv:
source .venv/bin/activate
# Git Bash / Windows-created venv:
# source .venv/Scripts/activate
pip install -r requirements.txt
python main.py
```

**WSL shortcut workflow (if configured):**
```bash
engine   # cd -> engine + activate engine .venv
client   # cd -> client + activate client .venv
off      # deactivate + return project root
```

## 🔄 Match Flow

```
Player launches CS2
        │
        ▼
Desktop Client detects game process
        │
        ▼
Screen capture every 5 seconds
        │
        ▼
Match ends → Color analysis (win/loss)
        │
        ▼
OCR extracts player names + score
        │
        ▼
POST /validate/screenshot → Engine API
        │
        ▼
Engine verifies and updates database
        │
        ▼
Frontend polls and reflects results
```

## 🧪 Testing

```bash
# Frontend unit tests
npm run test

# Engine tests (WSL shortcuts)
engine
pytest tests -q
off

# Client smoke test
client
python -m py_compile main.py
off
```

## 📦 Building for Production

### Frontend
```bash
npm run build
# Output: dist/
```

### Desktop Client
```bash
cd client
python build.py
# Output: client/dist/ArenaClient.exe
```

### Docker
```bash
docker compose -f docker-compose.yml up --build -d
```

## 🔐 Environment Variables

See [`.env.example`](.env.example) for the complete list of required environment variables.

## 📖 Component Documentation

| Component | README |
|-----------|--------|
| Desktop Client | [`client/README.md`](client/README.md) |
| Engine API | [`engine/`](engine/) |
| Frontend | [`src/`](src/) |

## 📄 License

Proprietary — All rights reserved.

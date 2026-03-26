# ProjectArena — Full Setup Guide

> **Goal:** After following this guide on a fresh machine you will have an identical
> environment to the original development setup — exact package versions, same Node,
> same Python, same aliases.

---

## Prerequisites

Install the following **before** cloning:

| Tool | Version | Where to get it |
|---|---|---|
| **Node.js** | v24.14.0 | https://nodejs.org — or `nvm install 24` |
| **Python (Windows)** | 3.13.2 | https://www.python.org/downloads/ |
| **Python (WSL)** | 3.12.3 | `sudo apt install python3.12 python3.12-venv` |
| **Tesseract OCR** | 5.x | Windows: [UB-Mannheim build](https://github.com/UB-Mannheim/tesseract/wiki) · WSL: `sudo apt install tesseract-ocr tesseract-ocr-eng` |
| **PostgreSQL** | 15+ | Windows: https://www.postgresql.org/download/windows/ · WSL: `sudo apt install postgresql` |
| **Git** | any | https://git-scm.com |

---

## 1 — Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/ProjectArena.git
cd ProjectArena
```

---

## 2 — Environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in **every** placeholder value:
- `DB_PASSWORD` / `DATABASE_URL`
- `PRIVATE_KEY` / `WALLET_ADDRESS`
- `BINANCE_API_KEY` / `BINANCE_SECRET`
- `CONTRACT_ADDRESS` (fill after deploying the smart contract)

---

## 3 — Frontend (Node / React)

```bash
npm ci          # uses package-lock.json → exact same versions every time
npm test        # verify all 40+ tests pass
```

> `npm ci` (not `npm install`) is required for a reproducible install.

---

## 4 — Engine — WSL / Linux venv  *(primary for running the server)*

Open a **WSL terminal**:

```bash
cd /mnt/c/Users/YOUR_USER/ProjectArena/engine

# Create the venv with the exact Python version
python3.12 -m venv .venv

# Activate
source .venv/bin/activate

# Install the locked versions (exact patch pinning)
pip install -r requirements-lock-linux.txt

# Verify
python -m pytest tests/ -q
```

---

## 5 — Engine — Windows venv  *(optional, for Windows-only development)*

Open a **PowerShell** terminal:

```powershell
cd C:\Users\YOUR_USER\ProjectArena\engine

python -m venv .wvenv
.\.wvenv\Scripts\Activate.ps1

pip install -r requirements-lock-windows.txt
```

> Note: `uvloop` is Linux-only and is absent from the Windows lock file — this is expected.

---

## 6 — Client (Windows venv)

```powershell
cd C:\Users\YOUR_USER\ProjectArena\client

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements-lock.txt
```

---

## 7 — Database (PostgreSQL)

```bash
# WSL or native Linux
psql -U postgres -f infra/sql/init.sql
```

---

## 8 — WSL `.bashrc` aliases

Add the following to `~/.bashrc` (replace `YOUR_USER`):

```bash
# ── Arena venv shortcuts ──────────────────────────────────────────
engine() {
  source /mnt/c/Users/YOUR_USER/ProjectArena/engine/.venv/bin/activate
}

client() {
  # Windows client venv accessed from WSL
  source /mnt/c/Users/YOUR_USER/ProjectArena/client/.venv/Scripts/activate
}

off() {
  deactivate 2>/dev/null || true
}
```

Then reload: `source ~/.bashrc`

Usage:
```bash
engine   # activate engine venv
off      # deactivate
client   # activate client venv
off      # deactivate
```

---

## 9 — Verify everything

```bash
# Frontend
npm test
npx tsc -p tsconfig.app.json --noEmit

# Engine (WSL)
engine
cd engine && python -m pytest tests/ -q

# Client (WSL → Windows path)
client
cd client && python -m pytest -q
```

---

## How to keep lock files up to date

Whenever you add or upgrade a package, regenerate the lock file:

```bash
# Engine — WSL
source engine/.venv/bin/activate
pip freeze > engine/requirements-lock-linux.txt

# Engine — Windows
engine\.wvenv\Scripts\activate
pip freeze > engine\requirements-lock-windows.txt

# Client — Windows
client\.venv\Scripts\activate
pip freeze > client\requirements-lock.txt

# Frontend — automatic (npm ci regenerates package-lock.json)
npm install some-package
# package-lock.json is updated automatically — commit it
```

---

## Project structure reference

```
ProjectArena/
├── src/                          React + TypeScript frontend
├── engine/                       Python FastAPI backend
│   ├── .venv/                    WSL Python 3.12.3 venv  (gitignored)
│   ├── .wvenv/                   Windows Python 3.13.2 venv  (gitignored)
│   ├── requirements.txt          loose version ranges
│   ├── requirements-lock-linux.txt    exact WSL versions ← use this to restore
│   └── requirements-lock-windows.txt  exact Windows versions ← use this to restore
├── client/                       Python desktop client (Windows)
│   ├── .venv/                    Windows Python 3.13.2 venv  (gitignored)
│   ├── requirements.txt          loose version ranges
│   └── requirements-lock.txt     exact versions ← use this to restore
├── infra/sql/                    PostgreSQL schema
├── engine/contracts/             Solidity smart contracts
├── .env.example                  template — copy to .env and fill in
├── .nvmrc                        Node.js version (v24.14.0)
├── .python-version               Windows Python version (3.13.2)
├── engine/.python-version        WSL Python version (3.12.3)
└── package-lock.json             exact npm versions ← npm ci uses this
```

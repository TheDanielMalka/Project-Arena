# Project Arena 🎮⚔️

**The AI-Powered Web3 Oracle for Competitive Gaming**

Arena is a decentralized adjudication system designed to facilitate high-stakes gaming matches without manual intervention. By combining Computer Vision (AI) with Smart Contract Escrows (Blockchain), we ensure fair play and automated payouts for gamers globally.

---

## 🎯 Core Technologies

### 🔍 Vision Engine
**Python-based AI using OpenCV** for real-time match result validation
- Screenshot analysis of CS2 scoreboard
- OCR for kill/death extraction
- Automated win/loss detection

### 🔗 Blockchain
**Solidity Smart Contracts** on Ethereum-compatible chains
- Secure fund escrow
- Multi-layer authentication using SSH-encrypted communication
- Automated payout distribution

### 💰 Web3 Integration
**Binance API** + **WalletConnect** for seamless liquidity management
- Crypto payments (ETH, USDT, BNB)
- Wallet authentication
- Transaction management

---

## 📂 Project Structure
```
project-arena/
├── src/
│   ├── config.py        # Environment & secrets loader
│   ├── vision/          # Computer Vision AI
│   ├── blockchain/      # Smart Contracts
│   ├── web3/           # Payment Integration
│   └── api/            # REST API
├── tests/              # Test Suite
├── docs/               # Documentation
├── scripts/            # Deployment Scripts
└── config/             # Configuration Files
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- MetaMask or WalletConnect wallet

### Installation
```bash
# Clone the repository
git clone https://github.com/TheDanielMalka/Project-Arena.git
cd Project-Arena

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Environment Setup
```bash
# Copy the environment template
cp .env.example .env

# Edit .env and fill in your actual keys
nano .env
```

Required variables:
- `PRIVATE_KEY` — Blockchain wallet private key
- `WALLET_ADDRESS` — Your wallet address
- `BINANCE_API_KEY` — Binance API key
- `BINANCE_SECRET` — Binance API secret
- `ORACLE_API_KEY` — Oracle service API key
- `DATABASE_URL` — Database connection string
- `SSH_KEY_PATH` — Path to SSH private key (optional)
- `ENVIRONMENT` — development / production (default: development)

> ⚠️ Never commit your `.env` file. It is already in `.gitignore`.

### Running Tests
```bash
pytest tests/ -v
```

---

## 🗺️ Roadmap & Architecture

See [Roadmap Documentation](docs/architecture/ROADMAP.md) for detailed project phases.

### Sprint 1: Secure Core & Git Setup ✅
- [x] GitHub repository initialization
- [x] CI/CD pipeline with GitHub Actions
- [x] Project structure

### Sprint 2: Vision Engine (In Progress)
- [ ] OpenCV screenshot capture
- [ ] OCR scoreboard detection
- [ ] Match validation logic

### Sprint 3: Blockchain Integration
- [ ] Escrow smart contract
- [ ] Testnet deployment
- [ ] Multi-sig validation

### Sprint 4: Web3 Payments
- [ ] Binance API integration
- [ ] WalletConnect setup
- [ ] Payment flow

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 🔗 Links

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/TheDanielMalka/Project-Arena/issues)
- **Milestones**: [GitHub Milestones](https://github.com/TheDanielMalka/Project-Arena/milestones)

---

**Built with 💪 by [TheDanielMalka](https://github.com/TheDanielMalka)**

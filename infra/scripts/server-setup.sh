#!/bin/bash
# Run once on a fresh Ubuntu 22.04+ server.
# Must be run as root or with sudo from the repo root directory.

set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CERT_DIR="/etc/ssl/cloudflare"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ProjectArena — Server Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System packages
apt-get update -qq
apt-get install -y git ufw fail2ban curl

echo "✅ System packages installed"

# ── 2. Docker
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker && systemctl start docker
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# ── 3. Docker Compose plugin
if ! docker compose version &>/dev/null; then
    apt-get install -y docker-compose-plugin
fi
echo "✅ Docker Compose ready"

# ── 4. cloudflared
if ! command -v cloudflared &>/dev/null; then
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg \
        | tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' \
        | tee /etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq && apt-get install -y cloudflared
    echo "✅ cloudflared installed"
    echo "   → Run: sudo cloudflared service install <TOKEN>"
    echo "   → Token: Cloudflare Zero Trust → Networks → Tunnels → projectarena-tunnel"
else
    echo "✅ cloudflared already installed"
fi

# ── 5. Firewall (UFW)
ufw allow 22/tcp   comment "SSH"
ufw allow 80/tcp   comment "HTTP"
ufw allow 443/tcp  comment "HTTPS"
ufw --force enable
echo "✅ UFW firewall: ports 22, 80, 443 open"

# ── 6. fail2ban
cp "$REPO_DIR/infra/fail2ban/jail.d/arena-sshd.conf"   /etc/fail2ban/jail.d/
cp "$REPO_DIR/infra/fail2ban/action.d/slack-arena.conf" /etc/fail2ban/action.d/
systemctl enable fail2ban && systemctl restart fail2ban
echo "✅ fail2ban configured"

# ── 7. Swap (2GB — important for small servers)
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "✅ 2GB swap created"
else
    echo "✅ Swap already exists"
fi

# ── 8. Cloudflare Origin CA certs
mkdir -p "$CERT_DIR"
chmod 755 "$CERT_DIR"

MISSING=0
if [ ! -f "$CERT_DIR/origin.crt" ]; then
    echo "❌ MISSING: $CERT_DIR/origin.crt"
    MISSING=1
fi
if [ ! -f "$CERT_DIR/origin.key" ]; then
    echo "❌ MISSING: $CERT_DIR/origin.key"
    MISSING=1
fi

if [ $MISSING -eq 1 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ACTION REQUIRED: Install Cloudflare Origin CA certs"
    echo "  1. Cloudflare Dashboard → SSL/TLS → Origin Server"
    echo "  2. Create Certificate → copy Origin + Private Key"
    echo "  3. sudo nano $CERT_DIR/origin.crt"
    echo "  4. sudo nano $CERT_DIR/origin.key"
    echo "  5. sudo chmod 600 $CERT_DIR/origin.key"
    echo "  6. sudo chmod 644 $CERT_DIR/origin.crt"
    echo "  7. Run this script again"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

chmod 600 "$CERT_DIR/origin.key"
chmod 644 "$CERT_DIR/origin.crt"
echo "✅ Cloudflare Origin CA certs present"

# ── 9. .env file check
if [ ! -f "$REPO_DIR/.env" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ACTION REQUIRED: Create .env file"
    echo "  cp $REPO_DIR/.env.example $REPO_DIR/.env"
    echo "  nano $REPO_DIR/.env"
    echo "  Fill in at minimum:"
    echo "    DB_PASSWORD=<strong-password>"
    echo "    API_SECRET=<random-secret>"
    echo "    ENVIRONMENT=production"
    echo "    PRIVATE_KEY=<oracle-wallet-private-key>"
    echo "    WALLET_ADDRESS=<oracle-wallet-address>"
    echo "    CONTRACT_ADDRESS=0x47bB9861263A1AB7dAF2353765e0fd3118b71d38"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
echo "✅ .env file present"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Server setup complete!"
echo ""
echo "  Next steps:"
echo "  1. docker compose up -d --build"
echo "  2. Run SQL migrations:"
echo "     cat infra/sql/*.sql | docker exec -i arena-db psql -U arena_admin -d arena"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

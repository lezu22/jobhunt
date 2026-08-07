#!/bin/bash
# Start both backend and frontend
# Works on macOS (Homebrew, nvm, official installer) and Linux

echo "================================================"
echo "  Job Hunt Command Centre"
echo "================================================"
echo ""

# Resolve absolute path to the script's own directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# ─────────────────────────────────────────────────────
# Extend PATH with every common location node/python
# can live on macOS and Linux — needed when the script
# is launched by double-clicking instead of from a terminal
# ─────────────────────────────────────────────────────

# nvm (node version manager)
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null

# Load shell profile so user-level PATH additions are visible
for f in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$f" ] && source "$f" 2>/dev/null
done

# Add every known install prefix explicitly
export PATH="\
/opt/homebrew/bin:\
/opt/homebrew/opt/node/bin:\
/usr/local/bin:\
/usr/local/opt/node/bin:\
/usr/local/opt/python@3.12/bin:\
/usr/local/opt/python@3.11/bin:\
/usr/local/opt/python@3.10/bin:\
$HOME/.local/bin:\
$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)/bin:\
/usr/bin:\
/bin:\
$PATH"

# ─────────────────────────────────────────────────────
# Locate python3
# ─────────────────────────────────────────────────────
PYTHON=""
for c in python3 python3.12 python3.11 python3.10 python; do
    if command -v "$c" &>/dev/null; then PYTHON="$c"; break; fi
done

if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3 not found."
    echo ""
    echo "Install it from https://www.python.org/downloads/"
    echo "or with Homebrew:  brew install python3"
    echo ""
    echo "TIP: Always run this script from a Terminal window:"
    echo "  cd \"$SCRIPT_DIR\" && ./start.sh"
    read -p "Press Enter to close..."
    exit 1
fi

# ─────────────────────────────────────────────────────
# Locate node / npm
# ─────────────────────────────────────────────────────
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
    echo "ERROR: Node.js not found on PATH."
    echo ""
    echo "It is probably installed but its bin directory is not in PATH"
    echo "when scripts run outside a Terminal window."
    echo ""
    echo "── SOLUTION ──────────────────────────────────────────"
    echo "Open a Terminal (Cmd+Space → 'Terminal') and run:"
    echo ""
    echo "  cd \"$SCRIPT_DIR\""
    echo "  ./start.sh"
    echo ""
    echo "That's all — the Terminal will have the correct PATH."
    echo ""
    echo "── If Node is not installed at all ──────────────────"
    echo "  Homebrew:  brew install node"
    echo "  Official:  https://nodejs.org  (LTS version)"
    echo "  nvm:       https://github.com/nvm-sh/nvm"
    echo "──────────────────────────────────────────────────────"
    read -p "Press Enter to close..."
    exit 1
fi

echo "  Python : $($PYTHON --version 2>&1)"
echo "  Node   : $(node --version)"
echo "  npm    : $(npm --version)"
echo ""

# ─────────────────────────────────────────────────────
# Install dependencies
# ─────────────────────────────────────────────────────
echo "→ Installing Python dependencies..."
cd "$BACKEND_DIR" && $PYTHON -m pip install -r requirements.txt -q --break-system-packages 2>/dev/null \
    || $PYTHON -m pip install -r requirements.txt -q

echo "→ Installing Node dependencies..."
(cd "$FRONTEND_DIR" && npm install --silent)

# ─────────────────────────────────────────────────────
# Start backend
# ─────────────────────────────────────────────────────
echo ""
echo "→ Starting backend  http://localhost:8000"
(cd "$BACKEND_DIR" && $PYTHON -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload) &
BACKEND_PID=$!

# Give backend a moment to bind
sleep 2

# ─────────────────────────────────────────────────────
# Start frontend
# ─────────────────────────────────────────────────────
echo "→ Starting frontend http://localhost:5173"
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "================================================"
echo "  App      →  http://localhost:5173"
echo "  API      →  http://localhost:8000"
echo "  Ctrl+C   →  stop everything"
echo "================================================"

trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait

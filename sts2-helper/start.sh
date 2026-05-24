#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Install from https://nodejs.org/"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi

echo ""
echo "  STS2 Helper starting on http://localhost:3000"
echo "  Press Ctrl+C to stop."
echo ""

# Open browser if possible (non-blocking)
URL="http://localhost:3000"
(sleep 1 && (xdg-open "$URL" || open "$URL") 2>/dev/null) &

node server.js

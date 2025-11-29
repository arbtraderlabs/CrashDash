#!/bin/bash
################################################################################
# Restart Development Server for Local Testing
# Kills any existing server and starts fresh on port 8000
################################################################################

echo "🔍 Killing any existing servers..."

# Kill any existing http.server or Flask processes
pkill -9 -f "http.server" 2>/dev/null
pkill -9 -f "run_server.py" 2>/dev/null
pkill -9 python3 2>/dev/null

# Force clear port 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null

sleep 2

echo "✅ Port 8000 cleared"
echo ""
echo "🚀 Starting development server on http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

# Get script directory and derive website path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE_DIR="$(cd "$SCRIPT_DIR/../../website" && pwd)"

# Start server
cd "$WEBSITE_DIR"
python3 -m http.server 8000

#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Stop existing instance
screen -S visualizer -X quit 2>/dev/null

# Build client
echo "Building client..."
BASE_URL=/offlineplayerviewer/ npx vite build

# Start server in screen
screen -dmS visualizer bash -c "cd '$SCRIPT_DIR' && PORT=9191 NODE_OPTIONS='--no-deprecation --no-warnings' npx tsx src/server/index.ts /opt/mcme-network/bungee-mcme/servers-mcme/hub/hub/"
echo "Started in screen 'visualizer'. Attach with: screen -r visualizer"

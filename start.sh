#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/server.log"

# Stop existing instance
screen -S visualizer -X quit 2>/dev/null

# Build client
echo "Building client..."
BASE_URL=/offlineplayerviewer/ npx vite build

# Start server in screen, logging all output to file
echo "Starting server (log: $LOG_FILE)..."
screen -dmS visualizer bash -c "cd '$SCRIPT_DIR' && PORT=9191 NODE_OPTIONS='--no-deprecation --no-warnings' stdbuf -oL npx tsx src/server/index.ts /opt/mcme-network/bungee-mcme/servers-mcme/hub/hub/ 2>&1 | tee '$LOG_FILE'"
echo "Started in screen 'visualizer'. Attach with: screen -r visualizer"
echo "View log: tail -f $LOG_FILE"

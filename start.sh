#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/server.log"
WORLD_PATH="${1:-/opt/mcme-network/bungee-mcme/servers-mcme/hub/hub/}"
PORT="${PORT:-9191}"
BASE_URL="${BASE_URL:-/offlineplayerviewer/}"

# Stop existing instance
screen -S visualizer -X quit 2>/dev/null

# Clean old filtered heatmaps from previous runs
rm -f dist/static/heatmap-filtered-*.png dist/static/contours-filtered-*.json

# Build client
echo "Building client..."
BASE_URL="$BASE_URL" npx vite build

# Start server in screen, logging all output to file
echo "Starting server (log: $LOG_FILE)..."
echo "  World: $WORLD_PATH"
echo "  Port:  $PORT"
screen -dmS visualizer bash -c "cd '$SCRIPT_DIR' && PORT=$PORT NODE_OPTIONS='--no-deprecation --no-warnings' stdbuf -oL npx tsx src/server/index.ts '$WORLD_PATH' 2>&1 | tee '$LOG_FILE'"
echo "Started in screen 'visualizer'. Attach with: screen -r visualizer"
echo "View log: tail -f $LOG_FILE"

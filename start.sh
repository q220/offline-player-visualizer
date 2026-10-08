#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/server.log"
# The hub's live world (level-name=newplayer, 26.x layout); hub/hub is the retired pre-February world
WORLD_PATH="${1:-/opt/mcme-network/bungee-mcme/servers-mcme/hub/newplayer/}"
PORT="${PORT:-9191}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="${BASE_URL:-/offlineplayerviewer/}"

# Stop existing instance
screen -S visualizer -X quit 2>/dev/null

# Build client
echo "Building client..."
BASE_URL="$BASE_URL" npx vite build

# Start server in screen, logging all output to file. Low CPU/IO priority so
# indexing ~500k player files never competes with the Minecraft servers.
echo "Starting server (log: $LOG_FILE)..."
echo "  World: $WORLD_PATH"
echo "  Listen: $HOST:$PORT"
screen -dmS visualizer bash -c "cd '$SCRIPT_DIR' && HOST=$HOST PORT=$PORT NODE_OPTIONS='--no-deprecation --no-warnings' nice -n 10 ionice -c2 -n7 stdbuf -oL npx tsx src/server/index.ts '$WORLD_PATH' 2>&1 | tee '$LOG_FILE'"
echo "Started in screen 'visualizer'. Attach with: screen -r visualizer"
echo "View log: tail -f $LOG_FILE"

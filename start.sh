#!/bin/bash
screen -dmS visualizer bash -c 'cd "$(dirname "$0")" && PORT=9191 NODE_OPTIONS="--no-deprecation" npx tsx src/server/index.ts /opt/mcme-network/bungee-mcme/servers-mcme/hub/hub/'
echo "Started in screen 'visualizer'. Attach with: screen -r visualizer"

# Minecraft Offline Player Visualizer

A web tool that reads a Minecraft Java Edition world folder, renders a top-down block map, and visualizes the locations of logged-off players as a heatmap overlay.

## Features

- **Block map rendering** - Top-down view of the world using 300+ Minecraft block colors
- **Player heatmap** - Density overlay with log-scale normalization and gaussian blur
- **Player search** - Search by name or UUID, fly to their location on the map
- **Dimension switching** - Toggle between Overworld, Nether, and End
- **Date filtering** - Filter players by last login date, re-render heatmap on the fly
- **Player dots** - Individual player markers appear when zoomed in
- **Index caching** - Player data is cached for instant restarts after first load

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

## Setup

```bash
# Clone the repo
git clone https://github.com/q220/offline-player-visualizer.git
cd offline-player-visualizer

# Install dependencies
npm install

# Build the client
npx vite build
```

## Usage

Point the server at your Minecraft world folder:

```bash
npx tsx src/server/index.ts /path/to/your/minecraft/world
```

Then open http://localhost:3000 in your browser.

### What happens at startup

1. Scans the world structure (dimensions, MC version from `level.dat`)
2. Indexes all players from `playerdata/*.dat` (cached to `.player-index-cache.json`)
3. Resolves player names from `usercache.json` if available
4. Renders a 1000x1000 block map PNG per dimension
5. Renders a heatmap PNG per dimension from player positions
6. Starts the web server

### Development mode

```bash
npm run dev
```

This runs the server (with hot reload via tsx) and the Vite dev server concurrently. The Vite dev server proxies API requests to the backend.

### Configuration

- **Port**: Set the `PORT` environment variable (default: `3000`)
- **World bounds**: Default is -500 to +500 on both X and Z axes (1000x1000 area). Edit `src/shared/constants.ts` to change.

## API

| Endpoint | Description |
|---|---|
| `GET /api/world-info` | World name, MC version, dimensions, player count, bounds |
| `GET /api/players?dimension=&after=&before=&limit=&offset=` | Paginated player list |
| `GET /api/players/search?q=<name>&limit=20` | Search players by name or UUID |
| `GET /api/players/:uuid` | Single player details |
| `GET /static/map-{dimension}.png` | Pre-rendered block map |
| `GET /static/heatmap-{dimension}.png` | Pre-rendered heatmap |
| `POST /api/heatmap/render` | Re-render heatmap with date filters |

## Tech Stack

- **Backend**: Fastify, TypeScript, sharp, prismarine-nbt, prismarine-provider-anvil
- **Frontend**: Leaflet.js (CRS.Simple), Vite, vanilla TypeScript

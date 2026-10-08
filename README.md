# Minecraft Offline Player Visualizer

A web tool that reads a Minecraft Java Edition world folder, renders a top-down block map, and visualizes the locations of logged-off players as a heatmap overlay.

## Features

- **Block map rendering** - Top-down view of the world using 300+ Minecraft block colors
- **Player heatmap** - Density overlay with log-scale normalization and gaussian blur
- **Player search** - Search by name or UUID, fly to their location on the map
- **Dimension switching** - Toggle between Overworld, Nether, and End
- **Date filtering** - Filter players by last login date, re-render heatmap on the fly
- **Player dots** - Individual player markers appear when zoomed in
- **Hub intro metrics** - New players since a date: finished the intro, stuck at the welcome screen or the compatibility check (from MCME-Introduction's `finishedPlayerList.uid` and room boxes in `locations.yml`; set `INTRO_DIR` if the plugin folder is not next to the world), single-session dropouts and a dropout heatmap
- **Incremental indexing** - After the first run only player files saved since the last start are parsed again
- **World formats** - Reads both the 26.1+ layout (`dimensions/`, `players/data/`) and the older one (`region/`, `DIM-1/`, `playerdata/`)

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

On MCME, `start.sh` runs it in a `screen` session named `visualizer` against the hub's world (`servers-mcme/hub/newplayer`), on `127.0.0.1:9191`, at low CPU and disk priority.

### What happens at startup

1. Scans the world structure (dimensions, MC version and spawn from `level.dat`)
2. Indexes players from `players/data/*.dat` (or `playerdata/`), reusing cached records for files whose mtime has not changed
3. Takes names from each file's `bukkit.lastKnownName`, falling back to `usercache.json` (which only keeps the last 1000 players)
4. Computes map bounds by flood-filling region files from spawn
5. Renders a heatmap per dimension for players online in the last 30 days
6. Starts the web server, then pre-renders a 512x512 tile per region in the background

Caches live in `.cache/<world>-<hash>/` (`players.json`, `tiles/`), one folder per world path. A tile is re-rendered when its region file is newer than the cached PNG. Nothing is written into the world folder.

"Last online" comes from `bukkit.lastPlayed` (or `Paper.LastSeen`), not the file mtime: on MCME about 330,000 player files share the mtime of a bulk copy on 2026-03-11.

### Development mode

```bash
npm run dev
```

This runs the server (with hot reload via tsx) and the Vite dev server concurrently. The Vite dev server proxies API requests to the backend.

### Configuration

- **Port**: Set the `PORT` environment variable (default: `3000`)
- **Host**: Set the `HOST` environment variable (default: `127.0.0.1`; use `0.0.0.0` to listen on all interfaces)
- **World bounds**: Computed from the region files connected to spawn, capped at 10000x10000 blocks

## API

| Endpoint | Description |
|---|---|
| `GET /api/world-info` | World name, MC version, dimensions, player count, bounds |
| `GET /api/players?dimension=&after=&before=&limit=&offset=` | Paginated player list |
| `GET /api/players/search?q=<name>&limit=20` | Search players by name or UUID |
| `GET /api/players/:uuid` | Single player details |
| `GET /api/players/clusters?dimension=&zoom=&minX=&maxX=&minZ=&maxZ=&after=&before=` | Players or clusters in a viewport |
| `GET /api/tiles/{dimension}/{tx}/{ty}.png` | Block map tile for one region |
| `POST /api/heatmap/render` | Render a heatmap with date filters, viewport or area |
| `POST /api/heatmap/dropout` | Render the dropout heatmap (single-session players since `cutoffDate`) |
| `GET /api/heatmaps/{id}/heatmap.png`, `/api/heatmaps/{id}/contours.json` | A rendered heatmap (the last 50 are kept in memory) |
| `GET /api/hub-metrics?since=` | Hub intro metrics for players who first joined after `since` |

## Tech Stack

- **Backend**: Fastify, TypeScript, sharp, prismarine-nbt (region files are read directly)
- **Frontend**: Leaflet.js (CRS.Simple), Vite, vanilla TypeScript

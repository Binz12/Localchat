# LocalChat

A real-time LAN/offline chat app for local WiFi networks — users join with an access code, pick a name and channel, then chat in real-time via WebSockets.

## Run & Operate

- **Start**: `npm start` (runs `node server.js` on port 5000)
- **Access code**: `67563`
- **No env vars required** — fully self-contained

## Stack

- **Runtime**: Node.js 20
- **Backend**: Plain `http` module + `ws` (WebSocket server)
- **Frontend**: Single `index.html` SPA (no build step)
- **Persistence**: `messages.json` (last 100 messages per channel), `uploads/` (images)

## Where things live

- `server.js` — HTTP + WebSocket server, image upload endpoint
- `index.html` — entire frontend (HTML + CSS + JS)
- `messages.json` — auto-created, persists chat history per channel
- `uploads/` — auto-created, stores uploaded image files

## Architecture decisions

- Single-file frontend (no framework, no build step) keeps the app portable and dependency-free
- WebSocket uses `wss://` automatically when page is served over HTTPS (Replit proxy)
- Access code is hardcoded (`67563`) — app is designed for trusted local/family use
- Images are uploaded via HTTP POST before being broadcast as WebSocket messages
- Server pings all clients every 25s to keep Safari connections alive

## Product

- Three chat channels: General, Kids, Adults
- Real-time messaging with emoji picker and image sharing (up to 5MB)
- Persistent message history (last 100 per channel) across server restarts
- Color-coded users, live user list sidebar, image lightbox viewer

## User preferences

_Populate as you build_

## Gotchas

- `ws` package must be installed (`npm install` / managed by Replit package manager)
- The server binds to `0.0.0.0` so it's accessible via Replit's proxy
- WebSocket URL is derived from `location.host` — works correctly through Replit's HTTPS proxy

## Pointers

- Workflows skill: `.local/skills/workflows/SKILL.md`
- Package management: `.local/skills/package-management/SKILL.md`

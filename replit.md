# LocalChat

LAN chat app — a small Node.js + WebSocket chat server with a single-page HTML client. Originally designed for local network use; now configured to run on Replit.

## Tech Stack

- Runtime: Node.js 20
- HTTP/WebSocket server: built-in `http` + `ws`
- Frontend: single static `index.html` (no build step)
- Storage: local files (`messages.json` for chat history, `uploads/` for image attachments)

## Project Structure

- `server.js` — HTTP + WebSocket server (serves the page, handles image uploads, broadcasts chat messages)
- `index.html` — full client UI
- `package.json` — dependencies and `npm start` script
- `messages.json` — auto-created persistent message log per channel
- `uploads/` — auto-created directory for uploaded images

## Running on Replit

- Workflow: `Start application` → `npm start`
- Server binds `0.0.0.0:5000` (the only port Replit's preview proxies)
- Access code (login): `67563`
- Channels: General, Kids, Adults

## Deployment

Configured as a `vm` deployment (always-on) because the server keeps in-memory connection state and persists files to local disk, which doesn't fit the stateless autoscale model.

- Production run command: `node server.js`

## Replit-Specific Changes

- Changed listening port from `3000` to `5000` so the Replit preview can proxy it.

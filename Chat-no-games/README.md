# LocalChat 💬 Only chat 

A real-time LAN chat app. Works entirely offline — no internet needed, just a local WiFi network.

## Features
- Real-time messaging over WebSockets
- Saves last 100 messages (persisted to `messages.json`)
- Auto-reconnects if connection drops
- Color-coded users with online list
- Works on any device on your network (phone, laptop, tablet)

## Setup

### Requirements
- [Node.js](https://nodejs.org) (v16 or newer)

### Install & Run

```bash
# 1. Go into the folder
cd localchat

# 2. Install the one dependency
npm install

# 3. Start the server
npm start
```

You'll see output like:
```
✅ LocalChat running!

   Local:   http://localhost:3000
   Network: http://192.168.1.42:3000
```

### Connect

- **On this machine**: open `http://localhost:3000`
- **Other devices on the same WiFi**: open the `Network:` URL shown above

That's it! No internet required after `npm install`.

## File Structure
```
localchat/
  server.js      ← Node.js server + WebSocket logic
  index.html     ← Chat UI (served by the server)
  package.json   ← Dependencies
  messages.json  ← Auto-created, stores last 100 messages
```

## Notes
- To change the port, edit `const PORT = 3000;` in `server.js`
- Messages persist across server restarts via `messages.json`
- Works on Windows, Mac, and Linux
- To edit the Passcode Edit line 426 in Index.html and in server.js at Line 9

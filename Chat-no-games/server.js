const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 5000;
const MAX_MESSAGES = 100;
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const ACCESS_CODE = '67563';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const CHANNELS = ['General', 'Kids', 'Adults'];

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Load saved messages per channel
let channelMessages = { General: [], Kids: [], Adults: [] };
if (fs.existsSync(MESSAGES_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    if (typeof saved === 'object' && !Array.isArray(saved)) {
      channelMessages = { ...channelMessages, ...saved };
    }
    console.log('Loaded saved messages.');
  } catch (e) {
    channelMessages = { General: [], Kids: [], Adults: [] };
  }
}

function saveMessages() {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(channelMessages, null, 2));
}

// Mime type check
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp'
};

// HTTP server — serves index.html, uploads, and handles image POSTs
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve main page
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading client'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // Serve uploaded images
  if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
    const filename = path.basename(req.url);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Image upload endpoint
  if (req.method === 'POST' && req.url === '/upload') {
    // Check access code from header
    const code = req.headers['x-access-code'];
    if (code !== ACCESS_CODE) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid access code' }));
      return;
    }

    const contentType = req.headers['content-type'] || '';
    const ext = ALLOWED_TYPES[contentType];
    if (!ext) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file type' }));
      return;
    }

    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_FILE_SIZE) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large (max 5MB)' }));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFile(filePath, Buffer.concat(chunks), err => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to save file' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: `/uploads/${filename}` }));
      });
    });

    req.on('error', () => {});
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// WebSocket server
const wss = new WebSocketServer({ server, perMessageDeflate: false });

// Ping all clients every 25s — keeps Safari alive
const pingInterval = setInterval(() => {
  for (const [client] of clients) {
    if (client.readyState === 1) {
      try { client.ping(); } catch (e) {}
    } else if (client.readyState > 1) {
      clients.delete(client);
    }
  }
}, 25000);

wss.on('close', () => clearInterval(pingInterval));

const clients = new Map();
const COLORS = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24',
  '#a78bfa', '#fb923c', '#38bdf8', '#f87171',
  '#4ade80', '#e879f9', '#facc15', '#2dd4bf'
];
let colorIndex = 0;

function broadcastToChannel(channel, data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const [client, user] of clients) {
    if (client !== exclude && user.channel === channel && client.readyState === 1) {
      client.send(msg);
    }
  }
}

function broadcastUserList(channel) {
  const users = Array.from(clients.values())
    .filter(u => u.channel === channel)
    .map(u => ({ name: u.name, color: u.color }));
  const payload = JSON.stringify({ type: 'users', users, channel });
  for (const [client, user] of clients) {
    if (user.channel === channel && client.readyState === 1) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  let user = null;

  ws.on('pong', () => {});

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'join') {
      if (String(data.code) !== ACCESS_CODE) {
        ws.send(JSON.stringify({ type: 'error', text: 'Invalid access code' }));
        return;
      }
      const name = (data.name || 'Anonymous').trim().slice(0, 24);
      const channel = CHANNELS.includes(data.channel) ? data.channel : 'General';
      const color = COLORS[colorIndex % COLORS.length];
      colorIndex++;
      user = { name, color, channel };
      clients.set(ws, user);

      ws.send(JSON.stringify({ type: 'history', messages: channelMessages[channel], channel }));
      broadcastToChannel(channel, { type: 'system', text: `${name} joined`, ts: Date.now(), channel });
      broadcastUserList(channel);

    } else if (data.type === 'switch_channel' && user) {
      const oldChannel = user.channel;
      const newChannel = CHANNELS.includes(data.channel) ? data.channel : 'General';
      if (oldChannel === newChannel) return;

      broadcastToChannel(oldChannel, { type: 'system', text: `${user.name} left`, ts: Date.now(), channel: oldChannel });
      user.channel = newChannel;
      broadcastUserList(oldChannel);

      ws.send(JSON.stringify({ type: 'history', messages: channelMessages[newChannel], channel: newChannel }));
      broadcastToChannel(newChannel, { type: 'system', text: `${user.name} joined`, ts: Date.now(), channel: newChannel });
      broadcastUserList(newChannel);

    } else if (data.type === 'message' && user) {
      const text = (data.text || '').trim().slice(0, 2000);
      if (!text) return;
      const msg = { type: 'message', name: user.name, color: user.color, text, ts: Date.now(), channel: user.channel };
      channelMessages[user.channel].push(msg);
      if (channelMessages[user.channel].length > MAX_MESSAGES) channelMessages[user.channel].shift();
      saveMessages();
      broadcastToChannel(user.channel, msg);

    } else if (data.type === 'image' && user) {
      // Image message — url was already uploaded via HTTP POST
      const url = (data.url || '').trim();
      if (!url.startsWith('/uploads/')) return;
      const msg = { type: 'image', name: user.name, color: user.color, url, ts: Date.now(), channel: user.channel };
      channelMessages[user.channel].push(msg);
      if (channelMessages[user.channel].length > MAX_MESSAGES) channelMessages[user.channel].shift();
      saveMessages();
      broadcastToChannel(user.channel, msg);

    } else if (data.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {}
    }
  });

  ws.on('close', () => {
    if (user) {
      clients.delete(ws);
      broadcastToChannel(user.channel, { type: 'system', text: `${user.name} left`, ts: Date.now(), channel: user.channel });
      broadcastUserList(user.channel);
    }
  });

  ws.on('error', () => { if (user) clients.delete(ws); });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ LocalChat running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Access code: ${ACCESS_CODE}`);
  try {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`   Network: http://${net.address}:${PORT}`);
        }
      }
    }
  } catch (e) {
    console.log(`   Network: http://<your-ip>:${PORT}`);
  }
  console.log(`\nImages saved to: ${UPLOADS_DIR}`);
  console.log(`Share the Network URL with others on your WiFi.\n`);
});

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = 3000;
const MAX_MESSAGES = 100;
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const ACCESS_CODE = "123";

const CHANNELS = ["General", "Kids", "Adults"];

// Load saved messages per channel
let channelMessages = { General: [], Kids: [], Adults: [] };
if (fs.existsSync(MESSAGES_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
    if (typeof saved === "object" && !Array.isArray(saved)) {
      channelMessages = { ...channelMessages, ...saved };
    }
    console.log(`Loaded saved messages.`);
  } catch (e) {
    channelMessages = { General: [], Kids: [], Adults: [] };
  }
}

function saveMessages() {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(channelMessages, null, 2));
}

// HTTP server
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Error loading client");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache",
        // Allow WebSocket upgrade from any origin on LAN
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocketServer({
  server,
  // Keep-alive ping every 25s — fixes Safari dropping connections in background
  clientTracking: true,
  perMessageDeflate: false, // disable compression, causes issues on some iOS versions
});

// Ping all clients every 25 seconds to keep connections alive (Safari drops idle WS)
const pingInterval = setInterval(() => {
  for (const [client] of clients) {
    if (client.readyState === 1) {
      try {
        client.ping();
      } catch (e) {}
    } else if (client.readyState > 1) {
      clients.delete(client);
    }
  }
}, 25000);

wss.on("close", () => clearInterval(pingInterval));

const clients = new Map();

const COLORS = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#fb923c",
  "#38bdf8",
  "#f87171",
  "#4ade80",
  "#e879f9",
  "#facc15",
  "#2dd4bf",
];
let colorIndex = 0;

function broadcastToChannel(channel, data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const [client, user] of clients) {
    if (
      client !== exclude &&
      user.channel === channel &&
      client.readyState === 1
    ) {
      client.send(msg);
    }
  }
}

function broadcastUserList(channel) {
  const users = Array.from(clients.values())
    .filter((u) => u.channel === channel)
    .map((u) => ({ name: u.name, color: u.color }));
  const payload = JSON.stringify({ type: "users", users, channel });
  for (const [client, user] of clients) {
    if (user.channel === channel && client.readyState === 1) {
      client.send(payload);
    }
  }
}

wss.on("connection", (ws) => {
  let user = null;

  // Handle pong responses (keep-alive)
  ws.on("pong", () => {});

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      if (String(data.code) !== ACCESS_CODE) {
        ws.send(JSON.stringify({ type: "error", text: "Invalid access code" }));
        return;
      }
      const name = (data.name || "Anonymous").trim().slice(0, 24);
      const channel = CHANNELS.includes(data.channel)
        ? data.channel
        : "General";
      const color = COLORS[colorIndex % COLORS.length];
      colorIndex++;
      user = { name, color, channel };
      clients.set(ws, user);

      ws.send(
        JSON.stringify({
          type: "history",
          messages: channelMessages[channel],
          channel,
        }),
      );
      const joinMsg = {
        type: "system",
        text: `${name} joined`,
        ts: Date.now(),
        channel,
      };
      broadcastToChannel(channel, joinMsg);
      broadcastUserList(channel);
    } else if (data.type === "switch_channel" && user) {
      const oldChannel = user.channel;
      const newChannel = CHANNELS.includes(data.channel)
        ? data.channel
        : "General";
      if (oldChannel === newChannel) return;

      broadcastToChannel(oldChannel, {
        type: "system",
        text: `${user.name} left`,
        ts: Date.now(),
        channel: oldChannel,
      });
      user.channel = newChannel;
      broadcastUserList(oldChannel);

      ws.send(
        JSON.stringify({
          type: "history",
          messages: channelMessages[newChannel],
          channel: newChannel,
        }),
      );
      broadcastToChannel(newChannel, {
        type: "system",
        text: `${user.name} joined`,
        ts: Date.now(),
        channel: newChannel,
      });
      broadcastUserList(newChannel);
    } else if (data.type === "message" && user) {
      const text = (data.text || "").trim().slice(0, 2000);
      if (!text) return;
      const msg = {
        type: "message",
        name: user.name,
        color: user.color,
        text,
        ts: Date.now(),
        channel: user.channel,
      };
      channelMessages[user.channel].push(msg);
      if (channelMessages[user.channel].length > MAX_MESSAGES)
        channelMessages[user.channel].shift();
      saveMessages();
      broadcastToChannel(user.channel, msg);
    } else if (data.type === "ping") {
      // Client-side keep-alive for Safari
      try {
        ws.send(JSON.stringify({ type: "pong" }));
      } catch (e) {}
    }
  });

  ws.on("close", () => {
    if (user) {
      clients.delete(ws);
      broadcastToChannel(user.channel, {
        type: "system",
        text: `${user.name} left`,
        ts: Date.now(),
        channel: user.channel,
      });
      broadcastUserList(user.channel);
    }
  });

  ws.on("error", () => {
    if (user) clients.delete(ws);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ LocalChat running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Access code: ${ACCESS_CODE}`);
  try {
    const { networkInterfaces } = require("os");
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) {
          console.log(`   Network: http://${net.address}:${PORT}`);
        }
      }
    }
  } catch (e) {
    console.log(`   Network: http://<your-ip>:${PORT}`);
    console.log(`   (Run 'hostname -I' to find your IP)`);
  }
  console.log(`\nShare the Network URL with others on your WiFi.\n`);
});

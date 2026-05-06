const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const MAX_MESSAGES = 100;
const MESSAGES_FILE  = path.join(__dirname, 'messages.json');
const UPLOADS_DIR    = path.join(__dirname, 'uploads');
const GAMEDATA_FILE  = path.join(__dirname, 'gamedata.json');
const ACCESS_CODE    = '123';

const MAX_FILE_SIZE  = 5 * 1024 * 1024;

const CHANNELS = ['General', 'Kids', 'Adults'];
const ALLOWED_TYPES = { 'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp' };

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ── Chat messages ──
let channelMessages = { General:[], Kids:[], Adults:[] };
if (fs.existsSync(MESSAGES_FILE)) {
  try {
    const s = JSON.parse(fs.readFileSync(MESSAGES_FILE,'utf8'));
    if (typeof s==='object' && !Array.isArray(s)) channelMessages = {...channelMessages,...s};
  } catch(e) {}
}
function saveMessages() { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(channelMessages,null,2)); }

// ── Game data (leaderboards + cookie saves) ──
let gameData = {
  leaderboards: { snake:[], minesweeper:[], spaceDefenders:[], twoZeroFourEight:[], coinFlip:[] },
  cookieClicker: {}  // name -> { cookies, buildings, upgrades }
};
if (fs.existsSync(GAMEDATA_FILE)) {
  try {
    const g = JSON.parse(fs.readFileSync(GAMEDATA_FILE,'utf8'));
    gameData = { ...gameData, ...g };
    // ensure all boards exist
    for (const k of Object.keys(gameData.leaderboards)) {
      if (!Array.isArray(gameData.leaderboards[k])) gameData.leaderboards[k] = [];
    }
  } catch(e) {}
}
function saveGameData() { fs.writeFileSync(GAMEDATA_FILE, JSON.stringify(gameData,null,2)); }

function addScore(board, name, score) {
  const lb = gameData.leaderboards[board];
  if (!lb) return;
  // Keep best score per player
  const existing = lb.findIndex(e => e.name === name);
  if (existing >= 0) {
    if (score > lb[existing].score) lb[existing] = { name, score, ts: Date.now() };
  } else {
    lb.push({ name, score, ts: Date.now() });
  }
  // Keep top 10
  lb.sort((a,b) => b.score - a.score);
  if (lb.length > 10) lb.splice(10);
  saveGameData();
}

// ── Tic Tac Toe lobbies ──
// lobbyId -> { id, host, guest, hostWs, guestWs, board, turn, status }
const tttLobbies = new Map();
let lobbyCounter = 1;

function tttBroadcast(lobby, msg) {
  const s = JSON.stringify(msg);
  if (lobby.hostWs  && lobby.hostWs.readyState  === 1) lobby.hostWs.send(s);
  if (lobby.guestWs && lobby.guestWs.readyState === 1) lobby.guestWs.send(s);
}

function checkWinner(board) {
  const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of wins) {
    if (board[a] && board[a]===board[b] && board[a]===board[c]) return board[a];
  }
  if (board.every(Boolean)) return 'draw';
  return null;
}

function sendLobbyList(ws) {
  const list = Array.from(tttLobbies.values())
    .filter(l => l.status === 'waiting')
    .map(l => ({ id:l.id, host:l.host }));
  ws.send(JSON.stringify({ type:'ttt_lobby_list', lobbies:list }));
}

function broadcastLobbyList() {
  for (const [client, user] of clients) {
    if (user.isGames && client.readyState === 1) {
      sendLobbyList(client);
    }
  }
}

// ── HTTP ──
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');

  if (req.method==='GET' && (req.url==='/' || req.url==='/index.html')) {
    return serveFile(res, path.join(__dirname,'index.html'),'text/html');
  }

  if (req.method==='GET' && req.url.startsWith('/uploads/')) {
    const filename = path.basename(req.url);
    const fp = path.join(UPLOADS_DIR,filename);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp'};
    res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'max-age=86400'});
    return fs.createReadStream(fp).pipe(res);
  }
  if (req.method==='POST' && req.url==='/upload') {
    const code = req.headers['x-access-code'];
    if (code !== ACCESS_CODE) { return jsonRes(res,403,{error:'Invalid access code'}); }
    const ext = ALLOWED_TYPES[req.headers['content-type']||''];
    if (!ext) return jsonRes(res,400,{error:'Invalid file type'});
    const chunks=[]; let size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>MAX_FILE_SIZE){ req.destroy(); return jsonRes(res,413,{error:'Too large'}); }
      chunks.push(chunk);
    });
    req.on('end',()=>{
      const filename=`${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      fs.writeFile(path.join(UPLOADS_DIR,filename),Buffer.concat(chunks),err=>{
        if(err) return jsonRes(res,500,{error:'Save failed'});
        jsonRes(res,200,{url:`/uploads/${filename}`});
      });
    });
    req.on('error',()=>{});
    return;
  }
  res.writeHead(404); res.end('Not found');
});

function serveFile(res, fp, ct) {
  fs.readFile(fp,(err,data)=>{
    if(err){ res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200,{'Content-Type':ct,'Cache-Control':'no-cache'});
    res.end(data);
  });
}
function jsonRes(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); }

// ── WebSocket ──
const wss = new WebSocketServer({ server, perMessageDeflate:false });

setInterval(()=>{
  for(const[client] of clients){
    if(client.readyState===1){ try{client.ping();}catch(e){} }
    else if(client.readyState>1){ clients.delete(client); }
  }
},25000);

const clients = new Map();
const COLORS=['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#f87171','#4ade80','#e879f9','#facc15','#2dd4bf'];
let colorIndex=0;

function broadcastToChannel(channel,data,exclude=null){
  const msg=JSON.stringify(data);
  for(const[client,user] of clients){
    if(client!==exclude && user.channel===channel && client.readyState===1) client.send(msg);
  }
}
function broadcastUserList(channel){
  const users=Array.from(clients.values()).filter(u=>u.channel===channel).map(u=>({name:u.name,color:u.color}));
  const payload=JSON.stringify({type:'users',users,channel});
  for(const[client,user] of clients){
    if(user.channel===channel && client.readyState===1) client.send(payload);
  }
}

wss.on('connection', ws => {
  let user = null;
  ws.on('pong',()=>{});

  ws.on('message', raw => {
    let data; try{ data=JSON.parse(raw.toString()); }catch{ return; }

    // ── GAMES CLIENT ──
    if (data.type === 'games_join') {
      if (String(data.code) !== ACCESS_CODE) {
        ws.send(JSON.stringify({type:'error',text:'Invalid access code'})); return;
      }
      const name = (data.name||'Player').trim().slice(0,24);
      user = { name, isGames:true, channel:'__games__' };
      clients.set(ws, user);
      // Send all leaderboards + cookie data for this player
      ws.send(JSON.stringify({ type:'games_init', leaderboards:gameData.leaderboards, cookieData: gameData.cookieClicker[name]||null }));
      sendLobbyList(ws);
      return;
    }

    // ── GAME: submit score ──
    if (data.type === 'submit_score' && user?.isGames) {
      const { game, score } = data;
      if (!gameData.leaderboards[game]) return;
      addScore(game, user.name, score);
      // Broadcast updated leaderboard to all game clients
      for(const[client,u] of clients){
        if(u.isGames && client.readyState===1){
          client.send(JSON.stringify({type:'leaderboard_update',game,board:gameData.leaderboards[game]}));
        }
      }
      return;
    }

    // ── GAME: cookie clicker save ──
    if (data.type === 'cookie_save' && user?.isGames) {
      gameData.cookieClicker[user.name] = data.save;
      saveGameData();
      return;
    }

    // ── GAME: TTT create lobby ──
    if (data.type === 'ttt_create' && user?.isGames) {
      const id = `lobby_${lobbyCounter++}`;
      const lobby = { id, host:user.name, guest:null, hostWs:ws, guestWs:null, board:Array(9).fill(null), turn:'X', status:'waiting' };
      tttLobbies.set(id, lobby);
      ws.send(JSON.stringify({type:'ttt_created',lobbyId:id}));
      broadcastLobbyList();
      return;
    }

    // ── GAME: TTT join lobby ──
    if (data.type === 'ttt_join' && user?.isGames) {
      const lobby = tttLobbies.get(data.lobbyId);
      if (!lobby || lobby.status !== 'waiting') {
        ws.send(JSON.stringify({type:'error',text:'Lobby not available'})); return;
      }
      if (lobby.host === user.name) {
        ws.send(JSON.stringify({type:'error',text:'Cannot join your own lobby'})); return;
      }
      lobby.guest = user.name;
      lobby.guestWs = ws;
      lobby.status = 'playing';
      tttBroadcast(lobby, { type:'ttt_start', lobbyId:lobby.id, host:lobby.host, guest:lobby.guest, board:lobby.board, turn:lobby.turn });
      broadcastLobbyList();
      return;
    }

    // ── GAME: TTT move ──
    if (data.type === 'ttt_move' && user?.isGames) {
      const lobby = tttLobbies.get(data.lobbyId);
      if (!lobby || lobby.status !== 'playing') return;
      const isHost  = user.name === lobby.host;
      const isGuest = user.name === lobby.guest;
      if (!isHost && !isGuest) return;
      const mySymbol = isHost ? 'X' : 'O';
      if (lobby.turn !== mySymbol) return;
      if (lobby.board[data.cell] !== null) return;
      lobby.board[data.cell] = mySymbol;
      const winner = checkWinner(lobby.board);
      lobby.turn = lobby.turn === 'X' ? 'O' : 'X';
      if (winner) {
        lobby.status = 'done';
        tttBroadcast(lobby, { type:'ttt_update', board:lobby.board, turn:lobby.turn, winner });
        // Submit scores
        if (winner !== 'draw') {
          const winnerName = winner === 'X' ? lobby.host : lobby.guest;
          addScore('coinFlip', winnerName, 1); // reuse a board or add ttt
        }
        tttLobbies.delete(lobby.id);
        broadcastLobbyList();
      } else {
        tttBroadcast(lobby, { type:'ttt_update', board:lobby.board, turn:lobby.turn, winner:null });
      }
      return;
    }

    // ── GAME: TTT leave lobby ──
    if (data.type === 'ttt_leave' && user?.isGames) {
      for (const [id, lobby] of tttLobbies) {
        if (lobby.host === user.name || lobby.guest === user.name) {
          tttBroadcast(lobby, { type:'ttt_abandoned', reason:`${user.name} left` });
          tttLobbies.delete(id);
          broadcastLobbyList();
          break;
        }
      }
      return;
    }

    // ── CHAT CLIENT ──
    if (data.type === 'join') {
      if (String(data.code) !== ACCESS_CODE) {
        ws.send(JSON.stringify({type:'error',text:'Invalid access code'})); return;
      }
      const name=(data.name||'Anonymous').trim().slice(0,24);
      const channel=CHANNELS.includes(data.channel)?data.channel:'General';
      const color=COLORS[colorIndex%COLORS.length]; colorIndex++;
      user={name,color,channel,isGames:false};
      clients.set(ws,user);
      ws.send(JSON.stringify({type:'history',messages:channelMessages[channel],channel}));
      broadcastToChannel(channel,{type:'system',text:`${name} joined`,ts:Date.now(),channel});
      broadcastUserList(channel);

    } else if (data.type==='switch_channel' && user && !user.isGames) {
      const old=user.channel, nch=CHANNELS.includes(data.channel)?data.channel:'General';
      if(old===nch) return;
      broadcastToChannel(old,{type:'system',text:`${user.name} left`,ts:Date.now(),channel:old});
      user.channel=nch; broadcastUserList(old);
      ws.send(JSON.stringify({type:'history',messages:channelMessages[nch],channel:nch}));
      broadcastToChannel(nch,{type:'system',text:`${user.name} joined`,ts:Date.now(),channel:nch});
      broadcastUserList(nch);

    } else if (data.type==='message' && user && !user.isGames) {
      const text=(data.text||'').trim().slice(0,2000); if(!text) return;
      const msg={type:'message',name:user.name,color:user.color,text,ts:Date.now(),channel:user.channel};
      channelMessages[user.channel].push(msg);
      if(channelMessages[user.channel].length>MAX_MESSAGES) channelMessages[user.channel].shift();
      saveMessages(); broadcastToChannel(user.channel,msg);

    } else if (data.type==='image' && user && !user.isGames) {
      const url=(data.url||'').trim(); if(!url.startsWith('/uploads/')) return;
      const msg={type:'image',name:user.name,color:user.color,url,ts:Date.now(),channel:user.channel};
      channelMessages[user.channel].push(msg);
      if(channelMessages[user.channel].length>MAX_MESSAGES) channelMessages[user.channel].shift();
      saveMessages(); broadcastToChannel(user.channel,msg);

    } else if (data.type==='ping') {
      try{ ws.send(JSON.stringify({type:'pong'})); }catch(e){}
    }
  });

  ws.on('close', ()=>{
    if(!user) return;
    clients.delete(ws);
    if (user.isGames) {
      // Clean up any TTT lobbies
      for (const [id,lobby] of tttLobbies) {
        if (lobby.host===user.name || lobby.guest===user.name) {
          tttBroadcast(lobby,{type:'ttt_abandoned',reason:`${user.name} disconnected`});
          tttLobbies.delete(id);
          broadcastLobbyList();
          break;
        }
      }
    } else {
      broadcastToChannel(user.channel,{type:'system',text:`${user.name} left`,ts:Date.now(),channel:user.channel});
      broadcastUserList(user.channel);
    }
  });

  ws.on('error',()=>{ if(user) clients.delete(ws); });
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n✅ LocalChat + Games running!`);
  console.log(`   Chat:  http://localhost:${PORT}  (code: ${ACCESS_CODE})`);

  try {
    const {networkInterfaces}=require('os'), nets=networkInterfaces();
    for(const name of Object.keys(nets)) for(const net of nets[name])
      if(net.family==='IPv4'&&!net.internal) console.log(`   Network: http://${net.address}:${PORT}`);
  } catch(e){ console.log(`   Network: http://<your-ip>:${PORT}`); }
  console.log();
});

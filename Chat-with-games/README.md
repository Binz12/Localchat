# LocalChat 💬

Real-time chat over LAN or internet. Works offline, no internet needed.

## Features
- Access code protected (default: 67563)
- 3 channels: General, Kids, Adults
- Image sending (upload + paste)
- Emoji picker
- Saves last 100 messages per channel
- Works on all devices including iPhone

## Setup

```bash
npm install
npm start
```

## Notes
- Change access code: edit `ACCESS_CODE` in server.js (line 9) and line 426 in index.html
- Change port: edit `PORT` in server.js (line 6)
- Images saved to ./uploads/
- Keep server running with pm2: `npm install -g pm2 && pm2 start server.js --name localchat && pm2 save && pm2 startup`

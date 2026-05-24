const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.png':  'image/png',
    '.gif':  'image/gif',
    '.glb':  'model/gltf-binary',
    '.m4a':  'audio/mp4',
    '.json': 'application/json',
};

const rooms   = new Map(); // roomId -> { worldName, seeds, deltaMap, gameTime, hostId }
const clients = new Map(); // id -> { ws, id, username, roomId, isHost, pos, yaw }
let nextId = 1;

function makeRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return rooms.has(id) ? makeRoomId() : id;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (urlPath === '/api/rooms') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const list = [...rooms.entries()].map(([id, r]) => ({
            id,
            worldName:   r.worldName,
            playerCount: [...clients.values()].filter(c => c.roomId === id).length,
        }));
        res.end(JSON.stringify(list));
        return;
    }

    const filePath = path.normalize(
        path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath)
    );

    if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, 'index.html')) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastToRoom(roomId, msg, excludeId = null) {
    const str = JSON.stringify(msg);
    for (const c of clients.values()) {
        if (c.roomId === roomId && c.id !== excludeId && c.ws.readyState === 1)
            c.ws.send(str);
    }
}

function playersInRoom(roomId, excludeId) {
    return [...clients.values()]
        .filter(c => c.roomId === roomId && c.id !== excludeId)
        .map(c => ({ id: c.id, username: c.username, pos: c.pos, yaw: c.yaw }));
}

wss.on('connection', ws => {
    const id = nextId++;

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            case 'host_open': {
                const rid = makeRoomId();
                const dm  = new Map();
                for (const d of (msg.deltas ?? [])) dm.set(`${d.x},${d.y},${d.z}`, d);
                rooms.set(rid, { worldName: msg.worldName, seeds: msg.seeds, deltaMap: dm, gameTime: msg.gameTime, hostId: id });
                clients.set(id, { ws, id, username: msg.username, roomId: rid, isHost: true, pos: msg.pos, yaw: 0 });
                send(ws, { type: 'room_created', roomId: rid });
                console.log(`[Room ${rid}] "${msg.worldName}" opened by ${msg.username}`);
                break;
            }

            case 'join_room': {
                const room = rooms.get(msg.roomId);
                if (!room) { send(ws, { type: 'error', message: 'Room not found' }); break; }
                clients.set(id, { ws, id, username: msg.username, roomId: msg.roomId, isHost: false, pos: null, yaw: 0 });
                broadcastToRoom(msg.roomId, { type: 'player_join', id, username: msg.username }, id);
                send(ws, {
                    type:      'world_state',
                    worldName: room.worldName,
                    seeds:     room.seeds,
                    deltas:    [...room.deltaMap.values()],
                    gameTime:  room.gameTime,
                    players:   playersInRoom(msg.roomId, id),
                });
                console.log(`[Room ${msg.roomId}] ${msg.username} joined`);
                break;
            }

            case 'position': {
                const c = clients.get(id);
                if (!c?.roomId) break;
                c.pos = msg.pos; c.yaw = msg.yaw;
                broadcastToRoom(c.roomId, { type: 'player_move', id, pos: msg.pos, yaw: msg.yaw }, id);
                break;
            }

            case 'block_change': {
                const c = clients.get(id);
                if (!c?.roomId) break;
                const room = rooms.get(c.roomId);
                if (room) {
                    const key = `${msg.x},${msg.y},${msg.z}`;
                    if (msg.v === 0) room.deltaMap.delete(key);
                    else room.deltaMap.set(key, { x: msg.x, y: msg.y, z: msg.z, v: msg.v });
                }
                broadcastToRoom(c.roomId, { type: 'block_change', x: msg.x, y: msg.y, z: msg.z, v: msg.v }, id);
                break;
            }
        }
    });

    ws.on('close', () => {
        const c = clients.get(id);
        clients.delete(id);
        if (!c?.roomId) return;
        if (c.isHost) {
            rooms.delete(c.roomId);
            broadcastToRoom(c.roomId, { type: 'host_left' });
            console.log(`[Room ${c.roomId}] Host left — room closed`);
        } else {
            broadcastToRoom(c.roomId, { type: 'player_leave', id });
        }
    });
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
    const os   = require('os');
    const nets = os.networkInterfaces();
    let lanIP  = null;
    for (const addrs of Object.values(nets)) {
        for (const a of addrs) {
            if (a.family === 'IPv4' && !a.internal) { lanIP = a.address; break; }
        }
        if (lanIP) break;
    }

    console.log('\nVenture Vessel server');
    console.log(`  Local:  http://localhost:${PORT}`);
    if (lanIP) console.log(`  LAN:    http://${lanIP}:${PORT}`);
    console.log('\nDeploy to Railway for public access: https://railway.app\n');
});

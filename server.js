const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;

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

// World state set when the host opens to LAN
let serverState = null; // { worldName, seeds, deltaMap, gameTime }

const clients = new Map(); // id -> { ws, id, username, isHost, pos, yaw, pitch }
let nextId = 1;

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (urlPath === '/api/server-info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(
            serverState
                ? { available: true, worldName: serverState.worldName }
                : { available: false }
        ));
        return;
    }

    const filePath = path.normalize(
        path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath)
    );

    // Prevent directory traversal
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

function broadcast(msg, excludeWs = null) {
    const str = JSON.stringify(msg);
    for (const c of clients.values()) {
        if (c.ws !== excludeWs && c.ws.readyState === 1) c.ws.send(str);
    }
}

function playerList(excludeId) {
    return [...clients.values()]
        .filter(c => c.id !== excludeId)
        .map(c => ({ id: c.id, username: c.username, pos: c.pos, yaw: c.yaw }));
}

function worldStateMsg(forId) {
    return {
        type: 'world_state',
        worldName: serverState.worldName,
        seeds:     serverState.seeds,
        deltas:    [...serverState.deltaMap.values()],
        gameTime:  serverState.gameTime,
        players:   playerList(forId),
    };
}

wss.on('connection', ws => {
    const id = nextId++;

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            case 'host_open': {
                const dm = new Map();
                for (const d of (msg.deltas ?? [])) dm.set(`${d.x},${d.y},${d.z}`, d);
                serverState = { worldName: msg.worldName, seeds: msg.seeds, deltaMap: dm, gameTime: msg.gameTime };

                clients.set(id, { ws, id, username: msg.username, isHost: true, pos: msg.pos, yaw: 0 });

                // Send world state to any clients already waiting
                for (const c of clients.values()) {
                    if (c.id !== id) send(c.ws, worldStateMsg(c.id));
                }

                console.log(`[LAN] "${msg.worldName}" opened by ${msg.username}`);
                break;
            }

            case 'join': {
                clients.set(id, { ws, id, username: msg.username, isHost: false, pos: null, yaw: 0 });
                // Tell others a new player joined
                broadcast({ type: 'player_join', id, username: msg.username }, ws);
                // If world is already open, send state immediately
                if (serverState) send(ws, worldStateMsg(id));
                break;
            }

            case 'position': {
                const c = clients.get(id);
                if (c) { c.pos = msg.pos; c.yaw = msg.yaw; }
                broadcast({ type: 'player_move', id, pos: msg.pos, yaw: msg.yaw }, ws);
                break;
            }

            case 'block_change': {
                if (serverState) {
                    serverState.deltaMap.set(`${msg.x},${msg.y},${msg.z}`, { x: msg.x, y: msg.y, z: msg.z, v: msg.v });
                    if (msg.v === 0) serverState.deltaMap.delete(`${msg.x},${msg.y},${msg.z}`);
                }
                broadcast({ type: 'block_change', x: msg.x, y: msg.y, z: msg.z, v: msg.v }, ws);
                break;
            }
        }
    });

    ws.on('close', () => {
        const c = clients.get(id);
        clients.delete(id);
        if (!c) return;
        broadcast({ type: 'player_leave', id });
        if (c.isHost) {
            serverState = null;
            broadcast({ type: 'host_left' });
            console.log('[LAN] Host disconnected — world closed');
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

    console.log('\nVenture Vessel LAN server');
    console.log(`  Local:  http://localhost:${PORT}`);
    if (lanIP) console.log(`  LAN:    http://${lanIP}:${PORT}`);
    console.log('\nLoad the game in a browser, then press ` and choose "Open to LAN".\n');
});

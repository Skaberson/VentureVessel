export class NetworkManager {
    constructor() {
        this.ws        = null;
        this.connected = false;
        this.isHost    = false;

        this.onWorldState  = null; // (data) => void
        this.onBlockChange = null; // (x, y, z, v) => void
        this.onPlayerJoin  = null; // (id, username) => void
        this.onPlayerLeave = null; // (id) => void
        this.onPlayerMove  = null; // (id, pos, yaw) => void
        this.onHostLeft    = null; // () => void
        this.onError       = null; // (message) => void

        this._posTimer    = 0;
        this._roomResolve = null;
    }

    connect(url) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            this.ws  = ws;

            ws.addEventListener('open', () => {
                this.connected = true;
                resolve();
            });

            ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')));

            ws.addEventListener('message', e => {
                let msg; try { msg = JSON.parse(e.data); } catch { return; }
                this._handle(msg);
            });

            ws.addEventListener('close', () => {
                this.connected = false;
                if (this.onHostLeft) this.onHostLeft();
            });
        });
    }

    // Sends host_open, resolves with the room code once server confirms.
    hostWorld(username, worldName, seeds, deltas, gameTime, pos) {
        return new Promise(resolve => {
            this._roomResolve = resolve;
            this.isHost = true;
            this.ws.send(JSON.stringify({ type: 'host_open', username, worldName, seeds, deltas, gameTime, pos }));
        });
    }

    joinRoom(roomId, username) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'join_room', roomId, username }));
    }

    sendBlockChange(x, y, z, v) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'block_change', x, y, z, v }));
    }

    tickPositionBroadcast(dt, pos, yaw, pitch) {
        this._posTimer += dt;
        if (this._posTimer < 0.05) return; // 20 Hz
        this._posTimer = 0;
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'position', pos: { x: pos.x, y: pos.y, z: pos.z }, yaw, pitch }));
    }

    disconnect() {
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.connected = false;
        this.isHost    = false;
    }

    _handle(msg) {
        switch (msg.type) {
            case 'room_created': if (this._roomResolve) { this._roomResolve(msg.roomId); this._roomResolve = null; } break;
            case 'world_state':  if (this.onWorldState)  this.onWorldState(msg);                         break;
            case 'block_change': if (this.onBlockChange) this.onBlockChange(msg.x, msg.y, msg.z, msg.v); break;
            case 'player_join':  if (this.onPlayerJoin)  this.onPlayerJoin(msg.id, msg.username);         break;
            case 'player_leave': if (this.onPlayerLeave) this.onPlayerLeave(msg.id);                      break;
            case 'player_move':  if (this.onPlayerMove)  this.onPlayerMove(msg.id, msg.pos, msg.yaw, msg.pitch);     break;
            case 'host_left':    if (this.onHostLeft)    this.onHostLeft();                                break;
            case 'error':        if (this.onError)       this.onError(msg.message);                       break;
        }
    }
}

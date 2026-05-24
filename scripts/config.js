// ── Server connection config ───────────────────────────────────────────────────
// For local dev this auto-detects localhost.
// After deploying to Railway/Render, replace the string below with your app URL
// (e.g. 'my-game.up.railway.app') and push to GitHub Pages.

const _dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const _host = _dev ? `${location.hostname}:3000` : 'YOUR-APP.up.railway.app';
const _scheme = location.protocol === 'https:';

export const HTTP_URL = (_scheme ? 'https://' : 'http://') + _host;
export const WS_URL   = (_scheme ? 'wss://'  : 'ws://')   + _host;

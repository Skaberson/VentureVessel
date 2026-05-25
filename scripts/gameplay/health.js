const MAX_HEALTH = 9;

let playerHealth      = MAX_HEALTH;
let healthRegenTimer  = 0;
let damageCooldown    = 0;
let fallStartY        = null;
let prevPlayerOnGround = false;
let isDead            = false;
let deathPhase        = null;
let deathTimer        = 0;
let vignetteOpacity   = 0;
let vignetteFadeRate  = 0;

let _player, _getIsFlying, _setIsFlying, _getSlimes, _placeGravestone;
let _inventory, _mainInventory, _getSelectedSlot, _setSelectedSlot, _updateInventoryUI;
let _shake, _onRebirth;

const heartHUD = document.createElement('div');
heartHUD.style.cssText = 'position:fixed;top:16px;right:16px;display:flex;flex-direction:row-reverse;gap:3px;pointer-events:none;z-index:1000;';
document.body.appendChild(heartHUD);

{
    const s = document.createElement('style');
    s.textContent = '@keyframes heart-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}';
    document.head.appendChild(s);
}

const heartImgs = [];
for (let i = 0; i < MAX_HEALTH; i++) {
    const img = document.createElement('img');
    img.style.cssText = 'width:56px;height:56px;image-rendering:pixelated;';
    img.src = 'assets/textures/heart.png';
    heartHUD.appendChild(img);
    heartImgs.push(img);
}

const vignetteCanvas = document.createElement('canvas');
vignetteCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1500;opacity:0;';
document.body.appendChild(vignetteCanvas);

const deathScreen = document.createElement('div');
deathScreen.style.cssText = 'position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:28px;z-index:3000;pointer-events:auto;';
document.body.appendChild(deathScreen);

const deathBlackout = document.createElement('div');
deathBlackout.style.cssText = 'position:fixed;inset:0;background:black;opacity:0;z-index:2900;pointer-events:none;transition:none;';
document.body.appendChild(deathBlackout);

const deathTitle = document.createElement('div');
deathTitle.textContent = 'END OF LIFE';
deathTitle.style.cssText = 'color:#cc0000;font:bold 64px monospace;text-shadow:0 0 24px #ff0000,0 0 6px #ff0000;letter-spacing:8px;user-select:none;';
deathScreen.appendChild(deathTitle);

const rebirthBtn = document.createElement('button');
rebirthBtn.textContent = 'REBIRTH';
rebirthBtn.style.cssText = 'background:none;border:2px solid #cc0000;color:#cc0000;font:bold 28px monospace;letter-spacing:4px;padding:14px 40px;cursor:pointer;transition:background 0.15s,color 0.15s;';
rebirthBtn.onmouseenter = () => { rebirthBtn.style.background = '#cc0000'; rebirthBtn.style.color = '#000'; };
rebirthBtn.onmouseleave = () => { rebirthBtn.style.background = 'none';    rebirthBtn.style.color = '#cc0000'; };
deathScreen.appendChild(rebirthBtn);

rebirthBtn.addEventListener('click', () => {
    isDead = false;
    deathPhase = null;
    deathScreen.style.display = 'none';
    deathBlackout.style.opacity = '0';
    vignetteOpacity = 0;
    vignetteCanvas.style.opacity = '0';

    for (let i = 0; i < 9;  i++) _inventory[i]    = null;
    for (let i = 0; i < 27; i++) _mainInventory[i] = null;
    _setSelectedSlot(0);
    _updateInventoryUI();

    playerHealth = MAX_HEALTH;
    damageCooldown = 0;
    healthRegenTimer = 0;
    fallStartY = null;
    updateHeartHUD();

    _player.vel.set(0, 0, 0);
    _player.yaw = 0; _player.pitch = 0;
    _setIsFlying(false);

    _onRebirth?.();

    document.body.requestPointerLock?.();
});

window.addEventListener('resize', () => { if (vignetteOpacity > 0) _drawVignette(); });

export function initHealth(ctx) {
    _player           = ctx.player;
    _getIsFlying      = ctx.getIsFlying;
    _setIsFlying      = ctx.setIsFlying;
    _getSlimes        = ctx.getSlimes;
    _placeGravestone  = ctx.placeGravestone;
    _inventory        = ctx.inventory;
    _mainInventory    = ctx.mainInventory;
    _getSelectedSlot  = ctx.getSelectedSlot;
    _setSelectedSlot  = ctx.setSelectedSlot;
    _updateInventoryUI = ctx.updateInventoryUI;
    _shake            = ctx.shake;
    _onRebirth        = ctx.onRebirth;

    updateHeartHUD();
}

export function getPlayerHealth() { return playerHealth; }
export function getIsDead() { return isDead; }

function updateHeartHUD() {
    for (let i = 0; i < MAX_HEALTH; i++) {
        const full = i < playerHealth;
        heartImgs[i].src = full
            ? 'assets/textures/heart.png'
            : 'assets/textures/damaged_heart.png';
        const isPulse = full && i === playerHealth - 1;
        heartImgs[i].style.animation = isPulse ? 'heart-pulse 1s ease-in-out infinite' : '';
    }
}

function _drawVignette() {
    const w = window.innerWidth, h = window.innerHeight;
    vignetteCanvas.width  = w;
    vignetteCanvas.height = h;
    const ctx = vignetteCanvas.getContext('2d');
    const cx = w * 0.5, cy = h * 0.5;
    const r  = Math.sqrt(cx * cx + cy * cy);
    const grd = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    grd.addColorStop(0, 'rgba(180,0,0,0)');
    grd.addColorStop(1, 'rgba(180,0,0,1)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
}

export function triggerDamageVignette(amount) {
    _drawVignette();
    vignetteOpacity = 1;
    vignetteCanvas.style.opacity = '1';
    vignetteFadeRate = 1 / (0.4 + amount * 0.35);
    _shake.amount = Math.min(0.01 + amount * 0.018, 0.08);
}

function triggerDeath() {
    if (isDead) return;
    isDead = true;

    const hotbarSnap = _inventory.map(s => s ? { ...s } : null);
    const mainSnap   = _mainInventory.map(s => s ? { ...s } : null);

    _placeGravestone(hotbarSnap, mainSnap, _player.pos.x, _player.pos.y, _player.pos.z);

    _drawVignette();
    vignetteOpacity = 0;
    vignetteCanvas.style.opacity = '0';
    deathPhase = 'vignette-in';
    deathTimer  = 0;
    deathBlackout.style.opacity = '0';
    deathScreen.style.display = 'none';

    document.exitPointerLock?.();
}

export function damagePlayer(amount) {
    if (damageCooldown > 0 || isDead) return;
    playerHealth = Math.max(0, playerHealth - amount);
    damageCooldown = 0.8;
    updateHeartHUD();
    if (playerHealth <= 0) {
        triggerDeath();
    } else {
        triggerDamageVignette(amount);
    }
}

export function updateHealth(dt) {
    if (!_player || isDead) return;

    if (damageCooldown > 0) damageCooldown -= dt;

    if (playerHealth < MAX_HEALTH) {
        healthRegenTimer += dt;
        if (healthRegenTimer >= 10) {
            playerHealth = Math.min(MAX_HEALTH, playerHealth + 1);
            healthRegenTimer = 0;
            updateHeartHUD();
        }
    } else {
        healthRegenTimer = 0;
    }

    const nowOnGround = _player.onGround;
    if (!nowOnGround && !_getIsFlying()) {
        if (_player.vel.y < 0) {
            if (fallStartY === null) fallStartY = _player.pos.y;
        }
    }
    if (nowOnGround && !prevPlayerOnGround && fallStartY !== null) {
        const fallDist = fallStartY - _player.pos.y;
        if (fallDist > 7) {
            const hearts = 1 + Math.floor((fallDist - 7) / 10);
            damagePlayer(hearts);
        }
        fallStartY = null;
    }
    if (nowOnGround || _getIsFlying()) fallStartY = null;

    prevPlayerOnGround = nowOnGround;

    if (damageCooldown <= 0) {
        const SLIME_HIT_DIST = 1.2;
        for (const s of _getSlimes()) {
            const dx = s.pos.x - _player.pos.x;
            const dy = s.pos.y - _player.pos.y;
            const dz = s.pos.z - _player.pos.z;
            if (Math.sqrt(dx*dx + dy*dy + dz*dz) < SLIME_HIT_DIST) {
                damagePlayer(1);
                break;
            }
        }
    }
}

export function updateVignette(dt) {
    if (isDead) return;
    if (vignetteOpacity <= 0) return;
    vignetteOpacity = Math.max(0, vignetteOpacity - vignetteFadeRate * dt);
    vignetteCanvas.style.opacity = vignetteOpacity.toFixed(4);
    if (vignetteOpacity > 0) _shake.time += dt;
}

export function updateDeathSequence(dt) {
    if (!isDead || !deathPhase) return;

    if (deathPhase === 'vignette-in') {
        deathTimer += dt;
        vignetteOpacity = Math.min(deathTimer / 1.2, 1);
        vignetteCanvas.style.opacity = vignetteOpacity.toFixed(4);
        if (vignetteOpacity >= 1) { deathPhase = 'blackout'; deathTimer = 0; }

    } else if (deathPhase === 'blackout') {
        deathTimer += dt;
        const t = Math.min(deathTimer / 1.0, 1);
        deathBlackout.style.opacity = t.toFixed(4);
        if (t >= 1) { deathPhase = 'screen'; deathScreen.style.display = 'flex'; }
    }
}

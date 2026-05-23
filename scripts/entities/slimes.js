import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sampleDensity } from '../player/player.js';
import { DIM_EARTH, BIOME_FOREST } from '../world/world.js';

const MAX_SLIMES         = 8;
const SLIME_GRAVITY      = 22;
const SLIME_JUMP_SPEED   = 7;
const SLIME_CHASE_JUMP_SPEED = 9;
const SLIME_CHASE_DIST   = 12;
const SLIME_SPAWN_MIN    = 14;
const SLIME_SPAWN_MAX    = 36;
const SLIME_SCALE        = 0.85;
const SLIME_MAX_HP       = 5;
const PUNCH_DIST         = 3.0;
const PUNCH_DOT_THRESH   = 0.4;
const SLIME_R            = 0.28;
export const SLIME_H     = 0.82;

const SLIME_PROBES = [];
(function () {
    const r = SLIME_R, h = SLIME_H;
    for (const [ox, oz] of [[0,0],[r,0],[-r,0],[0,r],[0,-r]]) {
        SLIME_PROBES.push([ox, r,     oz]);
        SLIME_PROBES.push([ox, h - r, oz]);
        SLIME_PROBES.push([ox, h,     oz]);
    }
})();

const _sNorm    = new THREE.Vector3();
const _sTiltTgt = new THREE.Quaternion();
const _sYawQ    = new THREE.Quaternion();
const _sUpAxis  = new THREE.Vector3(0, 1, 0);
const _sIdentQ  = new THREE.Quaternion();
const _slimeFrustum  = new THREE.Frustum();
const _slimeProjMat  = new THREE.Matrix4();
const _slimeTestV    = new THREE.Vector3();

export const slimes = [];
export const CREATURE_BY_NAME = { 'slime': true };

let slimeTemplate = null;
let punchCooldown  = 0;
let slimeSpawnTimer = 3;

let _scene, _world, _player, _camera, _showFeedback;
let _applyPlanetCurve, _curveDepthMat;

export function initSlimes(scene, world, player, camera, showFeedback, applyPlanetCurve, curveDepthMat) {
    _scene = scene;
    _world = world;
    _player = player;
    _camera = camera;
    _showFeedback = showFeedback;
    _applyPlanetCurve = applyPlanetCurve;
    _curveDepthMat = curveDepthMat;

    new GLTFLoader().load('assets/models/slime.glb', (gltf) => {
        const tpl = gltf.scene;
        const bb = new THREE.Box3().setFromObject(tpl);
        const sz = new THREE.Vector3();
        bb.getSize(sz);
        const sc = SLIME_SCALE / Math.max(sz.x, sz.y, sz.z);
        const center = new THREE.Vector3();
        bb.getCenter(center);
        tpl.scale.setScalar(sc);
        tpl.position.sub(center.multiplyScalar(sc));
        tpl.traverse(child => {
            if (child.isMesh) {
                _applyPlanetCurve(child.material);
                child.customDepthMaterial = _curveDepthMat;
            }
        });
        slimeTemplate = tpl;
    });
}

function slimeOverlaps(px, py, pz) {
    for (let i = 0; i < SLIME_PROBES.length; i++) {
        const p = SLIME_PROBES[i];
        if (sampleDensity(_world, px + p[0], py + p[1], pz + p[2]) > 0.5) return true;
    }
    return false;
}

function slimeSweep(s, axis, delta) {
    if (delta === 0) return;
    const steps = Math.ceil(Math.abs(delta) / 0.3);
    const stride = delta / steps;
    for (let step = 0; step < steps; step++) {
        const prev = s.pos[axis];
        s.pos[axis] += stride;
        if (slimeOverlaps(s.pos.x, s.pos.y, s.pos.z)) {
            s.pos[axis] = prev;
            if (axis === 'y') {
                if (stride < 0) s.onGround = true;
                s.vel.y = 0;
            } else {
                s.vel[axis] *= -0.3;
            }
            break;
        }
    }
}

function slimeGroundNormal(px, py, pz) {
    const e = 0.5, sy = py - 0.05;
    const gx = sampleDensity(_world, px + e, sy, pz) - sampleDensity(_world, px - e, sy, pz);
    const gy = sampleDensity(_world, px, sy + e, pz) - sampleDensity(_world, px, sy - e, pz);
    const gz = sampleDensity(_world, px, sy, pz + e) - sampleDensity(_world, px, sy, pz - e);
    const nx = -gx, ny = -gy, nz = -gz;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 0.001) { _sNorm.set(0, 1, 0); return _sNorm; }
    _sNorm.set(nx / len, ny / len, nz / len);
    return _sNorm;
}

const _heartImg        = new Image();
_heartImg.src          = 'assets/textures/heart.png';
const _damagedHeartImg = new Image();
_damagedHeartImg.src   = 'assets/textures/damaged_heart.png';

const HP_PX = 20; // pixels per heart on the canvas

function createSlimeHpBar() {
    const canvas  = document.createElement('canvas');
    canvas.width  = SLIME_MAX_HP * HP_PX;
    canvas.height = HP_PX;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const mat    = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(SLIME_MAX_HP * 0.18, 0.18, 1);
    return { canvas, tex, sprite };
}

function updateSlimeHpBar(s) {
    if (!s.hpBar) return;
    const { canvas, tex } = s.hpBar;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < SLIME_MAX_HP; i++) {
        const img = i < s.hp ? _heartImg : _damagedHeartImg;
        if (img.complete && img.naturalWidth > 0)
            ctx.drawImage(img, i * HP_PX, 0, HP_PX, HP_PX);
    }
    tex.needsUpdate = true;
}

function removeSlimeHpBar(s) {
    if (!s.hpBar) return;
    _scene.remove(s.hpBar.sprite);
    s.hpBar.tex.dispose();
    s.hpBar.sprite.material.dispose();
    s.hpBar = null;
}

export function tryPunchSlime() {
    if (punchCooldown > 0 || !_player) return false;
    const eye = _player.getEyePosition();
    const dir = new THREE.Vector3();
    _camera.getWorldDirection(dir);

    let bestDist = PUNCH_DIST;
    let bestSlime = null;
    for (const s of slimes) {
        const dx = s.pos.x - eye.x;
        const dy = (s.pos.y + SLIME_H * 0.5) - eye.y;
        const dz = s.pos.z - eye.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > PUNCH_DIST) continue;
        const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
        if (dot < PUNCH_DOT_THRESH) continue;
        if (dist < bestDist) { bestDist = dist; bestSlime = s; }
    }
    if (!bestSlime) return false;

    bestSlime.hp = Math.max(0, bestSlime.hp - 1);
    updateSlimeHpBar(bestSlime);

    const kdx = bestSlime.pos.x - _player.pos.x;
    const kdz = bestSlime.pos.z - _player.pos.z;
    const klen = Math.sqrt(kdx * kdx + kdz * kdz) || 1;
    bestSlime.vel.set((kdx / klen) * 8, 5, (kdz / klen) * 8);
    bestSlime.squash = 0.55;
    punchCooldown = 0.5;

    if (bestSlime.hp <= 0) {
        const idx = slimes.indexOf(bestSlime);
        if (idx !== -1) {
            _scene.remove(bestSlime.mesh);
            removeSlimeHpBar(bestSlime);
            slimes.splice(idx, 1);
        }
    }
    return true;
}

function _makeSlime(wx, wy, wz, timerMin, timerRange) {
    const group = new THREE.Group();
    group.add(slimeTemplate.clone(true));
    _scene.add(group);
    const hpBar = createSlimeHpBar();
    hpBar.sprite.position.set(wx, wy + SLIME_H + 0.25, wz);
    _scene.add(hpBar.sprite);
    const s = {
        mesh: group,
        pos:      new THREE.Vector3(wx, wy, wz),
        vel:      new THREE.Vector3(),
        onGround: false,
        jumpTimer: timerMin + Math.random() * timerRange,
        squash:   0,
        tiltQuat: new THREE.Quaternion(),
        yaw:      0,
        hp:       SLIME_MAX_HP,
        maxHp:    SLIME_MAX_HP,
        hpBar,
    };
    slimes.push(s);
    updateSlimeHpBar(s);
}

function _trySpawnSlime() {
    if (!slimeTemplate || slimes.length >= MAX_SLIMES || !_player) return;
    if (_world.dimension !== DIM_EARTH) return;

    _camera.updateMatrixWorld();
    _slimeProjMat.multiplyMatrices(_camera.projectionMatrix, _camera.matrixWorldInverse);
    _slimeFrustum.setFromProjectionMatrix(_slimeProjMat);

    for (let attempt = 0; attempt < 16; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = SLIME_SPAWN_MIN + Math.random() * (SLIME_SPAWN_MAX - SLIME_SPAWN_MIN);
        const wx = _player.pos.x + Math.sin(angle) * dist;
        const wz = _player.pos.z + Math.cos(angle) * dist;

        if (_world.getBiomeAt(wx, wz) !== BIOME_FOREST) continue;

        const surf = _world.surfaceAt(Math.floor(wx), Math.floor(wz));
        const wy = surf + 1;

        _slimeTestV.set(wx, wy + 0.4, wz);
        if (_slimeFrustum.containsPoint(_slimeTestV)) continue;
        if (_world.isSolid(Math.floor(wx), Math.floor(wy), Math.floor(wz))) continue;

        _makeSlime(wx, wy, wz, 0.5, 2);
        break;
    }
}

export function spawnCreatureAt(name, px, py, pz) {
    if (name === 'slime') {
        if (!slimeTemplate) { _showFeedback('slime model not loaded yet'); return; }
        const spawnX = px + Math.sin(_player.yaw) * 2;
        const spawnZ = pz + Math.cos(_player.yaw) * 2;
        const surf = _world.surfaceAt(Math.floor(spawnX), Math.floor(spawnZ));
        const spawnY = Math.max(py, surf + 1);
        _makeSlime(spawnX, spawnY, spawnZ, 0.3, 0.5);
    }
}

export function updateSlimes(dt) {
    // Spawn timer
    slimeSpawnTimer -= dt;
    if (slimeSpawnTimer <= 0) {
        _trySpawnSlime();
        slimeSpawnTimer = 3 + Math.random() * 3;
    }

    // Punch cooldown
    if (punchCooldown > 0) punchCooldown -= dt;

    if (!_player) return;
    const pp = _player.pos;

    for (let i = slimes.length - 1; i >= 0; i--) {
        const s = slimes[i];

        const dx = s.pos.x - pp.x;
        const dy = s.pos.y - pp.y;
        const dz = s.pos.z - pp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > 64) {
            _scene.remove(s.mesh);
            removeSlimeHpBar(s);
            slimes.splice(i, 1);
            continue;
        }

        const chasing = dist < SLIME_CHASE_DIST;
        const wasOnGround = s.onGround;
        s.onGround = false;

        if (wasOnGround) {
            s.jumpTimer -= dt;
            if (s.jumpTimer <= 0) {
                if (chasing) {
                    const hdist = Math.max(Math.sqrt(dx * dx + dz * dz), 0.001);
                    s.vel.set(
                        (-dx / hdist) * SLIME_CHASE_JUMP_SPEED * 0.55,
                        SLIME_CHASE_JUMP_SPEED,
                        (-dz / hdist) * SLIME_CHASE_JUMP_SPEED * 0.55
                    );
                } else {
                    const ra = Math.random() * Math.PI * 2;
                    s.vel.set(Math.sin(ra) * 2.5, SLIME_JUMP_SPEED, Math.cos(ra) * 2.5);
                }
                s.jumpTimer = (chasing ? 0.6 : 1.5) + Math.random() * (chasing ? 0.4 : 1.5);
                s.squash = 0.6;
            } else {
                s.vel.x = 0;
                s.vel.z = 0;
            }
        }

        s.vel.y -= SLIME_GRAVITY * dt;
        slimeSweep(s, 'x', s.vel.x * dt);
        slimeSweep(s, 'y', s.vel.y * dt);
        slimeSweep(s, 'z', s.vel.z * dt);

        if (s.onGround && !wasOnGround) s.squash = -0.55;

        if (s.onGround) {
            const n = slimeGroundNormal(s.pos.x, s.pos.y, s.pos.z);
            _sTiltTgt.setFromUnitVectors(_sUpAxis, n);
            s.tiltQuat.slerp(_sTiltTgt, Math.min(dt * 12, 1));
        } else {
            s.tiltQuat.slerp(_sIdentQ, Math.min(dt * 5, 1));
        }

        if (chasing) s.yaw = Math.atan2(-dx, -dz);
        _sYawQ.setFromAxisAngle(_sUpAxis, s.yaw);
        s.mesh.quaternion.multiplyQuaternions(s.tiltQuat, _sYawQ);

        s.squash *= Math.exp(-dt * 7);
        const scaleY  = 1.0 + s.squash * 0.35;
        const scaleXZ = 1.0 - s.squash * 0.18;
        s.mesh.position.set(s.pos.x, s.pos.y + SLIME_SCALE * 0.5, s.pos.z);
        s.mesh.scale.set(scaleXZ, scaleY, scaleXZ);

        if (s.hpBar) s.hpBar.sprite.position.set(s.pos.x, s.pos.y + SLIME_H + 0.25, s.pos.z);
    }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DIM_EARTH } from '../world/world.js';

const MAX_WRAITHS       = 4;
const WRAITH_SPAWN_MIN  = 20;
const WRAITH_SPAWN_MAX  = 50;
const WRAITH_DESPAWN    = 200;
const WRAITH_SPEED      = 12;
const WRAITH_CHASE_SPD  = 20;
const WRAITH_CHASE_DIST = 20;
const FLY_HEIGHT        = 18;
const FLY_VARIANCE      = 8;
const TURN_SPEED        = 1.6;
const PITCH_SPEED       = 1.2;
const SEG_SPACING       = 7.0;
const NIGHT_THRESH      = 0.25;
const WANDER_MIN        = 3;
const WANDER_MAX        = 7;
const WRAITH_SCALE      = 15.0;

const PART_NAMES = ['head', 'segment1', 'segment2', 'segment3', 'segment4'];

const _frustum = new THREE.Frustum();
const _projMat = new THREE.Matrix4();
const _testV   = new THREE.Vector3();
const _segDir  = new THREE.Vector3();
const _fwd     = new THREE.Vector3(0, 0, -1);

export const wraithLeviathans = [];

let _template  = null;
let _ignoreDay = false;
let _scene, _world, _player, _camera;
let _applyPlanetCurve, _curveDepthMat;
let _spawnTimer = 5;

export function setWraithIgnoreDay(v) { _ignoreDay = v; }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initWraithLeviathans(scene, world, player, camera, applyPlanetCurve, curveDepthMat) {
    _scene = scene; _world = world; _player = player; _camera = camera;
    _applyPlanetCurve = applyPlanetCurve; _curveDepthMat = curveDepthMat;

    new GLTFLoader().load('assets/models/wraithleviathan.glb', (gltf) => {
        const tpl = gltf.scene;
        const bb = new THREE.Box3().setFromObject(tpl);
        const sz = new THREE.Vector3();
        bb.getSize(sz);
        const sc = WRAITH_SCALE / Math.max(sz.x, sz.y, sz.z);
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
        _template = tpl;
    }, undefined, (err) => console.error('[Wraith] load error:', err));
}

// ── Part clone ────────────────────────────────────────────────────────────────
// Clone the whole model and hide every named part except the one at keepIndex.
// Falls back to top-level child index if names don't match the model.

function _clonePart(keepIndex) {
    const clone = _template.clone(true);
    clone.traverse(child => {
        if (child.isMesh) child.customDepthMaterial = _curveDepthMat;
    });

    let namedAny = false;
    for (let i = 0; i < PART_NAMES.length; i++) {
        const node = clone.getObjectByName(PART_NAMES[i]);
        if (!node) continue;
        namedAny = true;
        node.visible = (i === keepIndex);
    }

    if (!namedAny) {
        clone.children.forEach((child, i) => { child.visible = (i === keepIndex); });
    }

    const group = new THREE.Group();
    group.add(clone);
    return group;
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

function _makeWraith(wx, wy, wz) {
    const parts = PART_NAMES.map((_, i) => {
        const obj = _clonePart(i);
        _scene.add(obj);
        return obj;
    });

    // Each segment has its own persistent world position for chain simulation.
    const segPos = PART_NAMES.map(() => new THREE.Vector3(wx, wy, wz));

    const yaw = Math.random() * Math.PI * 2;
    wraithLeviathans.push({
        parts,
        segPos,
        pos:         new THREE.Vector3(wx, wy, wz),
        yaw,
        pitch:       0,
        targetYaw:   yaw,
        targetPitch: 0,
        targetAlt:   wy,
        wanderTimer: WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN),
    });
}

export function spawnWraithLeviathan() {
    if (!_template || !_player) return false;
    const wx = _player.pos.x + Math.sin(_player.yaw) * 8;
    const wz = _player.pos.z + Math.cos(_player.yaw) * 8;
    const wy = _player.pos.y + 2;
    _makeWraith(wx, wy, wz);
    return true;
}

function _trySpawnWraith(dayIntensity) {
    if (!_template || !_player) return;
    if (_world.dimension !== DIM_EARTH) return;
    if (!_ignoreDay && dayIntensity > NIGHT_THRESH) return;
    if (wraithLeviathans.length >= MAX_WRAITHS) return;

    _camera.updateMatrixWorld();
    _projMat.multiplyMatrices(_camera.projectionMatrix, _camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projMat);

    for (let attempt = 0; attempt < 16; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = WRAITH_SPAWN_MIN + Math.random() * (WRAITH_SPAWN_MAX - WRAITH_SPAWN_MIN);
        const wx    = _player.pos.x + Math.sin(angle) * dist;
        const wz    = _player.pos.z + Math.cos(angle) * dist;
        const surf  = _world.surfaceAt(Math.floor(wx), Math.floor(wz));
        const wy    = surf + FLY_HEIGHT + Math.random() * FLY_VARIANCE;
        _testV.set(wx, wy, wz);
        if (_frustum.containsPoint(_testV)) continue;
        _makeWraith(wx, wy, wz);
        break;
    }
}

function _removeWraith(w) {
    for (const obj of w.parts) _scene.remove(obj);
}

// ── Update ────────────────────────────────────────────────────────────────────

export function updateWraithLeviathans(dt, dayIntensity) {
    _spawnTimer -= dt;
    if (_spawnTimer <= 0) {
        _trySpawnWraith(dayIntensity);
        _spawnTimer = 4 + Math.random() * 4;
    }

    if (!_ignoreDay && dayIntensity > NIGHT_THRESH + 0.05) {
        for (const w of wraithLeviathans) _removeWraith(w);
        wraithLeviathans.length = 0;
        return;
    }

    if (!_player) return;
    const pp = _player.pos;

    for (let i = wraithLeviathans.length - 1; i >= 0; i--) {
        const w = wraithLeviathans[i];

        const dx   = w.pos.x - pp.x;
        const dy   = w.pos.y - pp.y;
        const dz   = w.pos.z - pp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > WRAITH_DESPAWN) {
            _removeWraith(w);
            wraithLeviathans.splice(i, 1);
            continue;
        }

        const chasing = dist < WRAITH_CHASE_DIST;
        const speed   = chasing ? WRAITH_CHASE_SPD : WRAITH_SPEED;

        // Steering
        if (chasing) {
            w.targetYaw = Math.atan2(-(pp.x - w.pos.x), -(pp.z - w.pos.z));
            const hd    = Math.max(Math.sqrt((pp.x - w.pos.x) ** 2 + (pp.z - w.pos.z) ** 2), 0.001);
            w.targetPitch = Math.atan2(pp.y - w.pos.y, hd);
        } else {
            w.wanderTimer -= dt;
            if (w.wanderTimer <= 0) {
                w.targetYaw   = Math.random() * Math.PI * 2;
                w.wanderTimer = WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN);
                const surf    = _world.surfaceAt(Math.floor(w.pos.x), Math.floor(w.pos.z));
                w.targetAlt   = surf + FLY_HEIGHT + (Math.random() - 0.5) * FLY_VARIANCE;
            }
            const altErr  = w.targetAlt - w.pos.y;
            w.targetPitch = Math.atan2(altErr, speed) * 0.4;
        }

        // Smooth yaw (shortest arc)
        let yawDiff = ((w.targetYaw - w.yaw) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        w.yaw   += Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), TURN_SPEED * dt);

        // Smooth pitch
        let pitchDiff = w.targetPitch - w.pitch;
        w.pitch += Math.sign(pitchDiff) * Math.min(Math.abs(pitchDiff), PITCH_SPEED * dt);
        w.pitch  = Math.max(-0.5, Math.min(0.5, w.pitch));

        // Move
        const cp = Math.cos(w.pitch);
        w.pos.x += -Math.sin(w.yaw) * speed * cp * dt;
        w.pos.y +=  Math.sin(w.pitch) * speed * dt;
        w.pos.z += -Math.cos(w.yaw) * speed * cp * dt;

        // Head sits directly at w.pos, oriented by yaw/pitch.
        w.segPos[0].copy(w.pos);
        w.parts[0].position.copy(w.pos);
        _segDir.set(Math.sin(w.yaw) * cp, -Math.sin(w.pitch), Math.cos(w.yaw) * cp);
        w.parts[0].quaternion.setFromUnitVectors(_fwd, _segDir);

        // Body segments chain behind the head via the constraint.
        let prevPos = w.pos;
        for (let s = 1; s < w.parts.length; s++) {
            const seg = w.segPos[s];
            const dx = prevPos.x - seg.x;
            const dy = prevPos.y - seg.y;
            const dz = prevPos.z - seg.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > SEG_SPACING) {
                const pull = (dist - SEG_SPACING) / dist;
                seg.x += dx * pull;
                seg.y += dy * pull;
                seg.z += dz * pull;
            }
            w.parts[s].position.copy(seg);
            _segDir.set(dx, dy, dz);
            if (_segDir.lengthSq() > 0.001) {
                w.parts[s].quaternion.setFromUnitVectors(_fwd, _segDir.normalize());
            }
            prevPos = seg;
        }
    }
}

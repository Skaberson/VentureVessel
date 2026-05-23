import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sampleDensity } from '../player/player.js';

const GRAVE_SCALE      = 1.0;
const GRAVE_BREAK_TIME = 3.0;

const _gNorm   = new THREE.Vector3();
const _gTiltQ  = new THREE.Quaternion();
const _gUpAxis = new THREE.Vector3(0, 1, 0);
const _raycaster = new THREE.Raycaster();
_raycaster.far = 12;

export const gravestones = [];

let graveTemplate     = null;
let graveTarget       = null;
let graveMineProgress = 0;

let _scene, _world, _input, _spawnDrop, _shake;

export function initGravestones(scene, world, input, spawnDrop, shake) {
    _scene     = scene;
    _world     = world;
    _input     = input;
    _spawnDrop = spawnDrop;
    _shake     = shake;

    new GLTFLoader().load('assets/models/grave.glb', (gltf) => {
        const tpl = gltf.scene;
        const bb = new THREE.Box3().setFromObject(tpl);
        const sz = new THREE.Vector3(); bb.getSize(sz);
        const sc = GRAVE_SCALE / Math.max(sz.x, sz.y, sz.z);
        const center = new THREE.Vector3(); bb.getCenter(center);
        tpl.scale.setScalar(sc);
        tpl.position.sub(center.multiplyScalar(sc));
        graveTemplate = tpl;
    });
}

function graveGroundNormal(px, py, pz) {
    const e = 0.5, sy = py - 0.05;
    const gx = sampleDensity(_world, px+e, sy, pz) - sampleDensity(_world, px-e, sy, pz);
    const gy = sampleDensity(_world, px, sy+e, pz) - sampleDensity(_world, px, sy-e, pz);
    const gz = sampleDensity(_world, px, sy, pz+e) - sampleDensity(_world, px, sy, pz-e);
    const len = Math.sqrt(gx*gx + gy*gy + gz*gz);
    if (len < 0.001) { _gNorm.set(0,1,0); return _gNorm; }
    _gNorm.set(-gx/len, -gy/len, -gz/len);
    return _gNorm;
}

export function placeGravestone(hotbarSnapshot, mainSnapshot, px, py, pz) {
    if (!graveTemplate) return;
    let bx = Math.floor(px), bz = Math.floor(pz);
    let surf = _world.surfaceAt(bx, bz);
    for (let r = 0; r <= 3 && surf < 0; r++) {
        for (let dx = -r; dx <= r && surf < 0; dx++) {
            for (let dz = -r; dz <= r && surf < 0; dz++) {
                if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                surf = _world.surfaceAt(bx+dx, bz+dz);
                if (surf >= 0) { bx += dx; bz += dz; }
            }
        }
    }
    const wy = surf >= 0 ? surf + 0.5 : py;
    const wx = bx + 0.5, wz = bz + 0.5;

    const group = new THREE.Group();
    group.add(graveTemplate.clone(true));
    _scene.add(group);

    const n = graveGroundNormal(wx, wy, wz);
    _gTiltQ.setFromUnitVectors(_gUpAxis, n);
    group.quaternion.copy(_gTiltQ);
    group.position.set(wx, wy, wz);

    gravestones.push({
        mesh: group,
        pos: new THREE.Vector3(wx, wy, wz),
        hotbar: hotbarSnapshot,
        main: mainSnapshot,
        hp: GRAVE_BREAK_TIME,
    });
}

export function updateGraveMining(dt, rOrigin, rDir) {
    _raycaster.set(rOrigin, rDir);
    const graveMeshes = gravestones.map(g => g.mesh);
    const hits = _raycaster.intersectObjects(graveMeshes, true);

    let hitGrave = null;
    if (hits.length > 0) {
        const obj = hits[0].object;
        hitGrave = gravestones.find(g => {
            let o = obj; while (o) { if (o === g.mesh) return true; o = o.parent; } return false;
        });
    }

    if (hitGrave && (_input.mouseHeld || _input.isMining())) {
        if (graveTarget !== hitGrave) { graveTarget = hitGrave; graveMineProgress = 0; }
        graveMineProgress += dt;
        _shake.amount = 0.012;
        _shake.time += dt;
        if (graveMineProgress >= GRAVE_BREAK_TIME) {
            const gp = hitGrave.pos;
            for (const item of [...hitGrave.hotbar, ...hitGrave.main]) {
                if (!item || item.count <= 0) continue;
                for (let n = 0; n < item.count; n++) _spawnDrop(item.type, Math.floor(gp.x), Math.floor(gp.y), Math.floor(gp.z));
            }
            _scene.remove(hitGrave.mesh);
            gravestones.splice(gravestones.indexOf(hitGrave), 1);
            graveTarget = null;
            graveMineProgress = 0;
        }
        return true;
    } else {
        if (graveTarget !== hitGrave) { graveTarget = null; graveMineProgress = 0; }
        return !!hitGrave;
    }
}

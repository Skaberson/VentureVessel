import * as THREE from 'three';

const CLOUD_Y       = 270;
export const CLOUD_FIELD_R = 820;
export const cloudLayerGroups = [];

let _scene;

function _seededRng(seed) {
    let s = (seed * 1664525 + 1013904223) | 0;
    return () => { s = Math.imul(s, 1664525) + 1013904223 | 0; return (s >>> 0) / 4294967296; };
}

function _genCumulusSprite(seed, size = 256) {
    const rng = _seededRng(seed);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    const layers = [
        { count: 14, sizeRange: [0.15, 0.28], alpha: 0.5, color: '#7a829e', yBias: 0.15 },
        { count: 12, sizeRange: [0.12, 0.24], alpha: 0.8, color: '#e8ecf7', yBias: 0.05 },
        { count: 8,  sizeRange: [0.08, 0.18], alpha: 0.9, color: '#ffffff', yBias: -0.15 }
    ];

    layers.forEach(layer => {
        ctx.globalAlpha = layer.alpha;
        for (let i = 0; i < layer.count; i++) {
            const r = size * (layer.sizeRange[0] + rng() * (layer.sizeRange[1] - layer.sizeRange[0]));
            const px = size * 0.5 + (rng() - 0.5) * size * 0.6;
            const py = size * (0.5 + layer.yBias) + (rng() - 0.5) * size * 0.4;
            const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
            grad.addColorStop(0, layer.color);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    ctx.globalCompositeOperation = 'destination-out';
    const bottomClip = ctx.createLinearGradient(0, size * 0.75, 0, size);
    bottomClip.addColorStop(0, 'rgba(0,0,0,0)');
    bottomClip.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = bottomClip;
    ctx.fillRect(0, size * 0.75, size, size * 0.25);
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
}

function _genStratusSprite(seed, size = 512) {
    const rng = _seededRng(seed + 1000);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const numPatches = 3 + Math.floor(rng() * 5);
    for (let p = 0; p < numPatches; p++) {
        const cx = size * (0.08 + rng() * 0.84);
        const cy = size * (0.25 + rng() * 0.50);
        const rx = size * (0.22 + rng() * 0.30);
        const ry = size * (0.05 + rng() * 0.07);
        const rmax = Math.max(rx, ry);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rmax);
        grad.addColorStop(0,   'rgba(183,186,200,0.62)');
        grad.addColorStop(0.6, 'rgba(180,184,198,0.32)');
        grad.addColorStop(1,   'rgba(178,182,196,0)');
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx / rmax, ry / rmax);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, rmax, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

const _cumSprites = Array.from({length: 10}, (_, i) => _genCumulusSprite(i * 17 + 3));
const _strSprites = Array.from({length:  6}, (_, i) => _genStratusSprite(i * 31 + 11));

function _spawnCloudLayer({ y, yRange, count, minSize, maxSize, wMult, hMult, sprites, driftX, driftZ, baseOpacity, layerThickness }) {
    const rng = _seededRng((y * 73 + count * 31) | 0);
    const group = new THREE.Group();
    group.position.set(0, y, 0);
    _scene.add(group);
    const clouds = [];
    for (let i = 0; i < count; i++) {
        const cloudDriftX = driftX + (rng() - 0.5) * 0.7;
        const cloudDriftZ = driftZ + (rng() - 0.5) * 0.7;
        const angle = rng() * Math.PI * 2;
        const dist  = Math.sqrt(rng()) * CLOUD_FIELD_R;
        const bx = Math.cos(angle) * dist;
        const bz = Math.sin(angle) * dist;
        const by = (rng() - 0.5) * yRange * baseOpacity;

        const puffs = (sprites === _cumSprites) ? (5 + Math.floor(rng() * 4)) : 1;

        for (let j = 0; j < puffs; j++) {
            const sz = minSize + rng() * (maxSize - minSize);
            const sprite = sprites[Math.floor(rng() * sprites.length)];
            const mat = new THREE.MeshBasicMaterial({
                map: sprite, transparent: true, depthWrite: false,
                alphaTest: 0.03, side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sz * wMult, sz * hMult), mat);
            mesh.rotation.set(-Math.PI / 2, 0, rng() * Math.PI * 2);

            const ox = (rng() - 0.5) * sz * 0.5;
            const oy = (rng() - 0.5) * yRange * 0.7 * baseOpacity;
            const oz = (rng() - 0.5) * sz * 0.5;
            mesh.position.set(bx + ox, by + oy, bz + oz);

            mesh.userData.driftX = cloudDriftX;
            mesh.userData.driftZ = cloudDriftZ;
            group.add(mesh);
            clouds.push(mesh);
        }
    }
    return { group, clouds, baseOpacity, baseY: y, layerThickness: layerThickness * baseOpacity };
}

export function initClouds(scene, gameTextures) {
    _scene = scene;
    gameTextures.push(..._cumSprites, ..._strSprites);

    cloudLayerGroups.push(_spawnCloudLayer({
        y: 215, yRange: 2,  count: 13, minSize: 620, maxSize: 1100, wMult: 1, hMult: 1,
        sprites: _strSprites, driftX: 0.6, driftZ: 0.4, baseOpacity: 0.50, layerThickness: 2,
    }));
    cloudLayerGroups.push(_spawnCloudLayer({
        y: 268, yRange: 32, count: 90, minSize: 115, maxSize: 250,  wMult: 1, hMult: 1,
        sprites: _cumSprites, driftX: 2.2, driftZ: 1.7, baseOpacity: 1.0, layerThickness: 32,
    }));
    cloudLayerGroups.push(_spawnCloudLayer({
        y: 354, yRange: 7,  count: 38, minSize: 72,  maxSize: 165,  wMult: 1, hMult: 1,
        sprites: _cumSprites, driftX: 1.3, driftZ: 0.9, baseOpacity: 0.62, layerThickness: 7,
    }));
}

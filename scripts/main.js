import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { 
    VoxelWorld, CHUNK, MIN_Y, MAX_Y, MIN_CY, MAX_CY, BIOME_FOREST, BIOME_DESERT, BIOME_TUNDRA, DIM_EARTH, DIM_MOON,
    SAND, PYRAMID_CHANCE, hash, bSeedX, bSeedZ, bOffset, mSeedX, mSeedZ,
    GRASS, DIRT, STONE, WOOD, LEAVES, SANDSTONE, CACTUS, ICE, PFROST, IGRASS, PINEWOOD, PINELEAVES, DEEPSTONE, LAVAROCK, MOLTENROCK, MOONSTONE
} from './world.js';
import { buildChunkMesh } from './building/mesher.js';
import { Player, EYE_HEIGHT, overlaps, setCollisionMode, sampleDensity } from './player.js';
import { Input } from './input.js';
import { raycastVoxel } from './mining/raycast.js';

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.insertBefore(renderer.domElement, document.body.firstChild);

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
const forestSkyColor = new THREE.Color(0x87ceeb);
const desertSkyColor = new THREE.Color(0xd2b48c);
const tundraSkyColor = new THREE.Color(0xdaeef2);
const currentSkyColor = forestSkyColor.clone();
const spaceColor = new THREE.Color(0x020205);
const nightSkyColor = new THREE.Color(0x050510);
const tempColor = new THREE.Color();

const DEFAULT_CYCLE = 1560; // 26 minutes
const FAST_CYCLE = 30; // 30 seconds
let currentCycleLength = DEFAULT_CYCLE;
let gameTime = DEFAULT_CYCLE * 0.25; // Start at noon

const BREAK_TIMES = {
    [GRASS]: 0.4,
    [DIRT]: 0.2,
    [STONE]: 1.0,
    [WOOD]: 0.6,
    [LEAVES]: 0, // Instant
    [SAND]: 0.2,
    [SANDSTONE]: 0.8,
    [CACTUS]: 0.3,
    [ICE]: 0.4,
    [PFROST]: 0.4,
    [IGRASS]: 0.4,
    [PINEWOOD]: 0.6, 
    [PINELEAVES]: 0, // Instant
    [DEEPSTONE]: 1.5,
    [LAVAROCK]: 1.5,
    [MOLTENROCK]: 1.2,
    [MOONSTONE]: 0.5
};

scene.background = currentSkyColor.clone();
scene.fog = new THREE.FogExp2(currentSkyColor, 0.006);

// ── Lighting ──────────────────────────────────────────────────────────────────
const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.camera.far = 500;
scene.add(sunLight);
scene.add(sunLight.target);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);

// No scene lights — brightness comes entirely from baked sky-light vertex colours.

// ── Textures & materials ──────────────────────────────────────────────────────
function loadTex(path) {
    const t = new THREE.TextureLoader().load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    return t;
}

// ── Planet curve ──────────────────────────────────────────────────────────────
// Shared uniforms updated every frame / on dimension switch.
// All terrain materials reference the same objects so one write propagates.
const EARTH_PLANET_RADIUS = 5000; // blocks — larger = flatter
const MOON_PLANET_RADIUS  = 250; // Moon is smaller, curves more sharply
const curveUniforms = {
    uCamXZ:        { value: new THREE.Vector2(0, 0) },
    uPlanetRadius: { value: EARTH_PLANET_RADIUS },
};

function patchCurveShader(shader) {
    shader.uniforms.uCamXZ        = curveUniforms.uCamXZ;
    shader.uniforms.uPlanetRadius = curveUniforms.uPlanetRadius;
    shader.vertexShader = shader.vertexShader
        .replace(
            '#include <common>',
            `#include <common>
uniform vec2  uCamXZ;
uniform float uPlanetRadius;`
        )
        .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
{
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    float dx = worldPos.x - uCamXZ.x;
    float dz = worldPos.z - uCamXZ.y;
    float drop = (dx * dx + dz * dz) / (2.0 * uPlanetRadius);
    transformed.y -= drop;
}`
        );
}

function applyPlanetCurve(mat) {
    mat.onBeforeCompile = patchCurveShader;
    mat.needsUpdate = true;
}

// Shared depth material used as customDepthMaterial on all chunk meshes so the
// shadow map pass applies the same vertex curve as the visual pass.
const curveDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
curveDepthMat.onBeforeCompile = patchCurveShader;

// Keyed by voxel type. Add new terrain block types here — no other file needs changing.
const MATS = {
    1:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/grass.png'),     vertexColors: true, transparent: true, fog: false }),
    2:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/dirt.png'),      vertexColors: true, transparent: true, fog: false }),
    3:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/stone.png'),     vertexColors: true, transparent: true, fog: false }),
    4:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/wood.png'),      vertexColors: true, transparent: true, fog: false }),
    5:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/leaves.png'),    vertexColors: true, transparent: true, fog: false, alphaTest: 0.05 }),
    6:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/sand.png'),      vertexColors: true, transparent: true, fog: false }),
    7:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/sandstone.png'), vertexColors: true, transparent: true, fog: false }),
    8:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/cactus.png'),    vertexColors: true, transparent: true, fog: false }),
    9:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/ice.png'),       vertexColors: true, transparent: true, fog: false }),
    10: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/pfrost.png'),    vertexColors: true, transparent: true, fog: false }),
    11: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/igrass.png'),    vertexColors: true, transparent: true, fog: false }),
    12: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/pinewood.png'),  vertexColors: true, transparent: true, fog: false }),
    13: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/iceleaves.png'), vertexColors: true, transparent: true, fog: false, alphaTest: 0.05 }),
    14: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/deepstone.png'), vertexColors: true, transparent: true, fog: false }),
    15: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/lavarock.png'),  vertexColors: true, transparent: true, fog: false }),
    16: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/moltenrock.png'),vertexColors: true, transparent: true, fog: false }),
    17: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/moonstone.png'),  vertexColors: true, transparent: true, fog: false }),
    18: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/woodplanks.png'), vertexColors: true, transparent: true, fog: false, side: THREE.DoubleSide }),
};

for (const mat of Object.values(MATS)) applyPlanetCurve(mat);

// ── Held item HUD ─────────────────────────────────────────────────────────────
const hudScene = new THREE.Scene();
const hudCamera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 10);
hudCamera.position.set(0, 0, 3);

hudScene.add(new THREE.AmbientLight(0xffffff, 0.5));
const hudSun = new THREE.DirectionalLight(0xffffff, 1.0);
hudSun.position.set(2, 3, 2);
hudScene.add(hudSun);

// HUD materials keyed by block type (1-based). Built from MATS textures for
// voxel types and loaded independently for crafted-only types (e.g. 18).
// Using a map instead of an array means any unknown type gets a safe fallback
// instead of undefined, which would crash the Three.js renderer.
const HUD_MATS = {};
for (const [type, m] of Object.entries(MATS)) {
    HUD_MATS[Number(type)] = new THREE.MeshLambertMaterial({
        map: m.map,
        transparent: m.transparent,
        alphaTest: m.alphaTest ?? 0,
    });
}

function getHudMat(type) {
    return HUD_MATS[type] ?? HUD_MATS[1];
}

// ── Item Drops ────────────────────────────────────────────────────────────────
const DROP_SIZE   = 0.32;
const DROP_HALF   = DROP_SIZE / 2;
const DROP_GEO    = new THREE.BoxGeometry(DROP_SIZE, DROP_SIZE, DROP_SIZE);
const DROP_PICKUP_DIST  = 1.3;
const DROP_PICKUP_DELAY = 0.6;
const DROP_ATTRACT_DIST = 5.0;  // radius at which drops start being pulled in
const DROP_ATTRACT_SPEED = 14;  // max pull speed
const drops = [];

function dropInSolid(px, py, pz) {
    const h = DROP_HALF - 0.02;
    for (let dx = -1; dx <= 1; dx += 2)
    for (let dy = -1; dy <= 1; dy += 2)
    for (let dz = -1; dz <= 1; dz += 2)
        if (sampleDensity(world, px + dx*h, py + dy*h, pz + dz*h) > 0.5) return true;
    return false;
}

function spawnDrop(type, bx, by, bz) {
    if (!HUD_MATS[type]) return;
    // Find nearest air voxel (block already cleared, so [0,0,0] is almost always free)
    const offsets = [[0,0,0],[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,2,0]];
    let sx = bx + 0.5, sy = by + 0.5, sz = bz + 0.5;
    for (const [dx, dy, dz] of offsets) {
        if (!world.get(bx+dx, by+dy, bz+dz)) {
            sx = bx + dx + 0.5; sy = by + dy + 0.5; sz = bz + dz + 0.5;
            break;
        }
    }
    const mesh = new THREE.Mesh(DROP_GEO, getHudMat(type));
    mesh.castShadow = true;
    scene.add(mesh);
    drops.push({
        type,
        pos: new THREE.Vector3(sx, sy, sz),
        vel: new THREE.Vector3((Math.random()-0.5)*2, 3 + Math.random()*2, (Math.random()-0.5)*2),
        mesh,
        age: 0,
        spinY: Math.random() * Math.PI * 2,
    });
}

function updateDrops(dt) {
    const pp = player.pos;
    for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;
        d.spinY += dt * 2.5;

        // Attraction toward player
        const pdx = pp.x - d.pos.x, pdy = (pp.y + 0.9) - d.pos.y, pdz = pp.z - d.pos.z;
        const pdist = Math.sqrt(pdx*pdx + pdy*pdy + pdz*pdz);
        if (d.age > DROP_PICKUP_DELAY && pdist < DROP_ATTRACT_DIST) {
            // Strength ramps from 0 at the edge to full at pickup distance
            const t = 1 - pdist / DROP_ATTRACT_DIST;
            const pull = DROP_ATTRACT_SPEED * t * t;
            d.vel.x += (pdx / pdist) * pull * dt * 60;
            d.vel.y += (pdy / pdist) * pull * dt * 60;
            d.vel.z += (pdz / pdist) * pull * dt * 60;
        }

        // Gravity (suppressed when being strongly pulled in so drops don't fight upward pull)
        if (pdist >= DROP_ATTRACT_DIST * 0.4) d.vel.y -= 18 * dt;

        // Axis-separated voxel collision
        const nx = d.pos.x + d.vel.x * dt;
        if (!dropInSolid(nx, d.pos.y, d.pos.z)) d.pos.x = nx;
        else d.vel.x *= -0.3;

        const ny = d.pos.y + d.vel.y * dt;
        if (!dropInSolid(d.pos.x, ny, d.pos.z)) d.pos.y = ny;
        else { if (d.vel.y < -1) { d.vel.x *= 0.8; d.vel.z *= 0.8; } d.vel.y *= -0.25; }

        const nz = d.pos.z + d.vel.z * dt;
        if (!dropInSolid(d.pos.x, d.pos.y, nz)) d.pos.z = nz;
        else d.vel.z *= -0.3;

        // Pickup
        if (d.age > DROP_PICKUP_DELAY) {
            const dx = d.pos.x - pp.x, dy = d.pos.y - (pp.y + 0.9), dz = d.pos.z - pp.z;
            if (Math.sqrt(dx*dx + dy*dy + dz*dz) < DROP_PICKUP_DIST) {
                addToInventory(d.type);
                scene.remove(d.mesh);
                drops.splice(i, 1);
                continue;
            }
        }

        // Position + bob + spin
        d.mesh.position.set(d.pos.x, d.pos.y + Math.sin(d.age * 3 + d.spinY) * 0.06, d.pos.z);
        d.mesh.rotation.y = d.spinY;
    }
}

const heldGeo = new THREE.BoxGeometry(1, 1, 1);
const heldMesh = new THREE.Mesh(heldGeo, getHudMat(1));
heldMesh.rotation.order = 'YXZ';
heldMesh.rotation.x = -0.3;
heldMesh.rotation.y = 0.7;
heldMesh.visible = false;
hudScene.add(heldMesh);

// Hand model shown when no item is selected
const handGroup = new THREE.Group();
handGroup.rotation.order = 'YXZ';
handGroup.rotation.x = -0.3;
handGroup.rotation.y = 100 * Math.PI / 180;
handGroup.visible = false;
hudScene.add(handGroup);

new GLTFLoader().load('assets/models/hand.glb', (gltf) => {
    gltf.scene.scale.setScalar(0.5);
    handGroup.add(gltf.scene);
});

// Breaking variant of the hand model
const handBreakGroup = new THREE.Group();
handBreakGroup.rotation.order = 'YXZ';
handBreakGroup.rotation.x = -0.3;
handBreakGroup.rotation.y = handGroup.rotation.y;
handBreakGroup.visible = false;
hudScene.add(handBreakGroup);

new GLTFLoader().load('assets/models/hand_break.glb', (gltf) => {
    gltf.scene.scale.setScalar(0.5);
    handBreakGroup.add(gltf.scene);
});

let lastHeldType = -1;
let isBreaking = false;
let breakSwingTime = 0;
const heldOff = { x: 0, y: 0, vx: 0, vy: 0 };
let heldPlaceAnim = 0;
let heldCheckTimer = 0;
let prevSelectedSlot = 0;
let slotSwapState = 'idle'; // 'idle' | 'exit' | 'enter'
let slotSwapY = 0;
const _hudRight = new THREE.Vector3();
const _hudUp    = new THREE.Vector3();
const _hudVel   = new THREE.Vector3();

function createCloudTexture(size = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);

    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    const hash = (x, y) => {
        const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return h - Math.floor(h);
    };
    const noise2 = (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        const a = hash(xi, yi);
        const b = hash(xi + 1, yi);
        const c = hash(xi, yi + 1);
        const d = hash(xi + 1, yi + 1);
        const u = fade(xf);
        const v = fade(yf);
        return lerp(lerp(a, b, u), lerp(c, d, u), v);
    };
    const fbm = (x, y) => {
        let value = 0;
        let amplitude = 0.5;
        let frequency = 1;
        for (let octave = 0; octave < 5; octave++) {
            value += amplitude * noise2(x * frequency, y * frequency);
            frequency *= 2;
            amplitude *= 0.5;
        }
        return value;
    };

    for (let y = 0; y < size; y++) {
        const fy = y / size;
        for (let x = 0; x < size; x++) {
            const fx = x / size;
            const nx = fx * 2.8;
            const ny = fy * 2.8;
            const cloudBase = fbm(nx, ny) * 1.2;
            const alpha = Math.min(255, Math.max(0, (cloudBase - 0.4) * 400));
            const shaped = alpha / 255;
            const grey = 130 + Math.floor(shaped * 100);
            const i = (y * size + x) * 4;
            image.data[i + 0] = grey;
            image.data[i + 1] = grey;
            image.data[i + 2] = grey + 10;
            image.data[i + 3] = alpha;
        }
    }

    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

// ── World & player ────────────────────────────────────────────────────────────
const world  = new VoxelWorld();
const input  = new Input();
const player = new Player(world);
scene.add(player.mesh);

const CLOUD_Y = 270;
const CLOUD_SIZE = 1560;
const CLOUD_LAYERS = 12;
const CLOUD_THICKNESS = 10;
const cloudTexture = createCloudTexture(512);

const cloudGroup = new THREE.Group();
const cloudMeshes = [];
const cloudGeo = new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE);

for (let i = 0; i < CLOUD_LAYERS; i++) {
    const hPct = i / (CLOUD_LAYERS - 1);
    const mat = new THREE.MeshBasicMaterial({
        map: cloudTexture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Higher layers have a tighter alpha threshold to create a "tapered" puffy look
        alphaTest: 0.1 + hPct * 0.4,
        // Lower layers are darker to simulate ambient occlusion
        color: new THREE.Color().setHSL(0, 0, 0.6 + hPct * 0.4),
    });
    const mesh = new THREE.Mesh(cloudGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = i * (CLOUD_THICKNESS / CLOUD_LAYERS);
    cloudGroup.add(mesh);
    cloudMeshes.push(mesh);
}
cloudGroup.position.set(0, CLOUD_Y, 0);
scene.add(cloudGroup);

// ── Space & Earth Visuals ─────────────────────────────────────────────────────
const starTex = loadTex('assets/textures/stars.png');
starTex.magFilter = THREE.LinearFilter;
starTex.minFilter = THREE.LinearMipMapLinearFilter;
const starSphere = new THREE.Mesh(
    new THREE.SphereGeometry(750, 32, 32),
    new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false })
);
starSphere.frustumCulled = false;
starSphere.renderOrder = -2; // Render first (behind Earth and Moon)
scene.add(starSphere);

const earthTex = loadTex('assets/textures/earth_surface.png');
earthTex.wrapS = earthTex.wrapT = THREE.ClampToEdgeWrapping;
earthTex.magFilter = THREE.LinearFilter;
earthTex.minFilter = THREE.LinearMipMapLinearFilter;
const earthSphere = new THREE.Mesh(
    new THREE.SphereGeometry(600, 64, 32),
    new THREE.MeshBasicMaterial({ map: earthTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false })
);
earthSphere.rotation.x = Math.PI / 2;
earthSphere.position.y = -700;
earthSphere.frustumCulled = false;
earthSphere.renderOrder = -1;
scene.add(earthSphere);

const moonTex = loadTex('assets/prototype/moon_surface.png');
moonTex.wrapS = moonTex.wrapT = THREE.ClampToEdgeWrapping;
moonTex.magFilter = THREE.LinearFilter;
moonTex.minFilter = THREE.LinearMipMapLinearFilter;
const moonSphere = new THREE.Mesh(
    new THREE.SphereGeometry(600, 64, 32),
    new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false })
);
moonSphere.rotation.x = -Math.PI / 2;
moonSphere.position.set(500, 1800, 20);
moonSphere.frustumCulled = false;
moonSphere.renderOrder = -1;
scene.add(moonSphere);

// ── Inventory Hotbar ────────────────────────────────────────────────────────
const inventory = [];
let selectedSlot = 0;
const VOXEL_IMAGES = {
    1: 'assets/prototype/grass.png',
    2: 'assets/prototype/dirt.png',
    3: 'assets/prototype/stone.png',
    4: 'assets/prototype/wood.png',
    5: 'assets/prototype/leaves.png',
    6: 'assets/prototype/sand.png',
    7: 'assets/prototype/sandstone.png',
    8: 'assets/prototype/cactus.png',
    9: 'assets/prototype/ice.png',
    10: 'assets/prototype/pfrost.png',
    11: 'assets/prototype/igrass.png',
    12: 'assets/prototype/pinewood.png',
    13: 'assets/prototype/iceleaves.png',
    14: 'assets/prototype/deepstone.png',
    15: 'assets/prototype/lavarock.png',
    18: 'assets/prototype/woodplanks.png',
};

// ── Isometric block previews ──────────────────────────────────────────────────
const ISO_PREVIEWS = {};

function drawIsoBlock(ctx, img, size) {
    const iW = img.width, iH = img.height;
    const s  = size * 0.40;
    const cx = size * 0.5;
    const ty = size * 0.06;

    const TOP    = [cx,     ty];
    const RIGHT  = [cx+s,   ty + s*0.5];
    const MID    = [cx,     ty + s];
    const LEFT   = [cx-s,   ty + s*0.5];
    const BOT_L  = [cx-s,   ty + s*1.5];
    const BOT_R  = [cx+s,   ty + s*1.5];
    const BOTTOM = [cx,     ty + s*2];

    const faces = [
        { poly: [TOP, RIGHT, MID, LEFT],       tr: [s/iW, s*0.5/iW, -s/iH, s*0.5/iH, cx,   ty],         bright: 1.25 },
        { poly: [LEFT, MID, BOTTOM, BOT_L],    tr: [s/iW, s*0.5/iW,  0,    s/iH,     cx-s, ty+s*0.5],   bright: 0.90 },
        { poly: [RIGHT, BOT_R, BOTTOM, MID],   tr: [-s/iW, s*0.5/iW, 0,    s/iH,     cx+s, ty+s*0.5],   bright: 0.65 },
    ];

    for (const { poly, tr, bright } of faces) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(...poly[0]);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(...poly[i]);
        ctx.closePath();
        ctx.clip();
        ctx.filter = `brightness(${bright * 100}%)`;
        ctx.setTransform(...tr);
        ctx.drawImage(img, 0, 0, iW, iH);
        ctx.restore();
    }

    // Edge lines
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...TOP);   ctx.lineTo(...RIGHT);  ctx.lineTo(...MID);    ctx.lineTo(...LEFT);  ctx.closePath();
    ctx.moveTo(...LEFT);  ctx.lineTo(...BOT_L);  ctx.lineTo(...BOTTOM); ctx.lineTo(...MID);
    ctx.moveTo(...RIGHT); ctx.lineTo(...BOT_R);  ctx.lineTo(...BOTTOM);
    ctx.stroke();
    ctx.restore();
}

function buildIsoPreview(type, src) {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        drawIsoBlock(canvas.getContext('2d'), img, 64);
        ISO_PREVIEWS[Number(type)] = canvas.toDataURL();
        updateInventoryUI();
        if (inventoryOpen) updateInventoryOverlay();
    };
    img.src = src;
}
for (const [type, src] of Object.entries(VOXEL_IMAGES)) buildIsoPreview(type, src);

const hotbar = document.createElement('div');
hotbar.style.cssText = 'position:fixed; top:20px; left:20px; display:flex; gap:5px; padding:8px; background:rgba(0,0,0,0.5); border-radius:8px; z-index:1000; pointer-events:none;';
document.body.appendChild(hotbar);

const fadeOverlay = document.createElement('div');
fadeOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:black; opacity:0; pointer-events:none; transition:opacity 1s; z-index:2000;';
document.body.appendChild(fadeOverlay);

const slots = [];
for (let i = 0; i < 9; i++) {
    const slot = document.createElement('div');
    slot.style.cssText = 'width:96px; height:96px; background:rgba(255,255,255,0.1); border:2px solid rgba(255,255,255,0.2); border-radius:6px; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; transition: all 0.1s;';
    hotbar.appendChild(slot);
    slots.push(slot);
}

function updateInventoryUI() {
    for (let i = 0; i < 9; i++) {
        const item = inventory[i];
        const slot = slots[i];
        slot.innerHTML = '';
        
        // Selection Highlight
        slot.style.borderColor = (i === selectedSlot) ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.2)';
        slot.style.background = (i === selectedSlot) ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)';
        slot.style.transform = (i === selectedSlot) ? 'scale(1.1)' : 'scale(1)';

        if (item && item.count > 0) {
            const imgSrc = ISO_PREVIEWS[item.type] || VOXEL_IMAGES[item.type];
            slot.innerHTML = `
                <img src="${imgSrc}" style="width:100%; height:100%;">
                <div style="position:absolute; bottom:4px; right:6px; color:white; font-family:monospace; font-size:18px; font-weight:bold; text-shadow:1px 1px 2px black; pointer-events:none;">
                    ${item.count}
                </div>
            `;
        }
    }
}
updateInventoryUI();

function addToInventory(type) {
    if (type === 0) return;
    const existing = inventory.find(item => item && item.type === type);
    if (existing) {
        existing.count++;
    } else {
        const emptyIdx = inventory.findIndex(item => !item || item.count === 0);
        if (emptyIdx >= 0) {
            inventory[emptyIdx] = { type, count: 1 };
        } else if (inventory.length < 9) {
            inventory.push({ type, count: 1 });
        }
    }
    updateInventoryUI();
}

// ── Inventory Overlay ─────────────────────────────────────────────────────────
const mainInventory = new Array(27).fill(null);
let heldCursorItem = null;
let inventoryOpen = false;
let mouseX = 0, mouseY = 0;

window.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursorItemEl.style.left = (mouseX - 29) + 'px';
    cursorItemEl.style.top  = (mouseY - 29) + 'px';
});

// Floating item that sticks to the cursor while dragging
const cursorItemEl = document.createElement('div');
cursorItemEl.style.cssText = 'position:fixed;width:48px;height:48px;pointer-events:none;z-index:3000;display:none;transform:scale(1.2);transform-origin:center;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.9));';
document.body.appendChild(cursorItemEl);

// Backdrop
const inventoryOverlay = document.createElement('div');
inventoryOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:none;align-items:center;justify-content:center;gap:14px;z-index:2500;';
document.body.appendChild(inventoryOverlay);

// Panel
const inventoryPanel = document.createElement('div');
inventoryPanel.style.cssText = 'background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.11);border-radius:12px;padding:20px 20px 16px;display:flex;flex-direction:column;gap:6px;user-select:none;';
inventoryOverlay.appendChild(inventoryPanel);

const invTitle = document.createElement('div');
invTitle.style.cssText = 'color:rgba(255,255,255,0.55);font-family:monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;';
invTitle.textContent = 'Inventory';
inventoryPanel.appendChild(invTitle);

// 3-row main grid
const mainGrid = document.createElement('div');
mainGrid.style.cssText = 'display:grid;grid-template-columns:repeat(9,48px);gap:4px;';
inventoryPanel.appendChild(mainGrid);

const mainSlotEls = [];
for (let i = 0; i < 27; i++) {
    const s = document.createElement('div');
    s.style.cssText = 'width:48px;height:48px;background:rgba(255,255,255,0.07);border:2px solid rgba(255,255,255,0.12);border-radius:4px;position:relative;cursor:pointer;overflow:hidden;box-sizing:border-box;';
    s.addEventListener('click', () => handleSlotClick('main', i));
    mainGrid.appendChild(s);
    mainSlotEls.push(s);
}

// Separator
const invSep = document.createElement('div');
invSep.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 0;';
inventoryPanel.appendChild(invSep);

// Hotbar row
const overlayHotbarGrid = document.createElement('div');
overlayHotbarGrid.style.cssText = 'display:grid;grid-template-columns:repeat(9,48px);gap:4px;';
inventoryPanel.appendChild(overlayHotbarGrid);

const overlayHotbarEls = [];
for (let i = 0; i < 9; i++) {
    const s = document.createElement('div');
    s.style.cssText = 'width:48px;height:48px;background:rgba(255,255,255,0.07);border:2px solid rgba(255,255,255,0.12);border-radius:4px;position:relative;cursor:pointer;overflow:hidden;box-sizing:border-box;';
    s.addEventListener('click', () => handleSlotClick('hotbar', i));
    overlayHotbarGrid.appendChild(s);
    overlayHotbarEls.push(s);
}

function renderSlot(el, item, highlighted = false) {
    el.innerHTML = '';
    el.style.borderColor = highlighted ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)';
    el.style.background   = highlighted ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
    if (item && item.count > 0 && VOXEL_IMAGES[item.type]) {
        const imgSrc = ISO_PREVIEWS[item.type] || VOXEL_IMAGES[item.type];
        el.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;display:block;">
            <div style="position:absolute;bottom:2px;right:4px;color:#fff;font-family:monospace;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 #000;pointer-events:none;">${item.count}</div>`;
    }
}

function updateInventoryOverlay() {
    for (let i = 0; i < 27; i++) renderSlot(mainSlotEls[i], mainInventory[i]);
    for (let i = 0; i < 9;  i++) renderSlot(overlayHotbarEls[i], inventory[i] ?? null, i === selectedSlot);
}

function updateCursorItem() {
    if (!heldCursorItem) { cursorItemEl.style.display = 'none'; return; }
    cursorItemEl.style.display = 'block';
    cursorItemEl.style.left = (mouseX - 29) + 'px';
    cursorItemEl.style.top  = (mouseY - 29) + 'px';
    const _cursorSrc = ISO_PREVIEWS[heldCursorItem.type] || VOXEL_IMAGES[heldCursorItem.type];
    cursorItemEl.innerHTML = _cursorSrc
        ? `<img src="${_cursorSrc}" style="width:100%;height:100%;display:block;">
           <div style="position:absolute;bottom:2px;right:4px;color:#fff;font-family:monospace;font-size:12px;font-weight:bold;text-shadow:1px 1px 0 #000;pointer-events:none;">${heldCursorItem.count}</div>`
        : '';
}

function handleSlotClick(zone, index) {
    const arr = zone === 'hotbar' ? inventory : mainInventory;
    const cur = arr[index] ?? null;

    if (!heldCursorItem) {
        if (cur && cur.count > 0) {
            heldCursorItem = { ...cur };
            arr[index] = null;
        }
    } else if (!cur || cur.count === 0) {
        arr[index] = { ...heldCursorItem };
        heldCursorItem = null;
    } else if (cur.type === heldCursorItem.type) {
        cur.count += heldCursorItem.count;
        arr[index] = cur;
        heldCursorItem = null;
    } else {
        arr[index] = { ...heldCursorItem };
        heldCursorItem = { ...cur };
    }

    if (zone === 'hotbar') updateInventoryUI();
    updateInventoryOverlay();
    updateCursorItem();
}

function openInventory() {
    inventoryOpen = true;
    inventoryOverlay.style.display = 'flex';
    updateInventoryOverlay();
    updateCursorItem();
    updateCraftingIcons();
    document.exitPointerLock();
}

function closeInventory() {
    if (heldCursorItem) {
        // Return held item to the first free slot so nothing is lost on close
        let placed = false;
        for (let i = 0; i < 9 && !placed; i++) {
            if (!inventory[i] || inventory[i].count === 0) { inventory[i] = { ...heldCursorItem }; placed = true; }
        }
        for (let i = 0; i < 27 && !placed; i++) {
            if (!mainInventory[i]) { mainInventory[i] = { ...heldCursorItem }; placed = true; }
        }
        heldCursorItem = null;
        updateCursorItem();
    }
    inventoryOpen = false;
    inventoryOverlay.style.display = 'none';
    updateInventoryUI();
    renderer.domElement.requestPointerLock();
}

window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyE') {
        inventoryOpen ? closeInventory() : openInventory();
    }
    if (e.code === 'Escape' && inventoryOpen) {
        closeInventory();
    }
});

// ── Crafting Panel ────────────────────────────────────────────────────────────
const ITEM_NAMES = {
    1:'Grass', 2:'Dirt', 3:'Stone', 4:'Wood', 5:'Leaves',
    6:'Sand', 7:'Sandstone', 8:'Cactus', 9:'Ice', 10:'Packed Frost',
    11:'Icy Grass', 12:'Pine Wood', 13:'Ice Leaves', 14:'Deepstone',
    15:'Lava Rock', 18:'Wooden Planks'
};

const RECIPES = [
    {
        result:      { type: 18, count: 2 },
        ingredients: [{ type: 4,  count: 1 }]
    }
];

const craftingIconRefs = [];

const craftingPanel = document.createElement('div');
craftingPanel.style.cssText = 'background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.11);border-radius:12px;padding:20px 20px 16px;display:flex;flex-direction:column;gap:8px;user-select:none;min-width:180px;align-self:flex-start;';
inventoryOverlay.appendChild(craftingPanel);

const craftTitle = document.createElement('div');
craftTitle.style.cssText = 'color:rgba(255,255,255,0.55);font-family:monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;';
craftTitle.textContent = 'Crafting';
craftingPanel.appendChild(craftTitle);

for (const recipe of RECIPES) {
    const entry = document.createElement('div');
    entry.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:10px;overflow:hidden;transition:background 0.2s,border-color 0.2s;';

    // Result row — always visible
    const resultRow = document.createElement('div');
    resultRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const resultIconEl = document.createElement('div');
    resultIconEl.style.cssText = 'width:48px;height:48px;flex-shrink:0;';
    const resultImg = document.createElement('img');
    resultImg.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;';
    resultImg.src = VOXEL_IMAGES[recipe.result.type] || '';
    craftingIconRefs.push({ el: resultImg, type: recipe.result.type });
    resultIconEl.appendChild(resultImg);

    const resultMeta = document.createElement('div');
    resultMeta.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

    const resultNameEl = document.createElement('div');
    resultNameEl.style.cssText = 'color:rgba(255,255,255,0.9);font-family:monospace;font-size:12px;font-weight:bold;';
    resultNameEl.textContent = ITEM_NAMES[recipe.result.type] || `Item ${recipe.result.type}`;

    const resultCountEl = document.createElement('div');
    resultCountEl.style.cssText = 'color:rgba(255,255,255,0.45);font-family:monospace;font-size:11px;';
    resultCountEl.textContent = `×${recipe.result.count}`;

    resultMeta.appendChild(resultNameEl);
    resultMeta.appendChild(resultCountEl);
    resultRow.appendChild(resultIconEl);
    resultRow.appendChild(resultMeta);
    entry.appendChild(resultRow);

    // Expandable section — shown on hover
    const expandSection = document.createElement('div');
    expandSection.style.cssText = 'max-height:0;overflow:hidden;transition:max-height 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.25s ease,margin-top 0.35s ease;opacity:0;margin-top:0;';

    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:8px 0 6px;';
    expandSection.appendChild(sep);

    const reqLabel = document.createElement('div');
    reqLabel.style.cssText = 'color:rgba(255,255,255,0.35);font-family:monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;';
    reqLabel.textContent = 'Requires:';
    expandSection.appendChild(reqLabel);

    for (const ing of recipe.ingredients) {
        const ingRow = document.createElement('div');
        ingRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:2px;';

        const ingIconEl = document.createElement('div');
        ingIconEl.style.cssText = 'width:36px;height:36px;flex-shrink:0;';
        const ingImg = document.createElement('img');
        ingImg.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;';
        ingImg.src = VOXEL_IMAGES[ing.type] || '';
        craftingIconRefs.push({ el: ingImg, type: ing.type });
        ingIconEl.appendChild(ingImg);

        const ingMeta = document.createElement('div');
        ingMeta.style.cssText = 'display:flex;flex-direction:column;gap:1px;';

        const ingNameEl = document.createElement('div');
        ingNameEl.style.cssText = 'color:rgba(255,255,255,0.75);font-family:monospace;font-size:11px;';
        ingNameEl.textContent = ITEM_NAMES[ing.type] || `Item ${ing.type}`;

        const ingCountEl = document.createElement('div');
        ingCountEl.style.cssText = 'color:rgba(255,255,255,0.4);font-family:monospace;font-size:10px;';
        ingCountEl.textContent = `×${ing.count}`;

        ingMeta.appendChild(ingNameEl);
        ingMeta.appendChild(ingCountEl);
        ingRow.appendChild(ingIconEl);
        ingRow.appendChild(ingMeta);
        expandSection.appendChild(ingRow);
    }

    const craftBtn = document.createElement('button');
    craftBtn.style.cssText = 'margin-top:10px;width:100%;padding:6px 0;background:rgba(74,163,92,0.18);border:1px solid rgba(74,163,92,0.35);border-radius:5px;color:rgba(110,210,130,0.9);font-family:monospace;font-size:11px;letter-spacing:0.08em;cursor:pointer;transition:background 0.15s,border-color 0.15s,color 0.15s;';
    craftBtn.textContent = 'CRAFT';
    craftBtn.addEventListener('mouseenter', () => {
        craftBtn.style.background   = 'rgba(74,163,92,0.35)';
        craftBtn.style.borderColor  = 'rgba(74,163,92,0.65)';
        craftBtn.style.color        = 'rgba(140,240,160,1)';
    });
    craftBtn.addEventListener('mouseleave', () => {
        craftBtn.style.background   = 'rgba(74,163,92,0.18)';
        craftBtn.style.borderColor  = 'rgba(74,163,92,0.35)';
        craftBtn.style.color        = 'rgba(110,210,130,0.9)';
    });
    craftBtn.addEventListener('click', () => craftRecipe(recipe));
    expandSection.appendChild(craftBtn);

    entry.appendChild(expandSection);

    entry.addEventListener('mouseenter', () => {
        expandSection.style.maxHeight = '200px';
        expandSection.style.opacity   = '1';
        expandSection.style.marginTop = '4px';
        entry.style.background   = 'rgba(255,255,255,0.07)';
        entry.style.borderColor  = 'rgba(255,255,255,0.16)';
    });
    entry.addEventListener('mouseleave', () => {
        expandSection.style.maxHeight = '0';
        expandSection.style.opacity   = '0';
        expandSection.style.marginTop = '0';
        entry.style.background   = 'rgba(255,255,255,0.04)';
        entry.style.borderColor  = 'rgba(255,255,255,0.09)';
    });

    craftingPanel.appendChild(entry);
}

function updateCraftingIcons() {
    for (const ref of craftingIconRefs) {
        if (ISO_PREVIEWS[ref.type]) ref.el.src = ISO_PREVIEWS[ref.type];
    }
}

function craftRecipe(recipe) {
    for (const ing of recipe.ingredients) {
        let have = 0;
        for (let i = 0; i < 9;  i++) if (inventory[i]     && inventory[i].type     === ing.type) have += inventory[i].count;
        for (let i = 0; i < 27; i++) if (mainInventory[i] && mainInventory[i].type === ing.type) have += mainInventory[i].count;
        if (have < ing.count) return;
    }
    for (const ing of recipe.ingredients) {
        let toConsume = ing.count;
        for (let i = 0; i < 9 && toConsume > 0; i++) {
            if (!inventory[i] || inventory[i].type !== ing.type) continue;
            const take = Math.min(toConsume, inventory[i].count);
            inventory[i].count -= take;
            toConsume -= take;
            if (inventory[i].count === 0) inventory[i] = null;
        }
        for (let i = 0; i < 27 && toConsume > 0; i++) {
            if (!mainInventory[i] || mainInventory[i].type !== ing.type) continue;
            const take = Math.min(toConsume, mainInventory[i].count);
            mainInventory[i].count -= take;
            toConsume -= take;
            if (mainInventory[i].count === 0) mainInventory[i] = null;
        }
    }
    const { type, count } = recipe.result;
    let remaining = count;
    for (let i = 0; i < 9  && remaining > 0; i++) if (inventory[i]     && inventory[i].type     === type) { inventory[i].count     += remaining; remaining = 0; }
    for (let i = 0; i < 27 && remaining > 0; i++) if (mainInventory[i] && mainInventory[i].type === type) { mainInventory[i].count += remaining; remaining = 0; }
    for (let i = 0; i < 9  && remaining > 0; i++) if (!inventory[i])     { inventory[i]     = { type, count: remaining }; remaining = 0; }
    for (let i = 0; i < 27 && remaining > 0; i++) if (!mainInventory[i]) { mainInventory[i] = { type, count: remaining }; remaining = 0; }
    updateInventoryUI();
    updateInventoryOverlay();
}

// ── Voxel Particle System ─────────────────────────────────────────────────────
// Uses camera-facing quad billboards instead of point sprites.
// Point sprites are clipped at the viewport edge (the "crop" bug); quads are not.
const PARTICLE_NAMES = {
    1: 'grass', 2: 'dirt', 3: 'stone', 4: 'wood', 5: 'leaves',
    6: 'sand', 7: 'sandstone', 8: 'cactus', 9: 'ice', 10: 'pfrost',
    11: 'igrass', 12: 'pinewood', 13: 'iceleaves',
    14: 'deepstone',
    15: 'lavarock',
    16: 'moltenrock'
};
const PARTICLE_POOL_SIZE = 150;
const PARTICLE_HALF_SIZE = 0.18; // world-unit half-size of each quad
const particlePools = {};

const PARTICLE_VERT = `
attribute float life;
varying float vLife;
varying vec2 vUv;
void main() {
    vLife = life;
    vUv   = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PARTICLE_FRAG = `
uniform sampler2D map;
varying float vLife;
varying vec2 vUv;
void main() {
    vec4 tex = texture2D(map, vUv);
    float alpha = tex.a * vLife;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(tex.rgb, alpha);
}`;

// Camera right/up vectors extracted each frame before the particle update loop
const _pRight = new THREE.Vector3();
const _pUp    = new THREE.Vector3();

function getParticlePool(voxelType) {
    if (particlePools[voxelType]) return particlePools[voxelType];
    const name = PARTICLE_NAMES[voxelType] || 'dirt';
    const N = PARTICLE_POOL_SIZE;

    // Per-particle physics (CPU only)
    const pos  = new Float32Array(N * 3);
    const vel  = new Float32Array(N * 3);
    const life = new Float32Array(N);

    // Per-vertex GPU buffers (4 verts per quad)
    const vPos  = new Float32Array(N * 4 * 3);
    const vUv   = new Float32Array(N * 4 * 2);
    const vLife = new Float32Array(N * 4);
    const idx   = new Uint16Array(N * 6);

    // Fixed UVs per quad
    for (let i = 0; i < N; i++) {
        const u = i * 8;
        vUv[u+0]=0; vUv[u+1]=1;  // v0 top-left
        vUv[u+2]=1; vUv[u+3]=1;  // v1 top-right
        vUv[u+4]=1; vUv[u+5]=0;  // v2 bottom-right
        vUv[u+6]=0; vUv[u+7]=0;  // v3 bottom-left
    }

    // Fixed index pairs per quad
    for (let i = 0; i < N; i++) {
        const ii = i * 6, vi = i * 4;
        idx[ii+0]=vi; idx[ii+1]=vi+1; idx[ii+2]=vi+2;
        idx[ii+3]=vi; idx[ii+4]=vi+2; idx[ii+5]=vi+3;
    }

    // Park all quads off-screen at init
    for (let i = 0; i < N * 4; i++) vPos[i*3+1] = -1000;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vPos,  3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(vUv,   2));
    geo.setAttribute('life',     new THREE.BufferAttribute(vLife, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: loadTex(`assets/particles/${name}.png`) } },
        vertexShader:   PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const pool = { pos, vel, life, vPos, vLife, geo, cursor: 0 };
    particlePools[voxelType] = pool;
    return pool;
}

// cx/cy/cz is the spawn centre; particles scatter ±0.25 around it.
function spawnParticles(voxelType, cx, cy, cz, count, speed) {
    const pool = getParticlePool(voxelType);
    for (let i = 0; i < count; i++) {
        const idx = pool.cursor;
        pool.pos[idx*3]   = cx + (Math.random() - 0.5) * 0.5;
        pool.pos[idx*3+1] = cy + (Math.random() - 0.5) * 0.5;
        pool.pos[idx*3+2] = cz + (Math.random() - 0.5) * 0.5;
        pool.vel[idx*3]   = (Math.random() - 0.5) * speed;
        pool.vel[idx*3+1] = Math.random() * speed * 0.7 + 0.5;
        pool.vel[idx*3+2] = (Math.random() - 0.5) * speed;
        pool.life[idx] = 1.0;
        pool.cursor = (pool.cursor + 1) % PARTICLE_POOL_SIZE;
    }
}

function updateParticles(dt) {
    // Extract camera axes once per frame for billboard alignment
    _pRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _pUp.setFromMatrixColumn(camera.matrixWorld, 1);
    const rx = _pRight.x * PARTICLE_HALF_SIZE, ry = _pRight.y * PARTICLE_HALF_SIZE, rz = _pRight.z * PARTICLE_HALF_SIZE;
    const ux = _pUp.x   * PARTICLE_HALF_SIZE, uy = _pUp.y   * PARTICLE_HALF_SIZE, uz = _pUp.z   * PARTICLE_HALF_SIZE;

    for (const pool of Object.values(particlePools)) {
        let active = false;
        for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
            const vi = i * 4 * 3; // base index into vPos
            const li = i * 4;     // base index into vLife

            if (pool.life[i] <= 0) continue;
            active = true;

            pool.life[i] -= dt * 0.5; // 2-second lifetime
            if (pool.life[i] <= 0) {
                pool.life[i] = 0;
                pool.vPos[vi+1] = pool.vPos[vi+4] = pool.vPos[vi+7] = pool.vPos[vi+10] = -1000;
                pool.vLife[li] = pool.vLife[li+1] = pool.vLife[li+2] = pool.vLife[li+3] = 0;
                continue;
            }

            pool.vel[i*3+1] -= 16 * dt; // gravity

            const px = pool.pos[i*3], py = pool.pos[i*3+1], pz = pool.pos[i*3+2];
            const dx = pool.vel[i*3] * dt;
            const dy = pool.vel[i*3+1] * dt;
            const dz = pool.vel[i*3+2] * dt;

            // Axis-separated voxel collision — bounce off solid voxel faces
            const nx = px + dx;
            if (world.get(Math.floor(nx), Math.floor(py), Math.floor(pz))) {
                pool.vel[i*3] *= -0.5;
            } else {
                pool.pos[i*3] = nx;
            }

            const curX = pool.pos[i*3];
            const ny = py + dy;
            if (world.get(Math.floor(curX), Math.floor(ny), Math.floor(pz))) {
                if (Math.abs(pool.vel[i*3+1]) < 1.5) {
                    pool.vel[i*3+1] = 0;
                    pool.vel[i*3]   *= 0.6;
                    pool.vel[i*3+2] *= 0.6;
                } else {
                    pool.vel[i*3+1] *= -0.45;
                    pool.vel[i*3]   *= 0.75;
                    pool.vel[i*3+2] *= 0.75;
                }
            } else {
                pool.pos[i*3+1] = ny;
            }

            const curY = pool.pos[i*3+1];
            const nz = pz + dz;
            if (world.get(Math.floor(curX), Math.floor(curY), Math.floor(nz))) {
                pool.vel[i*3+2] *= -0.5;
            } else {
                pool.pos[i*3+2] = nz;
            }

            // Build camera-facing quad from the particle's physics position
            const qx = pool.pos[i*3], qy = pool.pos[i*3+1], qz = pool.pos[i*3+2];
            // v0 top-left
            pool.vPos[vi+0]  = qx - rx + ux; pool.vPos[vi+1]  = qy - ry + uy; pool.vPos[vi+2]  = qz - rz + uz;
            // v1 top-right
            pool.vPos[vi+3]  = qx + rx + ux; pool.vPos[vi+4]  = qy + ry + uy; pool.vPos[vi+5]  = qz + rz + uz;
            // v2 bottom-right
            pool.vPos[vi+6]  = qx + rx - ux; pool.vPos[vi+7]  = qy + ry - uy; pool.vPos[vi+8]  = qz + rz - uz;
            // v3 bottom-left
            pool.vPos[vi+9]  = qx - rx - ux; pool.vPos[vi+10] = qy - ry - uy; pool.vPos[vi+11] = qz - rz - uz;

            const l = pool.life[i];
            pool.vLife[li] = pool.vLife[li+1] = pool.vLife[li+2] = pool.vLife[li+3] = l;
        }
        if (active) {
            pool.geo.attributes.position.needsUpdate = true;
            pool.geo.attributes.life.needsUpdate = true;
        }
    }
}

// ── Chunk system ──────────────────────────────────────────────────────────────
const RENDER_DIST = 4;      // full resolution (LOD 1)
const MID_LOD_DIST = 8;     // medium resolution (LOD 2)
const MAX_LOD_DIST = 12;    // ultra-simple resolution (LOD 4)
const SUPER_LOD_DIST = 22;  // super ultra resolution (LOD 8)

const loadedChunks = new Map(); 
const buildQueue   = [];        
const pendingChunks = new Map(); // "key" -> pending LOD level
let lastPCX = null, lastPCZ = null, lastZone = null;
const DEEP_BOUNDARY = 100;
const LAVA_BOUNDARY = -100;

function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

// Initialize Worker
const meshWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

// Sync the biome seeds to the worker immediately to ensure identical world generation
meshWorker.postMessage({ type: 'initBiome', sx: bSeedX, sz: bSeedZ, inv: bOffset, mx: mSeedX, mz: mSeedZ });

meshWorker.onmessage = function(e) {
    if (e.data.type === 'meshResult') {
        const { cx, cy, cz, results, lod } = e.data;
        const key = chunkKey(cx, cy, cz);

        // Only clear pending status if the incoming mesh matches what we expected
        if (pendingChunks.get(key) === lod) {
            pendingChunks.delete(key);
        }

        // 2. If we just received an LOD chunk but a high-res one is already loaded, ignore.
        const current = loadedChunks.get(key);
        if (current && current.lod < lod) return;

        // 2. Remove old meshes ONLY now that the new ones are ready
        if (current) { for (const m of current.meshes) { scene.remove(m); m.geometry.dispose(); } }

        
        const meshes = [];
        for (const data of results) {
            if (!data) continue;
            const mat = MATS[data.type];
            if (!mat) continue; // unknown block type — skip rather than crash
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
            geo.setAttribute('uv',      new THREE.BufferAttribute(data.uvs, 2));
            geo.setAttribute('color',   new THREE.BufferAttribute(data.col, 3));
            geo.computeVertexNormals();
            geo.computeBoundingSphere();
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = true;
            m.receiveShadow = true;
            m.customDepthMaterial = curveDepthMat;
            scene.add(m);
            meshes.push(m);
        }
        
        loadedChunks.set(key, { meshes, lod });
    }
};

function rebuildChunk(cx, cy, cz, lod = 1) {
    const key = chunkKey(cx, cy, cz);
    // Request the mesh and mark as pending to avoid duplicate requests
    meshWorker.postMessage({ type: 'buildMesh', cx, cy, cz, lod, fullbright });
    pendingChunks.set(key, lod);
}

function updateChunkStream() {
    if (!player || !player.pos) return;
    const pcx = Math.floor(player.pos.x / CHUNK);
    const pcz = Math.floor(player.pos.z / CHUNK);
    // Zone detection: 0 = Overworld, 1 = Deep Stone, 2 = Lava
    const zone = player.pos.y >= DEEP_BOUNDARY ? 0 : (player.pos.y >= LAVA_BOUNDARY ? 1 : 2);

    if (pcx === lastPCX && pcz === lastPCZ && zone === lastZone) return;
    lastPCX = pcx; lastPCZ = pcz; lastZone = zone;

    // Build desired set with LOD levels
    const desired = new Map();
    let startCY, endCY;
    if (zone === 2) { startCY = MIN_CY; endCY = -7; } // Lava (includes boundary chunk -7)
    else if (zone === 1) { startCY = -7; endCY = 6; } // Deep Stone (boundaries -7 and 6)
    else { startCY = 6; endCY = MAX_CY; }            // Overworld (includes boundary chunk 6)

    for (let dx = -SUPER_LOD_DIST; dx <= SUPER_LOD_DIST; dx++)
    for (let cy = startCY; cy <= endCY; cy++)
    for (let dz = -SUPER_LOD_DIST; dz <= SUPER_LOD_DIST; dz++) {
        const key = chunkKey(pcx + dx, cy, pcz + dz);
        const dist = Math.max(Math.abs(dx), Math.abs(dz));
        let lod = 1;
        if (dist <= RENDER_DIST) lod = 1;
        else if (dist <= MID_LOD_DIST) lod = 2;
        else if (dist <= MAX_LOD_DIST) lod = 4;
        else lod = 8;
        desired.set(key, lod);
    }

    // Unload chunks that fell out of range
    for (const [key, entry] of loadedChunks) {
        if (!desired.has(key)) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
            loadedChunks.delete(key);
        }
    }

    // Enqueue newly visible chunks, closest first
    const toAdd = [];
    for (const [key, lod] of desired) {
        const entry = loadedChunks.get(key);
        const pendingLod = pendingChunks.get(key);

        // We need a rebuild if it's missing or lower quality than desired.
        // However, don't request it if there's already a request in flight 
        // that is equal to or better than the one we want.
        const needsUpgrade = !entry || entry.lod > lod;
        const isBetterPending = pendingLod !== undefined && pendingLod <= lod;

        if (needsUpgrade && !isBetterPending) {
            const [cx, cy, cz] = key.split(',').map(Number);
            const dist = (cx - pcx) ** 2 + (cz - pcz) ** 2;
            toAdd.push({ cx, cy, cz, dist, lod });
        }
    }

    toAdd.sort((a, b) => a.dist - b.dist);
    buildQueue.length = 0; // Clear stale requests
    for (const item of toAdd) buildQueue.push(item);
}

// Process a few chunks per frame to avoid frame drops
function processBuildQueue(max = 1) {
    for (let i = 0; i < max && buildQueue.length > 0; i++) {
        const { cx, cy, cz, lod } = buildQueue.shift();
        const key = chunkKey(cx, cy, cz);
        
        const entry = loadedChunks.get(key);
        if (entry && entry.lod <= lod) continue;

        const pendingLod = pendingChunks.get(key);
        if (pendingLod !== undefined && pendingLod <= lod) continue;

        rebuildChunk(cx, cy, cz, lod);
    }
}

// ── Pointer lock ──────────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
    overlay.style.display = (!document.pointerLockElement && !inventoryOpen) ? 'flex' : 'none';
});

// Prevent accidental tab closing with Ctrl+W (though browsers often restrict this for security)
window.addEventListener('keydown', e => {
    if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        showFeedback('Ctrl+W blocked');
    }
}, { capture: true });

// ── Hit highlight ─────────────────────────────────────────────────────────────
const highlightMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.4 })
);
highlightMesh.visible = false;
scene.add(highlightMesh);

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    hudCamera.aspect = window.innerWidth / window.innerHeight;
    hudCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Game loop ─────────────────────────────────────────────────────────────────
const rayDir = new THREE.Vector3();
const hud    = document.getElementById('hud');
const fpsDisplay = document.createElement('div');
fpsDisplay.style.cssText = 'position:fixed; top:20px; right:20px; color:white; font-family:monospace; font-size:14px; text-shadow:1px 1px 1px black; z-index:1001; display:none;';
document.body.appendChild(fpsDisplay);

const cmdInput = document.getElementById('command-input');
const cmdFeedback = document.getElementById('command-feedback');
let miningProgress = 0;
let miningTarget = null;
let miningParticleTimer = 0;
let last = performance.now();
let dynamiteMode = false;
let inceptionMode = false;
let fpsMode = false;
let flyMode = false;
let speedMultiplier = 1;
let fullbright = false;
let voxelMode = false;
let isFlying = false;
let lastKeyboardJumpState = false;
let isTransitioning = false;

function startMoonTransition() {
    isTransitioning = true;
    fadeOverlay.style.opacity = '1';

    setTimeout(() => {
        // Switch dimension
        world.dimension = DIM_MOON;
        meshWorker.postMessage({ type: 'setDimension', dim: DIM_MOON });
        curveUniforms.uPlanetRadius.value = MOON_PLANET_RADIUS;

        // Clear current meshes
        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
        }
        loadedChunks.clear();
        buildQueue.length = 0;
        pendingChunks.clear();

        // Spawn on Moon surface
        const tx = 8, tz = 8;
        const ty = world.surfaceAt(tx, tz) + 50;
        player.pos.set(tx, ty, tz);
        player.vel.set(0, -5, 0); // Start falling

        fadeOverlay.style.opacity = '0';
        setTimeout(() => isTransitioning = false, 1000);
    }, 1000);
}

function startEarthTransition() {
    isTransitioning = true;
    fadeOverlay.style.opacity = '1';

    setTimeout(() => {
        // Switch dimension
        world.dimension = DIM_EARTH;
        meshWorker.postMessage({ type: 'setDimension', dim: DIM_EARTH });
        curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;

        // Clear current meshes
        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
        }
        loadedChunks.clear();
        buildQueue.length = 0;
        pendingChunks.clear();

        // Spawn below the moon sphere in Earth
        // moonSphere in Earth is at (500, 1800, 20)
        player.pos.set(500, 1750, 20);
        player.vel.set(0, -10, 0); // Start falling

        fadeOverlay.style.opacity = '0';
        setTimeout(() => isTransitioning = false, 1000);
    }, 1000);
}

// ── Command Console ───────────────────────────────────────────────────────────
function showFeedback(message) {
    cmdFeedback.textContent = message;
    cmdFeedback.style.opacity = '1';
    setTimeout(() => {
        cmdFeedback.style.opacity = '0';
        setTimeout(() => { cmdFeedback.textContent = ''; }, 300);
    }, 2000);
}

// ── Command Autocomplete ──────────────────────────────────────────────────────
const BLOCK_BY_NAME = Object.fromEntries(
    Object.entries(ITEM_NAMES).map(([type, name]) => [name.toLowerCase(), Number(type)])
);

const CMD_REGISTRY = [
    { cmd: '/dynamite',   display: '/dynamite' },
    { cmd: '/fly',        display: '/fly' },
    { cmd: '/fps',        display: '/fps' },
    { cmd: '/fullbright', display: '/fullbright' },
    { cmd: '/inception',  display: '/inception' },
    { cmd: '/ptp',        display: '/ptp' },
    { cmd: '/re',         display: '/re' },
    { cmd: '/tpr',        display: '/tpr' },
    { cmd: '/tskip',      display: '/tskip' },
    { cmd: '/vox',        display: '/vox' },
    { cmd: '/give',       display: '/give <block> <count>',  multi: true },
    { cmd: '/speed',      display: '/speed <multiplier>',    multi: true },
    { cmd: '/tp',         display: '/tp <x> <y> <z>',       multi: true },
];

const cmdRecsEl = document.createElement('div');
cmdRecsEl.style.cssText = 'position:fixed;bottom:48px;left:14px;display:none;flex-direction:column;gap:5px;z-index:3100;pointer-events:auto;';
document.body.appendChild(cmdRecsEl);

function makeChip(label, onClick) {
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(0,0,0,0.88);border:1px solid rgba(255,255,255,0.25);color:#fff;font-family:monospace;font-size:12px;padding:3px 9px;border-radius:4px;cursor:pointer;white-space:nowrap;transition:border-color 0.12s,background 0.12s;';
    el.textContent = label;
    el.addEventListener('mouseenter', () => { el.style.borderColor='rgba(0,255,0,0.55)'; el.style.background='rgba(0,180,0,0.14)'; });
    el.addEventListener('mouseleave', () => { el.style.borderColor='rgba(255,255,255,0.25)'; el.style.background='rgba(0,0,0,0.88)'; });
    el.addEventListener('mousedown', e => { e.preventDefault(); onClick(); });
    return el;
}

function updateRecommendations() {
    const raw  = cmdInput.value;
    const lower = raw.toLowerCase();
    cmdRecsEl.innerHTML = '';

    if (raw.length <= 1) { cmdRecsEl.style.display = 'none'; return; }

    // Detect whether we're already inside a multi-part command
    let activeMulti = null;
    for (const entry of CMD_REGISTRY) {
        if (entry.multi && lower.startsWith(entry.cmd + ' ')) { activeMulti = entry; break; }
    }

    if (activeMulti) {
        // Template preview above the input
        const preview = document.createElement('div');
        preview.style.cssText = 'font-family:monospace;font-size:11px;color:rgba(255,255,255,0.38);padding:1px 2px;letter-spacing:0.04em;';
        preview.textContent = activeMulti.display;
        cmdRecsEl.appendChild(preview);

        // Block-name chips for /give
        if (activeMulti.cmd === '/give') {
            const afterCmd = raw.slice(activeMulti.cmd.length + 1);
            if (afterCmd.indexOf(' ') === -1) {
                const typed   = afterCmd.toLowerCase();
                const matches = Object.keys(BLOCK_BY_NAME).filter(n => n.startsWith(typed) && n !== typed);
                if (matches.length > 0) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
                    for (const name of matches.slice(0, 12)) {
                        row.appendChild(makeChip(name, () => {
                            cmdInput.value = '/give ' + name + ' ';
                            cmdInput.focus();
                            updateRecommendations();
                        }));
                    }
                    cmdRecsEl.appendChild(row);
                }
            }
        }
    } else {
        // Filter top-level commands by typed prefix
        const matches = CMD_REGISTRY.filter(e => e.cmd.startsWith(lower));
        if (matches.length === 0) { cmdRecsEl.style.display = 'none'; return; }

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
        for (const entry of matches) {
            row.appendChild(makeChip(entry.display, () => {
                if (entry.multi) {
                    cmdInput.value = entry.cmd + ' ';
                    cmdInput.focus();
                    updateRecommendations();
                } else {
                    cmdInput.value = entry.cmd;
                    cmdInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }
            }));
        }
        cmdRecsEl.appendChild(row);
    }

    cmdRecsEl.style.display = cmdRecsEl.children.length > 0 ? 'flex' : 'none';
}

cmdInput.addEventListener('input', updateRecommendations);

window.addEventListener('keydown', e => {
    if (e.key === '/' && (!cmdInput.style.display || cmdInput.style.display === 'none')) {
        e.preventDefault();
        cmdInput.style.display = 'block';
        cmdInput.value = '/';
        cmdInput.focus();
        cmdInput.setSelectionRange(1, 1);
    }
});

cmdInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = cmdInput.value.trim().toLowerCase();
        cmdInput.style.display = 'none';
        cmdInput.value = '';
        cmdInput.blur();
        
        if (cmd === '/dynamite') {
            dynamiteMode = !dynamiteMode;
            showFeedback(`dynamite ${dynamiteMode ? 'on' : 'off'}`);
        } else if (cmd === '/fps') {
            fpsMode = !fpsMode;
            fpsDisplay.style.display = fpsMode ? 'block' : 'none';
            showFeedback(`fps counter ${fpsMode ? 'on' : 'off'}`);
        } else if (cmd === '/inception') {
            inceptionMode = !inceptionMode;
            showFeedback(`inception mode ${inceptionMode ? 'on' : 'off'}`);
        } else if (cmd === '/re') {
            player.pos.set(8, 184, 8);
            player.vel.set(0, 0, 0);
            isFlying = false;
            camera.position.copy(player.getEyePosition());
            camera.rotation.copy(player.getCameraRotation());
            showFeedback('respawned');
        } else if (cmd === '/fly') {
            flyMode = !flyMode;
            isFlying = false;
            showFeedback(`fly mode ${flyMode ? 'on' : 'off'}`);
        } else if (cmd === '/fullbright') {
            fullbright = !fullbright;
            showFeedback(`fullbright ${fullbright ? 'on' : 'off'}`);
            for (const key of Array.from(loadedChunks.keys())) {
                const [cx, cy, cz] = key.split(',').map(Number);
                const entry = loadedChunks.get(key);
                rebuildChunk(cx, cy, cz, entry ? entry.lod : 1);
            }
        } else if (cmd === '/vox') {
            voxelMode = !voxelMode;
            meshWorker.postMessage({ type: 'setVoxelMode', voxelMode });
            setCollisionMode(voxelMode);
            showFeedback(`voxel mode ${voxelMode ? 'on' : 'off'}`);
            for (const key of Array.from(loadedChunks.keys())) {
                const [cx, cy, cz] = key.split(',').map(Number);
                const entry = loadedChunks.get(key);
                rebuildChunk(cx, cy, cz, entry ? entry.lod : 1);
            }
        } else if (cmd === '/tpr') {
            const currentBiome = world.getBiomeAt(player.pos.x, player.pos.z);
            let targetX, targetZ, targetY;
            let found = false;

            // Try multiple times to find a coordinate in a different biome
            for (let i = 0; i < 30; i++) {
                const ox = (Math.random() - 0.5) * 5000;
                const oz = (Math.random() - 0.5) * 5000;
                const nx = player.pos.x + ox;
                const nz = player.pos.z + oz;

                if (world.getBiomeAt(nx, nz) !== currentBiome) {
                    targetX = nx;
                    targetZ = nz;
                    targetY = world.surfaceAt(nx, nz) + 2;
                    found = true;
                    break;
                }
            }

            if (found) {
                player.pos.set(targetX, targetY, targetZ);
                player.vel.set(0, 0, 0);
                isFlying = false;
                showFeedback('teleported to different biome');
            } else {
                showFeedback('could not find a different biome nearby');
            }
        } else if (cmd === '/tskip') {
            currentCycleLength = (currentCycleLength === DEFAULT_CYCLE) ? FAST_CYCLE : DEFAULT_CYCLE;
            showFeedback(`time cycle: ${currentCycleLength === FAST_CYCLE ? '30s' : '26m'}`);
        } else if (cmd === '/ptp') {
            let targetX, targetZ, targetY;
            let found = false;

            // Sample many random locations to find a rare pyramid spawn point
            for (let i = 0; i < 150000; i++) {
                const tx = Math.floor(player.pos.x + (Math.random() - 0.5) * 20000);
                const tz = Math.floor(player.pos.z + (Math.random() - 0.5) * 20000);
                
                // Replicate the logic used in generateChunk to find a structure
                if (world.getBiomeAt(tx, tz) === BIOME_DESERT) {
                    const spawnRoll = hash(tx, 0, tz);
                    if (spawnRoll < PYRAMID_CHANCE && (tx % 3 === 0) && (tz % 3 === 0)) {
                        targetX = tx;
                        targetZ = tz;
                        targetY = world.surfaceAt(tx, tz) + 25; // Teleport higher for the larger pyramid
                        found = true;
                        break;
                    }
                }
            }

            if (found) {
                player.pos.set(targetX, targetY, targetZ);
                player.vel.set(0, 0, 0);
                showFeedback('teleported to desert pyramid');
            } else {
                showFeedback('could not locate a pyramid');
            }
        } else if (cmd.startsWith('/speed ')) {
            const val = parseFloat(cmd.split(/\s+/)[1]);
            if (!isNaN(val) && val > 0) {
                speedMultiplier = val;
                showFeedback(`speed set to ${val}x`);
            } else {
                showFeedback('usage: /speed <number>');
            }
        } else if (cmd.startsWith('/give ')) {
            const rest  = cmd.slice(6).trim();
            const words = rest.split(/\s+/);
            const last  = words[words.length - 1];
            let blockName, count;
            if (words.length >= 2 && /^\d+$/.test(last)) {
                count     = Math.max(1, parseInt(last));
                blockName = words.slice(0, -1).join(' ');
            } else {
                count     = 1;
                blockName = words.join(' ');
            }
            const giveType = BLOCK_BY_NAME[blockName];
            if (!giveType) {
                showFeedback(`unknown block: ${blockName}`);
            } else {
                let remaining = count;
                for (let i = 0; i < 9  && remaining > 0; i++) if (inventory[i]     && inventory[i].type     === giveType) { inventory[i].count     += remaining; remaining = 0; }
                for (let i = 0; i < 27 && remaining > 0; i++) if (mainInventory[i] && mainInventory[i].type === giveType) { mainInventory[i].count += remaining; remaining = 0; }
                for (let i = 0; i < 9  && remaining > 0; i++) if (!inventory[i])     { inventory[i]     = { type: giveType, count: remaining }; remaining = 0; }
                for (let i = 0; i < 27 && remaining > 0; i++) if (!mainInventory[i]) { mainInventory[i] = { type: giveType, count: remaining }; remaining = 0; }
                updateInventoryUI();
                if (inventoryOpen) updateInventoryOverlay();
                showFeedback(`gave ${count}× ${ITEM_NAMES[giveType]}`);
            }
        } else if (cmd.startsWith('/tp ')) {
            const args = cmd.split(/\s+/);
            if (args.length === 4) {
                const x = parseFloat(args[1]);
                const y = parseFloat(args[2]);
                const z = parseFloat(args[3]);
                if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                    player.pos.set(x, y, z);
                    player.vel.set(0, 0, 0);
                    isFlying = false;
                    camera.position.copy(player.getEyePosition());
                    camera.rotation.copy(player.getCameraRotation());
                    showFeedback(`teleported to ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`);
                } else {
                    showFeedback('invalid coordinates');
                }
            } else {
                showFeedback('usage: /tp x y z');
            }
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cmdInput.style.display = 'none';
        cmdInput.value = '';
        cmdInput.blur();
    }
});

cmdInput.addEventListener('blur', () => {
    cmdInput.style.display = 'none';
    cmdInput.value = '';
    cmdRecsEl.style.display = 'none';
});

function placeBlock(x, y, z, type) {
    // Temporarily place the block to check for player collision
    const prev = world.get(x, y, z);
    world.set(x, y, z, type);
    if (overlaps(world, player.pos.x, player.pos.y, player.pos.z)) {
        world.set(x, y, z, prev); // Revert placement
        return false;
    }

    // Notify the worker so its shadow world stays in sync
    meshWorker.postMessage({ type: 'setVoxel', x, y, z, v: type });
    updateAffectedChunks(x, y, z);
    world.updateLightAt(x, y, z);
    return true;
}

function mineBlock(x, y, z) {
    const type = world.get(x, y, z);
    world.set(x, y, z, 0); // clear before spawning drop so it lands in air
    world.updateLightAt(x, y, z);
    meshWorker.postMessage({ type: 'setVoxel', x, y, z, v: 0 });
    if (type !== 0) {
        spawnDrop(type, x, y, z);
        spawnParticles(type, x + 0.5, y + 0.5, z + 0.5, 14, 5);
    }
    updateAffectedChunks(x, y, z);
}

function performBreak(hit) {
    if (dynamiteMode) {
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++)
                    mineBlock(hit.x + dx, hit.y + dy, hit.z + dz);
    } else {
        mineBlock(hit.x, hit.y, hit.z);
    }
}

function updateAffectedChunks(x, y, z) {
    for (const [cx, cy, cz] of world.affectedChunks(x, y, z)) {
        const entry = loadedChunks.get(chunkKey(cx, cy, cz));
        if (entry) rebuildChunk(cx, cy, cz, entry.lod);
    }
}


// ── Gameplay ──────────────────────────────────────────────────────────────────

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt  = Math.min((now - last) / 1000, 0.05);
    last = now;

    input.update();

    // ── Hotbar Selection ─────────────────────────────────────────────────────
    if (!inventoryOpen) {
        for (let i = 1; i <= 9; i++) {
            if (input.isDown('Digit' + i)) {
                if (selectedSlot !== i - 1) {
                    selectedSlot = i - 1;
                    updateInventoryUI();
                }
            }
        }
    }

    // ── Day/Night Cycle ──────────────────────────────────────────────────────
    gameTime = (gameTime + dt) % currentCycleLength;
    const sunAngle = (gameTime / currentCycleLength) * Math.PI * 2;
    const sunYMult = Math.sin(sunAngle);
    // Remap sun position to a smooth 0-1 range for a much more gradual lighting transition
    const dayIntensity = THREE.MathUtils.smoothstep(sunYMult, -0.5, 0.5); 

    if (fpsMode) {
        fpsDisplay.textContent = `fps ${Math.round(1 / dt)}`;
    }

    updateParticles(dt);
    updateDrops(dt);

    // ── Atmosphere & Space Transitions ────────────────────────────────────────
    // We move this above the early return so the sky/terrain updates even if input isn't locked
    const biome = world.getBiomeAt(player.pos.x, player.pos.z);
    let biomeSky = forestSkyColor;
    if (biome === BIOME_DESERT) biomeSky = desertSkyColor;
    else if (biome === BIOME_TUNDRA) biomeSky = tundraSkyColor;

    currentSkyColor.lerp(biomeSky, dt * 2);

    const isMoon = world.dimension === DIM_MOON;

    // Darken biome sky based on sun position
    tempColor.copy(currentSkyColor).lerp(nightSkyColor, 1 - dayIntensity);

    const height = player.pos.y;

    // Transition starts at cloud height (170) and reaches vacuum by y=430
    const spaceT = isMoon ? 1 : Math.min(Math.max((height - CLOUD_Y) / 260, 0), 1);
    
    scene.background.lerpColors(tempColor, spaceColor, spaceT);
    if (isMoon) {
        scene.background.copy(spaceColor);
        scene.fog.density = 0;
    } else {
        scene.fog.color.copy(scene.background);
        scene.fog.density = (0.006 + (1 - dayIntensity) * 0.004) * (1 - spaceT);
    }

    // ── Deep Stone Transition Fog ─────────────────────────────────────────────
    // Hides the vertical chunk loading/unloading at y=100
    const distToTrans = Math.abs(height - DEEP_BOUNDARY);
    const transFog = Math.min(Math.max(1.0 - distToTrans / 25, 0), 1);
    if (transFog > 0) {
        const voidCol = new THREE.Color(0x020205);
        scene.background.lerp(voidCol, transFog);
        scene.fog.color.copy(scene.background);
        scene.fog.density += transFog * 0.12;
    }

    // ── Lava Transition Fog ───────────────────────────────────────────────────
    const lavaDist = Math.abs(height - LAVA_BOUNDARY);
    const lavaFogT = Math.min(Math.max(1.0 - lavaDist / 25, 0), 1);
    if (lavaFogT > 0) {
        const lavaCol = new THREE.Color(0x330505);
        scene.background.lerp(lavaCol, lavaFogT);
        scene.fog.color.set(0x440505); // Deeper red for the lava layer fog
        scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, 0.15, lavaFogT);
    }

    sunLight.intensity = dayIntensity;
    ambientLight.intensity = 0.1 + 0.3 * dayIntensity;

    starSphere.material.opacity = isMoon ? 1 : spaceT;
    starSphere.position.copy(player.pos);

    // ── Terrain Fade ──────────────────────────────────────────────────────────
    // Terrain is opaque at y=500 and fully transparent at y=540
    const terrainOpacity = Math.min(Math.max(1 - (height - 500) / 40, 0), 1);
    for (const m of Object.values(MATS)) {
        m.opacity = terrainOpacity;
        m.depthWrite = terrainOpacity > 0.5;
    }

    // Planet sphere positions + opacity.
    // Opacity is driven solely by terrainOpacity in DIM_EARTH so the spheres are
    // never culled by any other mechanism — they fade in as terrain fades out.
    if (isMoon) {
        earthSphere.position.set(player.pos.x, 1000, player.pos.z);
        earthSphere.rotation.x = -Math.PI / 2;
        earthSphere.material.opacity = 1; // Earth always fully visible from the moon

        moonSphere.position.set(player.pos.x, -700, player.pos.z);
        moonSphere.rotation.x = Math.PI / 2;
        moonSphere.material.opacity = 0; // You're on the moon — don't show it as a sphere

        if (!isTransitioning && player.pos.y > 470) {
            startEarthTransition();
        }
    } else {
        earthSphere.position.x = player.pos.x;
        earthSphere.position.z = player.pos.z;
        earthSphere.material.opacity = 1 - terrainOpacity; // fades in as terrain fades out

        moonSphere.position.set(500, 1800, 20);
        moonSphere.rotation.x = -Math.PI / 2;
        moonSphere.material.opacity = 1 - terrainOpacity;

        if (!isTransitioning && world.dimension === DIM_EARTH && player.pos.distanceTo(moonSphere.position) < 600) {
            startMoonTransition();
        }
    }

    earthSphere.rotation.y += dt * 0.05;
    moonSphere.rotation.y += dt * 0.02;

    cloudMeshes.forEach((m, i) => {
        const hPct = i / (CLOUD_LAYERS - 1);
        m.material.opacity = isMoon ? 0 : (0.7 + hPct * 0.3) * (1 - spaceT);
        m.visible = !isMoon;
    });

    updateChunkStream();
    processBuildQueue(3);

    overlay.style.display = (input.locked || input.hasGamepad() || inventoryOpen) ? 'none' : 'flex';
    if (!input.locked && !input.hasGamepad() && !inventoryOpen) {
        renderer.render(scene, camera);
        return;
    }

    if (inventoryOpen) {
        renderer.render(scene, camera);
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(hudScene, hudCamera);
        renderer.autoClear = true;
        return;
    }

    // ── Flight mode detection ─────────────────────────────────────────────────
    if (flyMode) {
        const keyboardJump = input.isDown('Space');
        const doubleJumpDetected = input.checkDoubleJump();
        
        if ((keyboardJump && !lastKeyboardJumpState) || doubleJumpDetected) {
            isFlying = !isFlying;
            if (isFlying) showFeedback('flying');
            else showFeedback('landed');
        }
        lastKeyboardJumpState = keyboardJump;
    }

    // ── Apply flight movement before player update ────────────────────────────
    if (isFlying) {
        const flySpeed = 20 * speedMultiplier;
        if (input.isFlyUp()) player.vel.y = flySpeed;
        else if (input.isFlyDown()) player.vel.y = -flySpeed;
        else player.vel.y = 0;
    }

    player.update(dt, input, isFlying, inceptionMode, speedMultiplier);

    // ── FOV Running Effect ────────────────────────────────────────────────────
    const isRunning = (input.isDown('ControlLeft') || input.isDown('ControlRight')) && !isFlying;
    const horizontalSpeed = Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);
    const targetFOV = (isRunning && horizontalSpeed > 0.1) ? 82 : 70;
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, dt * 6);
    camera.updateProjectionMatrix();

    // ── Flight collision check ───────────────────────────────────────────────
    if (isFlying) {
        player.onGround = false;
    }

    if (player && player.pos) {
        camera.position.copy(player.getEyePosition());
        camera.rotation.copy(player.getCameraRotation());

        curveUniforms.uCamXZ.value.set(camera.position.x, camera.position.z);

        cloudGroup.position.x = player.pos.x;
        cloudGroup.position.z = player.pos.z;

        // Move the sun relative to the player
        const sunDist = 150;
        const sx = Math.cos(sunAngle) * sunDist; // Shadows will shift directionally
        const sy = Math.sin(sunAngle) * sunDist; // Sun sets/rises
        sunLight.position.set(player.pos.x + sx, player.pos.y + sy, player.pos.z + 50);
        sunLight.target.position.set(player.pos.x, player.pos.y, player.pos.z);
    }
    cloudTexture.offset.x += dt * 0.0024;
    cloudTexture.offset.y += dt * 0.0018;

    // Mining
    camera.getWorldDirection(rayDir);
    const hit = raycastVoxel(world, camera.position, rayDir, 12);

    if (hit) {
        highlightMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        highlightMesh.visible = true;

        if (hit.face && input.flushSecondaryClick()) {
            const item = inventory[selectedSlot];
            if (item && item.count > 0) {
                const nx = hit.x + hit.face[0];
                const ny = hit.y + hit.face[1];
                const nz = hit.z + hit.face[2];
                if (placeBlock(nx, ny, nz, item.type)) {
                    item.count--;
                    updateInventoryUI();
                    heldPlaceAnim = 1;
                }
            }
        }

        const targetKey = `${hit.x},${hit.y},${hit.z}`;
        if (miningTarget !== targetKey) {
            miningTarget = targetKey;
            miningProgress = 0;
            miningParticleTimer = 0;
        }

        const blockType = world.get(hit.x, hit.y, hit.z);
        const breakTime = BREAK_TIMES[blockType] ?? 0.2;

        if (input.flushClick() || input.mouseHeld || input.isMining()) {
            isBreaking = true;
            if (breakTime === 0 || dynamiteMode) {
                performBreak(hit);
            } else {
                miningProgress += dt;
                miningParticleTimer -= dt;
                if (miningParticleTimer <= 0) {
                    const fx = hit.face ? hit.face[0] : 0;
                    const fy = hit.face ? hit.face[1] : 0;
                    const fz = hit.face ? hit.face[2] : 0;
                    // Spawn at the face surface (hit.face points toward the player, away from solid)
                    spawnParticles(blockType,
                        hit.x + 0.5 + fx * 0.6,
                        hit.y + 0.5 + fy * 0.6,
                        hit.z + 0.5 + fz * 0.6, 2, 2);
                    miningParticleTimer = 0.1;
                }
                if (miningProgress >= breakTime) {
                    performBreak(hit);
                    miningProgress = 0;
                }
            }
        } else {
            miningProgress = 0;
            miningParticleTimer = 0;
        }
    } else {
        highlightMesh.visible = false;
        miningTarget = null;
        miningProgress = 0;
        miningParticleTimer = 0;
        input.flushClick();
    }

    if (player && player.pos) {
        const p = player.pos;
        hud.textContent = `xyz  ${p.x.toFixed(1)}  ${p.y.toFixed(1)}  ${p.z.toFixed(1)}`;
    }

    // ── Held item / hand ─────────────────────────────────────────────────────
    // Detect slot change — kick off exit animation
    if (selectedSlot !== prevSelectedSlot && slotSwapState === 'idle') {
        prevSelectedSlot = selectedSlot;
        slotSwapState = 'exit';
    }

    // Drive slot-swap Y animation
    if (slotSwapState === 'exit') {
        slotSwapY -= dt * 10;
        if (slotSwapY <= -1.6) {
            // Off screen — swap the visual now so the enter phase shows the new item
            const newItem = inventory[selectedSlot];
            const newType = newItem?.type ?? 0;
            const newHasItem = newType > 0 && (newItem?.count ?? 0) > 0;
            heldMesh.material = getHudMat(newType > 0 ? newType : 1);
            heldMesh.visible = newHasItem;
            lastHeldType = newType;
            slotSwapY = -1.6;
            slotSwapState = 'enter';
        }
    } else if (slotSwapState === 'enter') {
        slotSwapY = THREE.MathUtils.lerp(slotSwapY, 0, dt * 14);
        if (Math.abs(slotSwapY) < 0.01) {
            slotSwapY = 0;
            slotSwapState = 'idle';
        }
    }

    // Poll every 0.2 s to catch count changes (items running out) between swaps
    heldCheckTimer -= dt;
    if (heldCheckTimer <= 0) {
        heldCheckTimer = 0.2;
        if (slotSwapState === 'idle') {
            const polledItem = inventory[selectedSlot];
            const polledType = polledItem?.type ?? 0;
            const hasItem = polledType > 0 && (polledItem?.count ?? 0) > 0;
            if (polledType !== lastHeldType) {
                heldMesh.material = getHudMat(polledType > 0 ? polledType : 1);
                lastHeldType = polledType;
            }
            heldMesh.visible = hasItem;
        }
    }

    // Every frame: swap hand models based on breaking state; reset flag for next frame
    const handHasItem = heldMesh.visible;
    handGroup.visible = !handHasItem && !isBreaking;
    handBreakGroup.visible = !handHasItem && isBreaking;
    isBreaking = false;

    // Breaking swing: accumulate time while swinging, reset when idle
    if (handBreakGroup.visible || (heldMesh.visible && breakSwingTime > 0)) {
        breakSwingTime += dt;
    } else if (!isBreaking) {
        breakSwingTime = 0;
    }
    const swingZ = -Math.abs(Math.sin(breakSwingTime * Math.PI * 4)) * 0.45;

    // Decay place-forward animation
    heldPlaceAnim *= Math.pow(0.01, dt);

    // Project world-space player velocity onto camera's screen axes for inertia
    _hudRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _hudUp.setFromMatrixColumn(camera.matrixWorld, 1);
    _hudVel.set(player.vel.x, player.vel.y, player.vel.z);
    const tx = -_hudVel.dot(_hudRight) * 0.008;
    const ty = -_hudVel.dot(_hudUp)    * 0.008;

    heldOff.vx = (heldOff.vx + (tx - heldOff.x) * 14 * dt) * 0.85;
    heldOff.vy = (heldOff.vy + (ty - heldOff.y) * 14 * dt) * 0.85;
    heldOff.x += heldOff.vx;
    heldOff.y += heldOff.vy;

    const hudPosX = 0.9 + heldOff.x;
    const hudPosY = -0.55 + heldOff.y + slotSwapY;
    const hudPosZ = swingZ - heldPlaceAnim * 0.6;
    heldMesh.position.set(hudPosX, hudPosY, hudPosZ);
    handGroup.position.set(hudPosX, hudPosY, hudPosZ);
    handBreakGroup.position.set(hudPosX, hudPosY, hudPosZ);

    renderer.render(scene, camera);
    // Render the HUD cube on top without clearing the colour buffer
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(hudScene, hudCamera);
    renderer.autoClear = true;
}

animate();

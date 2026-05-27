import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    VoxelWorld, CHUNK, MIN_Y, MAX_Y, MIN_CY, MAX_CY, BIOME_FOREST, BIOME_DESERT, BIOME_TUNDRA, DIM_EARTH, DIM_MOON, DIM_WATER, DIM_FATES,
    SAND, PYRAMID_CHANCE, hash, bSeedX, bSeedZ, bOffset, mSeedX, mSeedZ,
    GRASS, DIRT, STONE, WOOD, LEAVES, SANDSTONE, CACTUS, ICE, PFROST, IGRASS, PINEWOOD, PINELEAVES, DEEPSTONE, LAVAROCK, MOLTENROCK, MOONSTONE,
    WOODPLANKS, WORKBENCH, WOODCHIP, FLINT, WATER, STICK, WOODPICK, MOON_MOUNTAIN_ROCK, STONEPICK, IRON_ORE, LEAD_ORE,
    VOIDGRASS, VOIDDIRT, VOIDSTONE, VOIDWOOD, VOIDLEAVES,
    syncBiomeParams, newRandomSeeds, findFatesSmoothSpawn
} from '../world/world.js';
import { listWorlds, saveWorld, loadWorld } from '../world/save.js';
import { buildChunkMesh } from '../building/mesher.js';
import { Player, EYE_HEIGHT, overlaps, setCollisionMode, sampleDensity } from '../player/player.js';
import { Input } from '../player/input.js';
import { raycastVoxel } from '../mining/raycast.js';
import { initClouds, cloudLayerGroups, CLOUD_FIELD_R } from '../rendering/clouds.js';
import { initSpace, starSphere, earthSphere, cloudSphere, atmosphereSphere, moonSphere, moonAtmosSphere, atmosphereMat, moonAtmosMat } from '../rendering/space.js';
import { initParticles, spawnParticles, updateParticles } from '../rendering/particles.js';
import { initSlimes, slimes, CREATURE_BY_NAME, updateSlimes, tryPunchSlime, spawnCreatureAt } from '../entities/slimes.js';
import { initWraithLeviathans, updateWraithLeviathans, spawnWraithLeviathan, setWraithIgnoreDay, wraithLeviathans } from '../entities/wraith_leviathans.js';
import { initGravestones, gravestones, placeGravestone, updateGraveMining } from '../entities/gravestones.js';
import { initHealth, getIsDead, getPlayerHealth, damagePlayer, updateHealth, updateVignette, updateDeathSequence, triggerDamageVignette } from '../gameplay/health.js';
import { showDialogue, updateDialogue } from '../gameplay/dialogue.js';
import { FATES_DIALOGUE, FATES_DIALOGUE_RETURN } from '../gameplay/fates_dialogue_lines.js';
import { NetworkManager } from './network.js';
import { WS_URL, HTTP_URL } from '../config.js';

const net           = new NetworkManager();
const remotePlayers = new Map(); // id -> { model, labelEl, pos, targetPos, yaw, walkCycle }
let isLanOpen     = false;
let localUsername  = '';
let localModel     = null; // { scene, rightArm, leftArm, rightLeg, leftLeg, walkCycle }
let playerModelTemplate = null;
let thirdPerson    = false;
let scOpen         = false;

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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
const waterSkyColor  = new THREE.Color(0x0a2a4a);
const fatesSkyColor  = new THREE.Color(0x5a00aa);
const currentSkyColor = forestSkyColor.clone();
const spaceColor = new THREE.Color(0x020205);
const nightSkyColor  = new THREE.Color(0x050510);
const dawnDuskColor  = new THREE.Color(1.0, 0.35, 0.08);
const tempColor = new THREE.Color();

const DEFAULT_CYCLE = 1560; // 26 minutes
const FAST_CYCLE = 30; // 30 seconds
let currentCycleLength = DEFAULT_CYCLE;
let gameTime = DEFAULT_CYCLE * 0.25; // Start at noon

// Only these blocks can be mined bare-handed. Anything not listed is Infinity (unbreakable).
const BREAK_TIMES = {
    [GRASS]:     0.4,
    [IGRASS]:    0.4,
    [SAND]:      0.5,
    [WOOD]:      3.0,
    [PINEWOOD]:  3.0,
    [LEAVES]:    0,   // Instant
    [PINELEAVES]:0,   // Instant
    [VOIDWOOD]:  4.0,
    [VOIDLEAVES]:0,   // Instant
};

// Break-time overrides when the player holds a Wood Chip.
// Also unlocks DIRT which is absent from BREAK_TIMES.
const WOODCHIP_BREAK_TIMES = {
    [WOOD]:     1.5,
    [PINEWOOD]: 1.5,
    [VOIDWOOD]: 2.0,
    [DIRT]:     2.0,
};

const WOODPICK_BREAK_TIMES = {
    [STONE]: 2.0,
    [DIRT]:  1.0,
};

const STONEPICK_BREAK_TIMES = {
    [STONE]:    1.5,
    [DIRT]:     0.5,
    [IRON_ORE]: 2.5,
    [LEAD_ORE]: 3.0,
};

scene.background = currentSkyColor.clone();
scene.fog = new THREE.FogExp2(currentSkyColor, 0.006);

// ── Lighting ──────────────────────────────────────────────────────────────────
const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.camera.far = 500;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);
scene.add(sunLight.target);

// Dim blue-white light from the opposite direction of the sun — active at night.
const moonLight = new THREE.DirectionalLight(0xc8d8ff, 0.0);
moonLight.castShadow = false;
scene.add(moonLight);
scene.add(moonLight.target);

// Sky/ground hemisphere tint for more natural bounce lighting.
const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a3a20, 0.25);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
scene.add(ambientLight);

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 8000);

// No scene lights — brightness comes entirely from baked sky-light vertex colours.

// ── Textures & materials ──────────────────────────────────────────────────────
const gameTextures = [];

function loadTex(path) {
    const t = new THREE.TextureLoader().load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    gameTextures.push(t);
    return t;
}

let bilinearFiltering = false;
function applyFilterMode() {
    const mag = bilinearFiltering ? THREE.LinearFilter : THREE.NearestFilter;
    const min = bilinearFiltering ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;
    for (const t of gameTextures) {
        t.magFilter = mag;
        t.minFilter = min;
        t.needsUpdate = true;
    }
}

// ── Gerstner wave water shader ────────────────────────────────────────────────
// waterUniforms.uCamXZ / uPlanetRadius are assigned after curveUniforms is declared (below)
const waterUniforms = {
    uTime:         { value: 0 },
    uCamXZ:        { value: new THREE.Vector2(0, 0) }, // replaced after curveUniforms init
    uPlanetRadius: { value: 2500 },                    // replaced after curveUniforms init
    fogColor:      { value: new THREE.Color(0x000000) },
    fogDensity:    { value: 0.006 },
};

const WATER_VERT = /* glsl */`
#define PI 3.14159265359

uniform float uTime;
uniform vec2  uCamXZ;
uniform float uPlanetRadius;

attribute vec3 color;
varying   vec3 vColor;
varying   vec3 vWorldNormal;
varying   vec3 vWorldPos;

// Returns (XZ horizontal displacement, Y displacement) for one Gerstner wave
vec3 gerstnerDisp(vec2 xz, vec2 dir, float amp, float len, float speed, float steep) {
    float k     = 2.0 * PI / len;
    float omega = sqrt(9.8 * k);
    float f     = k * dot(dir, xz) - omega * speed * uTime;
    return vec3(steep * amp * dir.x * cos(f),
                amp * sin(f),
                steep * amp * dir.y * cos(f));
}

// Returns the surface-normal contribution of the same wave
vec3 gerstnerNorm(vec2 xz, vec2 dir, float amp, float len, float speed, float steep) {
    float k     = 2.0 * PI / len;
    float omega = sqrt(9.8 * k);
    float f     = k * dot(dir, xz) - omega * speed * uTime;
    float WA    = k * amp;
    return vec3(-dir.x * WA * cos(f),
                -steep * WA * sin(f),
                -dir.y * WA * cos(f));
}

void main() {
    vec3 pos = position;
    vec2 xz  = pos.xz;

    // Sum four Gerstner waves
    vec3 disp = vec3(0.0);
    vec3 norm = vec3(0.0, 1.0, 0.0);

    disp += gerstnerDisp(xz, normalize(vec2( 1.0,  0.8)), 0.22, 12.0, 1.00, 0.45);
    norm += gerstnerNorm(xz, normalize(vec2( 1.0,  0.8)), 0.22, 12.0, 1.00, 0.45);

    disp += gerstnerDisp(xz, normalize(vec2(-0.7,  1.0)), 0.14,  8.0, 0.90, 0.38);
    norm += gerstnerNorm(xz, normalize(vec2(-0.7,  1.0)), 0.14,  8.0, 0.90, 0.38);

    disp += gerstnerDisp(xz, normalize(vec2( 0.3, -1.0)), 0.07,  4.5, 1.20, 0.28);
    norm += gerstnerNorm(xz, normalize(vec2( 0.3, -1.0)), 0.07,  4.5, 1.20, 0.28);

    disp += gerstnerDisp(xz, normalize(vec2(-1.0, -0.4)), 0.035, 2.5, 1.50, 0.18);
    norm += gerstnerNorm(xz, normalize(vec2(-1.0, -0.4)), 0.035, 2.5, 1.50, 0.18);

    pos += disp;
    vWorldNormal = normalize(norm);

    // Planet curvature (identical to other terrain materials)
    vec4 wp4 = modelMatrix * vec4(pos, 1.0);
    float dx = wp4.x - uCamXZ.x;
    float dz = wp4.z - uCamXZ.y;
    pos.y -= (dx * dx + dz * dz) / (2.0 * uPlanetRadius);

    vColor    = color;
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const WATER_FRAG = /* glsl */`
uniform vec3  fogColor;
uniform float fogDensity;

varying vec3 vColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
    vec3  N       = normalize(vWorldNormal);
    vec3  V       = normalize(cameraPosition - vWorldPos);
    float NdotV   = max(dot(N, V), 0.0);
    float fresnel  = pow(1.0 - NdotV, 3.5);

    vec3 waterDeep    = vec3(0.02, 0.14, 0.32);
    vec3 waterShallow = vec3(0.10, 0.46, 0.60);
    vec3 waterColor   = mix(waterDeep, waterShallow, fresnel * 0.6);

    // Simple Blinn-Phong sun highlight
    vec3  sunDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3  H      = normalize(sunDir + V);
    float spec   = pow(max(dot(N, H), 0.0), 96.0);

    vec3  col   = waterColor * vColor + vec3(1.0) * spec * 0.9;
    float alpha = clamp(mix(0.50, 0.88, fresnel) + spec * 0.25, 0.0, 1.0);

    // Exponential-squared fog
    float dist    = length(vWorldPos - cameraPosition);
    float fogFact = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
    col = mix(col, fogColor, fogFact);

    gl_FragColor = vec4(col, alpha);
}
`;

// ── Planet curve ──────────────────────────────────────────────────────────────
// Shared uniforms updated every frame / on dimension switch.
// All terrain materials reference the same objects so one write propagates.
const EARTH_PLANET_RADIUS = 1200; // blocks — larger = flatter
const MOON_PLANET_RADIUS  = 1000; // Moon is smaller, curves more sharply
const curveUniforms = {
    uCamXZ:        { value: new THREE.Vector2(0, 0) },
    uPlanetRadius: { value: EARTH_PLANET_RADIUS },
};
// Share planet-curve uniforms with the water shader
waterUniforms.uCamXZ        = curveUniforms.uCamXZ;
waterUniforms.uPlanetRadius = curveUniforms.uPlanetRadius;

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
    1:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/forest/grass.png'),          vertexColors: true, transparent: true, fog: false }),
    2:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/forest/dirt.png'),           vertexColors: true, transparent: true, fog: false }),
    3:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/forest/stone.png'),          vertexColors: true, transparent: true, fog: false }),
    4:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/forest/wood.png'),           vertexColors: true, transparent: true, fog: false }),
    5:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/forest/leaves.png'),         vertexColors: true, transparent: true, fog: false, alphaTest: 0.05 }),
    6:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/desert/sand.png'),           vertexColors: true, transparent: true, fog: false }),
    7:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/desert/sandstone.png'),      vertexColors: true, transparent: true, fog: false }),
    8:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/desert/cactus.png'),         vertexColors: true, transparent: true, fog: false }),
    9:  new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/snow/ice.png'),              vertexColors: true, transparent: true, fog: false }),
    10: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/snow/pfrost.png'),           vertexColors: true, transparent: true, fog: false }),
    11: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/snow/igrass.png'),           vertexColors: true, transparent: true, fog: false }),
    12: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/snow/pinewood.png'),         vertexColors: true, transparent: true, fog: false }),
    13: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/snow/iceleaves.png'),        vertexColors: true, transparent: true, fog: false, alphaTest: 0.05 }),
    14: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/underground/deepstone.png'), vertexColors: true, transparent: true, fog: false }),
    15: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/underground/lavarock.png'),  vertexColors: true, transparent: true, fog: false }),
    16: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/underground/moltenrock.png'),vertexColors: true, transparent: true, fog: false }),
    17: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/moon/moonstone.png'),        vertexColors: true, transparent: true, fog: false }),
    25: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/moon/moon_mountain_rock.png'), vertexColors: true, transparent: true, fog: false }),
    26: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/fates/voidgrass.png'),        vertexColors: true, transparent: true, fog: false }),
    27: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/fates/voiddirt.png'),         vertexColors: true, transparent: true, fog: false }),
    28: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/fates/voidstone.png'),        vertexColors: true, transparent: true, fog: false }),
    29: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/fates/voidwood.png'),         vertexColors: true, transparent: true, fog: false }),
    30: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/fates/voidleaves.png'),       vertexColors: true, transparent: true, fog: false, alphaTest: 0.05 }),
    18: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/crafted/woodplanks.png'),    vertexColors: true, transparent: true, fog: false, side: THREE.DoubleSide }),
    22: new THREE.ShaderMaterial({ uniforms: waterUniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    32: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/underground/iron.png'),       vertexColors: true, transparent: true, fog: false }),
    33: new THREE.MeshLambertMaterial({ map: loadTex('assets/prototype/underground/lead.png'),       vertexColors: true, transparent: true, fog: false }),
};

for (const [type, mat] of Object.entries(MATS)) {
    if (Number(type) !== 22) applyPlanetCurve(mat); // water shader handles curve itself
}

// HUD_MATS fallback for WORKBENCH — used only for item drops (GLB handles world + held rendering)
// Populated after HUD_MATS loop below via workbench GLB load callback.

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
    if (Number(type) === 22) continue; // water uses ShaderMaterial, not holdable
    HUD_MATS[Number(type)] = new THREE.MeshLambertMaterial({
        map: m.map,
        transparent: m.transparent,
        alphaTest: m.alphaTest ?? 0,
    });
}
// WORKBENCH drops render as a small planks cube; the GLB handles held + world visuals.
HUD_MATS[WORKBENCH] = HUD_MATS[WOODPLANKS];
HUD_MATS[WOODCHIP]  = HUD_MATS[WOOD];
HUD_MATS[FLINT]     = HUD_MATS[STONE];

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

const _dropFrustum = new THREE.Frustum();
const _dropProjMatrix = new THREE.Matrix4();

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
    camera.updateMatrixWorld();
    _dropProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _dropFrustum.setFromProjectionMatrix(_dropProjMatrix);

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

        // Position + bob + spin — only update transform when in view
        const inFrustum = _dropFrustum.containsPoint(d.pos);
        d.mesh.visible = inFrustum;
        if (inFrustum) {
            d.mesh.position.set(d.pos.x, d.pos.y + Math.sin(d.age * 3 + d.spinY) * 0.06, d.pos.z);
            d.mesh.rotation.y = d.spinY;
        }
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

// ── Workbench GLB ─────────────────────────────────────────────────────────────
let workbenchTemplate = null;
const workbenchInstances = new Map(); // `${x},${y},${z}` → THREE.Group in scene

// Held workbench shown in HUD instead of the standard box mesh
const heldWorkbenchGroup = new THREE.Group();
heldWorkbenchGroup.rotation.order = 'YXZ';
heldWorkbenchGroup.rotation.x = -0.3;
heldWorkbenchGroup.rotation.y = 0.7;
heldWorkbenchGroup.visible = false;
hudScene.add(heldWorkbenchGroup);

new GLTFLoader().load('assets/models/workbench.glb', (gltf) => {
    workbenchTemplate = gltf.scene;

    // Compute normalisation so the model fills one voxel unit
    const _wb = new THREE.Box3().setFromObject(workbenchTemplate);
    const _wbSize = new THREE.Vector3();
    _wb.getSize(_wbSize);
    const _wbScale = 1.0 / Math.max(_wbSize.x, _wbSize.y, _wbSize.z);
    const _wbCenter = new THREE.Vector3();
    _wb.getCenter(_wbCenter);
    workbenchTemplate.scale.setScalar(_wbScale);
    workbenchTemplate.position.sub(_wbCenter.multiplyScalar(_wbScale));

    // Build ISO_PREVIEWS[WORKBENCH] by rendering the model to an offscreen canvas
    const _iScene = new THREE.Scene();
    _iScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const _iSun = new THREE.DirectionalLight(0xffffff, 1.0);
    _iSun.position.set(2, 3, 2);
    _iScene.add(_iSun);
    const _iCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    _iCam.position.set(1.8, 1.8, 1.8);
    _iCam.lookAt(0, 0, 0);
    _iScene.add(workbenchTemplate.clone(true));
    const _iCanvas = document.createElement('canvas');
    _iCanvas.width = 64; _iCanvas.height = 64;
    const _iRenderer = new THREE.WebGLRenderer({ canvas: _iCanvas, alpha: true });
    _iRenderer.setSize(64, 64);
    _iRenderer.render(_iScene, _iCam);
    ISO_PREVIEWS[WORKBENCH] = _iCanvas.toDataURL();
    _iRenderer.dispose();
    updateCraftingIcons();

    // Populate the held-item GLB
    const _heldClone = workbenchTemplate.clone(true);
    heldWorkbenchGroup.add(_heldClone);
});

function spawnWorkbenchAt(x, y, z) {
    if (!workbenchTemplate) return;
    const key = `${x},${y},${z}`;
    if (workbenchInstances.has(key)) return;
    const g = workbenchTemplate.clone(true);
    g.position.set(x + 0.5, y + 0.5, z + 0.5);
    scene.add(g);
    workbenchInstances.set(key, g);
}

function removeWorkbenchAt(x, y, z) {
    const key = `${x},${y},${z}`;
    const g = workbenchInstances.get(key);
    if (g) { scene.remove(g); workbenchInstances.delete(key); }
}

function isNearWorkbench() {
    if (!player) return false;
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    for (const key of workbenchInstances.keys()) {
        const [wx, wy, wz] = key.split(',').map(Number);
        const dx = wx + 0.5 - px, dy = wy + 0.5 - py, dz = wz + 0.5 - pz;
        if (dx * dx + dy * dy + dz * dz <= 25) return true;
    }
    return false;
}

// ── Wood Chip GLB ─────────────────────────────────────────────────────────────
const heldWoodchipGroup = new THREE.Group();
heldWoodchipGroup.rotation.order = 'YXZ';
heldWoodchipGroup.rotation.x = -0.3;
heldWoodchipGroup.rotation.y = 0.7;
heldWoodchipGroup.visible = false;
hudScene.add(heldWoodchipGroup);

new GLTFLoader().load('assets/models/woodchip.glb', (gltf) => {
    const tpl = gltf.scene;
    const _b = new THREE.Box3().setFromObject(tpl);
    const _sz = new THREE.Vector3(); _b.getSize(_sz);
    const _sc = 1.0 / Math.max(_sz.x, _sz.y, _sz.z);
    const _c  = new THREE.Vector3(); _b.getCenter(_c);
    tpl.scale.setScalar(_sc);
    tpl.position.sub(_c.multiplyScalar(_sc));

    const _iScene = new THREE.Scene();
    _iScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const _iSun = new THREE.DirectionalLight(0xffffff, 1.0); _iSun.position.set(2, 3, 2); _iScene.add(_iSun);
    const _iCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    _iCam.position.set(1.8, 1.8, 1.8); _iCam.lookAt(0, 0, 0);
    _iScene.add(tpl.clone(true));
    const _iCanvas = document.createElement('canvas'); _iCanvas.width = 64; _iCanvas.height = 64;
    const _iRenderer = new THREE.WebGLRenderer({ canvas: _iCanvas, alpha: true });
    _iRenderer.setSize(64, 64); _iRenderer.render(_iScene, _iCam);
    ISO_PREVIEWS[WOODCHIP] = _iCanvas.toDataURL();
    _iRenderer.dispose();
    updateCraftingIcons();

    heldWoodchipGroup.add(tpl.clone(true));
});

// ── Flint GLB ─────────────────────────────────────────────────────────────────
const heldFlintGroup = new THREE.Group();
heldFlintGroup.rotation.order = 'YXZ';
heldFlintGroup.rotation.x = -0.3;
heldFlintGroup.rotation.y = 0.7;
heldFlintGroup.visible = false;
hudScene.add(heldFlintGroup);

new GLTFLoader().load('assets/models/flint.glb', (gltf) => {
    const tpl = gltf.scene;
    const _b = new THREE.Box3().setFromObject(tpl);
    const _sz = new THREE.Vector3(); _b.getSize(_sz);
    const _sc = 1.0 / Math.max(_sz.x, _sz.y, _sz.z);
    const _c  = new THREE.Vector3(); _b.getCenter(_c);
    tpl.scale.setScalar(_sc);
    tpl.position.sub(_c.multiplyScalar(_sc));

    const _iScene = new THREE.Scene();
    _iScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const _iSun = new THREE.DirectionalLight(0xffffff, 1.0); _iSun.position.set(2, 3, 2); _iScene.add(_iSun);
    const _iCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    _iCam.position.set(1.8, 1.8, 1.8); _iCam.lookAt(0, 0, 0);
    _iScene.add(tpl.clone(true));
    const _iCanvas = document.createElement('canvas'); _iCanvas.width = 64; _iCanvas.height = 64;
    const _iRenderer = new THREE.WebGLRenderer({ canvas: _iCanvas, alpha: true });
    _iRenderer.setSize(64, 64); _iRenderer.render(_iScene, _iCam);
    ISO_PREVIEWS[FLINT] = _iCanvas.toDataURL();
    _iRenderer.dispose();
    updateCraftingIcons();

    heldFlintGroup.add(tpl.clone(true));
});

// ── Stick GLB ─────────────────────────────────────────────────────────────────
const heldStickGroup = new THREE.Group();
heldStickGroup.rotation.order = 'YXZ';
heldStickGroup.rotation.x = -0.3;
heldStickGroup.rotation.y = 0.7;
heldStickGroup.visible = false;
hudScene.add(heldStickGroup);

new GLTFLoader().load('assets/models/stick.glb', (gltf) => {
    const tpl = gltf.scene;
    const _b = new THREE.Box3().setFromObject(tpl);
    const _sz = new THREE.Vector3(); _b.getSize(_sz);
    const _sc = 1.0 / Math.max(_sz.x, _sz.y, _sz.z);
    const _c  = new THREE.Vector3(); _b.getCenter(_c);
    tpl.scale.setScalar(_sc);
    tpl.position.sub(_c.multiplyScalar(_sc));

    const _iScene = new THREE.Scene();
    _iScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const _iSun = new THREE.DirectionalLight(0xffffff, 1.0); _iSun.position.set(2, 3, 2); _iScene.add(_iSun);
    const _iCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    _iCam.position.set(1.8, 1.8, 1.8); _iCam.lookAt(0, 0, 0);
    _iScene.add(tpl.clone(true));
    const _iCanvas = document.createElement('canvas'); _iCanvas.width = 64; _iCanvas.height = 64;
    const _iRenderer = new THREE.WebGLRenderer({ canvas: _iCanvas, alpha: true });
    _iRenderer.setSize(64, 64); _iRenderer.render(_iScene, _iCam);
    ISO_PREVIEWS[STICK] = _iCanvas.toDataURL();
    _iRenderer.dispose();
    updateCraftingIcons();

    heldStickGroup.add(tpl.clone(true));
});

// ── Wooden Pickaxe GLB ────────────────────────────────────────────────────────
const heldWoodpickGroup = new THREE.Group();
heldWoodpickGroup.rotation.order = 'YXZ';
heldWoodpickGroup.rotation.x = -0.3;
heldWoodpickGroup.rotation.y = 0.351;
heldWoodpickGroup.visible = false;
hudScene.add(heldWoodpickGroup);

new GLTFLoader().load('assets/models/woodenpick.glb', (gltf) => {
    const tpl = gltf.scene;
    const _b = new THREE.Box3().setFromObject(tpl);
    const _sz = new THREE.Vector3(); _b.getSize(_sz);
    const _sc = 1.0 / Math.max(_sz.x, _sz.y, _sz.z);
    const _c  = new THREE.Vector3(); _b.getCenter(_c);
    tpl.scale.setScalar(_sc);
    tpl.position.sub(_c.multiplyScalar(_sc));

    const _iScene = new THREE.Scene();
    _iScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const _iSun = new THREE.DirectionalLight(0xffffff, 1.0); _iSun.position.set(2, 3, 2); _iScene.add(_iSun);
    const _iCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    _iCam.position.set(1.8, 1.8, 1.8); _iCam.lookAt(0, 0, 0);
    _iScene.add(tpl.clone(true));
    const _iCanvas = document.createElement('canvas'); _iCanvas.width = 64; _iCanvas.height = 64;
    const _iRenderer = new THREE.WebGLRenderer({ canvas: _iCanvas, alpha: true });
    _iRenderer.setSize(64, 64); _iRenderer.render(_iScene, _iCam);
    ISO_PREVIEWS[WOODPICK] = _iCanvas.toDataURL();
    _iRenderer.dispose();
    updateCraftingIcons();

    const _heldPick = tpl.clone(true);
    _heldPick.scale.multiplyScalar(2.1);
    _heldPick.position.y += 2; // shift model up so bottom aligns with group origin (pivot point)
    heldWoodpickGroup.add(_heldPick);
});

// ── Stone Pickaxe GLB ─────────────────────────────────────────────────────────
const heldStonepickGroup = new THREE.Group();
heldStonepickGroup.rotation.order = 'YXZ';
heldStonepickGroup.rotation.x = -0.3;
heldStonepickGroup.rotation.y = 0.351;
heldStonepickGroup.visible = false;
hudScene.add(heldStonepickGroup);

new GLTFLoader().load('assets/models/stonepick.glb', (gltf) => {
    const tpl = gltf.scene;
    const _b = new THREE.Box3().setFromObject(tpl);
    const _sz = new THREE.Vector3(); _b.getSize(_sz);
    const _sc = 1.0 / Math.max(_sz.x, _sz.y, _sz.z);
    const _c  = new THREE.Vector3(); _b.getCenter(_c);
    tpl.scale.setScalar(_sc);
    tpl.position.sub(_c.multiplyScalar(_sc));

    const _iScene = new THREE.Scene();
    _iScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const _iSun = new THREE.DirectionalLight(0xffffff, 1.0); _iSun.position.set(2, 3, 2); _iScene.add(_iSun);
    const _iCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    _iCam.position.set(1.8, 1.8, 1.8); _iCam.lookAt(0, 0, 0);
    _iScene.add(tpl.clone(true));
    const _iCanvas = document.createElement('canvas'); _iCanvas.width = 64; _iCanvas.height = 64;
    const _iRenderer = new THREE.WebGLRenderer({ canvas: _iCanvas, alpha: true });
    _iRenderer.setSize(64, 64); _iRenderer.render(_iScene, _iCam);
    ISO_PREVIEWS[STONEPICK] = _iCanvas.toDataURL();
    _iRenderer.dispose();
    updateCraftingIcons();

    const _heldStonePick = tpl.clone(true);
    _heldStonePick.scale.multiplyScalar(2.1);
    _heldStonePick.position.y += 2;
    heldStonepickGroup.add(_heldStonePick);
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

// ── World & player ────────────────────────────────────────────────────────────
const world  = new VoxelWorld();
const input  = new Input();
const player = new Player(world);
scene.add(player.mesh);


const CLOUD_Y = 270;
initClouds(scene, gameTextures);

// ── Space & Earth Visuals ─────────────────────────────────────────────────────
initSpace(scene, loadTex);

// ── Inventory Hotbar ────────────────────────────────────────────────────────
const inventory = [];
let selectedSlot = 0;
const VOXEL_IMAGES = {
    1: 'assets/prototype/forest/grass.png',
    2: 'assets/prototype/forest/dirt.png',
    3: 'assets/prototype/forest/stone.png',
    4: 'assets/prototype/forest/wood.png',
    5: 'assets/prototype/forest/leaves.png',
    6: 'assets/prototype/desert/sand.png',
    7: 'assets/prototype/desert/sandstone.png',
    8: 'assets/prototype/desert/cactus.png',
    9: 'assets/prototype/snow/ice.png',
    10: 'assets/prototype/snow/pfrost.png',
    11: 'assets/prototype/snow/igrass.png',
    12: 'assets/prototype/snow/pinewood.png',
    13: 'assets/prototype/snow/iceleaves.png',
    14: 'assets/prototype/underground/deepstone.png',
    15: 'assets/prototype/underground/lavarock.png',
    18: 'assets/prototype/crafted/woodplanks.png',
    25: 'assets/prototype/moon/moon_mountain_rock.png',
    26: 'assets/prototype/fates/voidgrass.png',
    27: 'assets/prototype/fates/voiddirt.png',
    28: 'assets/prototype/fates/voidstone.png',
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

// ── Pixelation effect ─────────────────────────────────────────────────────────
const _pxCanvas = document.createElement('canvas');
_pxCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1999;display:none;image-rendering:pixelated;';
document.body.appendChild(_pxCanvas);
const _pxCtx  = _pxCanvas.getContext('2d');
const _pxTemp = document.createElement('canvas');
const _pxTempCtx = _pxTemp.getContext('2d');
let _pxFrom = 1, _pxTo = 1, _pxT = 0, _pxDur = 0, _pxCb = null, _pxActive = false;

function startPixelAnim(from, to, durationMs, onComplete) {
    _pxFrom = from; _pxTo = to; _pxT = 0;
    _pxDur = durationMs / 1000;
    _pxCb = onComplete ?? null;
    _pxActive = true;
    _pxCanvas.style.display = '';
}

function pixelTransition(body) {
    isTransitioning = true;
    startPixelAnim(1, 64, 700, () => {
        body();
        startPixelAnim(64, 1, 800, () => { isTransitioning = false; });
    });
}

function updatePixelEffect(dt) {
    if (!_pxActive) return;
    _pxT = Math.min(_pxT + dt, _pxDur);
    const p = _pxDur > 0 ? _pxT / _pxDur : 1;
    const e = p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p; // ease-in-out quad
    const size = Math.max(1, Math.round(_pxFrom + (_pxTo - _pxFrom) * e));
    const W = renderer.domElement.width, H = renderer.domElement.height;
    _pxCanvas.width = W; _pxCanvas.height = H;
    const bw = Math.max(1, Math.ceil(W / size)), bh = Math.max(1, Math.ceil(H / size));
    _pxTemp.width = bw; _pxTemp.height = bh;
    _pxTempCtx.imageSmoothingEnabled = false;
    _pxTempCtx.drawImage(renderer.domElement, 0, 0, bw, bh);
    _pxCtx.imageSmoothingEnabled = false;
    _pxCtx.drawImage(_pxTemp, 0, 0, W, H);
    if (_pxT >= _pxDur) {
        _pxActive = false;
        if (_pxTo <= 1) _pxCanvas.style.display = 'none';
        if (_pxCb) { const cb = _pxCb; _pxCb = null; cb(); }
    }
}

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
// ── Inventory animation styles ────────────────────────────────────────────────
{
    const s = document.createElement('style');
    s.textContent = `
        @keyframes inv-overlay-in  { from { opacity:0 } to { opacity:1 } }
        @keyframes inv-overlay-out { from { opacity:1 } to { opacity:0 } }
        @keyframes inv-panel-in    { from { opacity:0; transform:scale(0.96) } to { opacity:1; transform:scale(1) } }
        @keyframes inv-panel-out   { from { opacity:1; transform:scale(1)    } to { opacity:0; transform:scale(0.96) } }
        @keyframes craft-in  { from { opacity:0; transform:translateX(48px) scale(0.9) } to { opacity:1; transform:translateX(0) scale(1) } }
        @keyframes craft-out { from { opacity:1; transform:translateX(0)    scale(1)   } to { opacity:0; transform:translateX(48px) scale(0.9) } }
        @keyframes wb-in  { from { opacity:0; transform:translateX(-48px) scale(0.9) } to { opacity:1; transform:translateX(0) scale(1) } }
        @keyframes wb-out { from { opacity:1; transform:translateX(0)     scale(1)   } to { opacity:0; transform:translateX(-48px) scale(0.9) } }
        @keyframes load-zoom     { from { transform:scale(1); } to { transform:scale(1.18); } }
        @keyframes load-fadeout  { from { opacity:1; } to { opacity:0; } }
    `;
    document.head.appendChild(s);
}

const inventoryOverlay = document.createElement('div');
inventoryOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:none;grid-template-columns:1fr auto 1fr;align-items:center;z-index:2500;';
document.body.appendChild(inventoryOverlay);

// Panel
const inventoryPanel = document.createElement('div');
inventoryPanel.style.cssText = 'background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.11);border-radius:12px;padding:20px 20px 16px;display:flex;flex-direction:column;gap:6px;user-select:none;grid-column:2;';
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
    const _slotSrc = item && item.count > 0 ? (ISO_PREVIEWS[item.type] || VOXEL_IMAGES[item.type]) : null;
    if (_slotSrc) {
        el.innerHTML = `<img src="${_slotSrc}" style="width:100%;height:100%;display:block;">
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

let _invCloseTimer = null;

function openInventory() {
    if (_invCloseTimer) { clearTimeout(_invCloseTimer); _invCloseTimer = null; }
    inventoryOpen = true;
    inventoryOverlay.style.display = 'grid';
    updateInventoryOverlay();
    updateCursorItem();
    updateCraftingIcons();
    updateCraftButtons();
    document.exitPointerLock();

    const DUR = '0.22s';
    const EASE = 'cubic-bezier(0.2,0,0.1,1)';
    inventoryOverlay.style.animation = `inv-overlay-in ${DUR} ${EASE} both`;
    inventoryPanel.style.animation   = `inv-panel-in  ${DUR} ${EASE} both`;
    craftingPanel.style.animation    = 'none';
    craftingPanel.style.opacity      = '0';
    clearTimeout(craftingPanel._openTimer);
    craftingPanel._openTimer = setTimeout(() => {
        craftingPanel.style.animation = `craft-in 0.28s ${EASE} both`;
    }, 220);

    const nearWb = isNearWorkbench();
    wbPanel.style.display = nearWb ? 'flex' : 'none';
    if (nearWb) {
        wbPanel.style.animation = 'none';
        wbPanel.style.opacity   = '0';
        clearTimeout(wbPanel._openTimer);
        wbPanel._openTimer = setTimeout(() => {
            wbPanel.style.animation = `wb-in 0.28s ${EASE} both`;
        }, 220);
    }
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

    const DUR = '0.18s';
    const EASE = 'cubic-bezier(0.4,0,1,1)';
    clearTimeout(craftingPanel._openTimer);
    clearTimeout(wbPanel._openTimer);
    inventoryOverlay.style.animation = `inv-overlay-out ${DUR} ${EASE} both`;
    inventoryPanel.style.animation   = `inv-panel-out  ${DUR} ${EASE} both`;
    craftingPanel.style.animation    = `craft-out      ${DUR} ${EASE} both`;
    if (wbPanel.style.display !== 'none') wbPanel.style.animation = `wb-out ${DUR} ${EASE} both`;

    _invCloseTimer = setTimeout(() => {
        inventoryOverlay.style.display = 'none';
        updateInventoryUI();
        _invCloseTimer = null;
    }, 180);

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
    if (e.shiftKey && e.code === 'KeyZ' && gameActive) {
        thirdPerson = !thirdPerson;
        showFeedback(thirdPerson ? 'third person' : 'first person');
    }
});

// ── Crafting Panel ────────────────────────────────────────────────────────────
const ITEM_NAMES = {
    1:'Grass', 2:'Dirt', 3:'Stone', 4:'Wood', 5:'Leaves',
    6:'Sand', 7:'Sandstone', 8:'Cactus', 9:'Ice', 10:'Packed Frost',
    11:'Icy Grass', 12:'Pine Wood', 13:'Ice Leaves', 14:'Deepstone',
    15:'Lava Rock', 18:'Wooden Planks', 19:'Workbench', 20:'Wood Chip', 21:'Flint',
    23:'Stick', 24:'Wooden Pickaxe', 25:'Mountain Moon Rock', 31:'Stone Pickaxe',
    32:'Iron Ore', 33:'Lead Ore'
};

// Non-placeable item types (tools, etc.) — right-click will not try to place these.
const TOOL_TYPES = new Set([WOODCHIP, FLINT, STICK, WOODPICK, STONEPICK]);

const RECIPES = [
    {
        result:      { type: 18, count: 2 },
        ingredients: [{ type: 4,  count: 1 }]
    },
    {
        result:      { type: 19, count: 1 },
        ingredients: [{ type: 18, count: 10 }, { type: 21, count: 3 }]
    },
    {
        result:      { type: 20, count: 1 },
        ingredients: [{ type: 4,  count: 2 }]
    }
];

const WORKBENCH_RECIPES = [
    {
        result:      { type: STICK, count: 2 },
        ingredients: [{ type: WOOD, count: 2 }]
    },
    {
        result:      { type: WOODPICK, count: 1 },
        ingredients: [{ type: STICK, count: 2 }, { type: WOODPLANKS, count: 10 }]
    },
    {
        result:      { type: STONEPICK, count: 1 },
        ingredients: [{ type: STONE, count: 10 }, { type: STICK, count: 3 }, { type: FLINT, count: 2 }]
    }
];

const craftingIconRefs = [];
const craftBtnRefs = []; // { btn, recipe, hovered }
const wbCraftingIconRefs = [];
const wbCraftBtnRefs = [];

function canCraft(recipe) {
    for (const ing of recipe.ingredients) {
        let have = 0;
        for (let i = 0; i < 9;  i++) if (inventory[i]     && inventory[i].type     === ing.type) have += inventory[i].count;
        for (let i = 0; i < 27; i++) if (mainInventory[i] && mainInventory[i].type === ing.type) have += mainInventory[i].count;
        if (have < ing.count) return false;
    }
    return true;
}

function applyBtnColors(ref) {
    const ok = canCraft(ref.recipe);
    if (ok) {
        ref.btn.style.background  = ref.hovered ? 'rgba(74,163,92,0.35)'  : 'rgba(74,163,92,0.18)';
        ref.btn.style.borderColor = ref.hovered ? 'rgba(74,163,92,0.65)'  : 'rgba(74,163,92,0.35)';
        ref.btn.style.color       = ref.hovered ? 'rgba(140,240,160,1)'   : 'rgba(110,210,130,0.9)';
    } else {
        ref.btn.style.background  = ref.hovered ? 'rgba(200,60,60,0.35)'  : 'rgba(200,60,60,0.18)';
        ref.btn.style.borderColor = ref.hovered ? 'rgba(200,60,60,0.65)'  : 'rgba(200,60,60,0.35)';
        ref.btn.style.color       = ref.hovered ? 'rgba(255,130,130,1)'   : 'rgba(220,100,100,0.9)';
    }
}

function updateCraftButtons() {
    for (const ref of craftBtnRefs) applyBtnColors(ref);
    for (const ref of wbCraftBtnRefs) applyBtnColors(ref);
}

const craftingPanel = document.createElement('div');
craftingPanel.style.cssText = 'background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.11);border-radius:12px;padding:20px 20px 16px;display:flex;flex-direction:column;gap:8px;user-select:none;min-width:180px;grid-column:3;justify-self:center;';
inventoryOverlay.appendChild(craftingPanel);

const craftTitle = document.createElement('div');
craftTitle.style.cssText = 'color:rgba(255,255,255,0.55);font-family:monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;';
craftTitle.textContent = 'Crafting';
craftingPanel.appendChild(craftTitle);

for (const recipe of RECIPES) {
    const entry = document.createElement('div');
    entry.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:10px;overflow:hidden;transition:background 0.2s,border-color 0.2s;cursor:pointer;';

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
    const btnRef = { btn: craftBtn, recipe, hovered: false };
    craftBtnRefs.push(btnRef);
    craftBtn.addEventListener('mouseenter', () => { btnRef.hovered = true;  applyBtnColors(btnRef); });
    craftBtn.addEventListener('mouseleave', () => { btnRef.hovered = false; applyBtnColors(btnRef); });
    craftBtn.addEventListener('click', () => craftRecipe(recipe));
    expandSection.appendChild(craftBtn);

    entry.appendChild(expandSection);

    let expanded = false;
    function openEntry() {
        expanded = true;
        expandSection.style.maxHeight = '200px';
        expandSection.style.opacity   = '1';
        expandSection.style.marginTop = '4px';
        entry.style.background   = 'rgba(255,255,255,0.07)';
        entry.style.borderColor  = 'rgba(255,255,255,0.16)';
    }
    function closeEntry() {
        expanded = false;
        expandSection.style.maxHeight = '0';
        expandSection.style.opacity   = '0';
        expandSection.style.marginTop = '0';
        entry.style.background   = 'rgba(255,255,255,0.04)';
        entry.style.borderColor  = 'rgba(255,255,255,0.09)';
    }
    entry.addEventListener('click', () => { if (!expanded) openEntry(); });
    entry.addEventListener('mouseleave', closeEntry);

    craftingPanel.appendChild(entry);
}

function updateCraftingIcons() {
    for (const ref of craftingIconRefs) {
        if (ISO_PREVIEWS[ref.type]) ref.el.src = ISO_PREVIEWS[ref.type];
    }
    for (const ref of wbCraftingIconRefs) {
        if (ISO_PREVIEWS[ref.type]) ref.el.src = ISO_PREVIEWS[ref.type];
    }
}

// ── Workbench Panel ───────────────────────────────────────────────────────────
function buildRecipeEntry(recipe, iconRefs, btnRefs, craftFn) {
    const entry = document.createElement('div');
    entry.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:10px;overflow:hidden;transition:background 0.2s,border-color 0.2s;cursor:pointer;';

    const resultRow = document.createElement('div');
    resultRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const resultIconEl = document.createElement('div');
    resultIconEl.style.cssText = 'width:48px;height:48px;flex-shrink:0;';
    const resultImg = document.createElement('img');
    resultImg.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;';
    resultImg.src = VOXEL_IMAGES[recipe.result.type] || ISO_PREVIEWS[recipe.result.type] || '';
    iconRefs.push({ el: resultImg, type: recipe.result.type });
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
        ingImg.src = VOXEL_IMAGES[ing.type] || ISO_PREVIEWS[ing.type] || '';
        iconRefs.push({ el: ingImg, type: ing.type });
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
    const btnRef = { btn: craftBtn, recipe, hovered: false };
    btnRefs.push(btnRef);
    craftBtn.addEventListener('mouseenter', () => { btnRef.hovered = true;  applyBtnColors(btnRef); });
    craftBtn.addEventListener('mouseleave', () => { btnRef.hovered = false; applyBtnColors(btnRef); });
    craftBtn.addEventListener('click', () => craftFn(recipe));
    expandSection.appendChild(craftBtn);

    entry.appendChild(expandSection);

    let expanded = false;
    function openEntry() {
        expanded = true;
        expandSection.style.maxHeight = '200px';
        expandSection.style.opacity   = '1';
        expandSection.style.marginTop = '4px';
        entry.style.background  = 'rgba(255,255,255,0.07)';
        entry.style.borderColor = 'rgba(255,255,255,0.16)';
    }
    function closeEntry() {
        expanded = false;
        expandSection.style.maxHeight = '0';
        expandSection.style.opacity   = '0';
        expandSection.style.marginTop = '0';
        entry.style.background  = 'rgba(255,255,255,0.04)';
        entry.style.borderColor = 'rgba(255,255,255,0.09)';
    }
    entry.addEventListener('click', () => { if (!expanded) openEntry(); });
    entry.addEventListener('mouseleave', closeEntry);
    return entry;
}

const wbPanel = document.createElement('div');
wbPanel.style.cssText = 'background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.11);border-radius:12px;padding:20px 20px 16px;flex-direction:column;gap:8px;user-select:none;min-width:180px;grid-column:1;justify-self:center;display:none;';
inventoryOverlay.appendChild(wbPanel);

const wbTitle = document.createElement('div');
wbTitle.style.cssText = 'color:rgba(255,255,255,0.55);font-family:monospace;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;';
wbTitle.textContent = 'Workbench';
wbPanel.appendChild(wbTitle);

for (const recipe of WORKBENCH_RECIPES) {
    wbPanel.appendChild(buildRecipeEntry(recipe, wbCraftingIconRefs, wbCraftBtnRefs, craftRecipe));
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
    updateCraftButtons();
}

// ── Voxel Particle System ─────────────────────────────────────────────────────
initParticles(scene, camera, world, loadTex);

// ── Chunk system ──────────────────────────────────────────────────────────────
const RENDER_DIST = 4;          // full resolution (LOD 1)
const MID_LOD_DIST = 8;         // medium resolution (LOD 2)
const MAX_LOD_DIST = 12;        // ultra-simple resolution (LOD 4)
const SUPER_LOD_DIST = 16;      // super ultra resolution (LOD 8)
const ULTIMATE_LOD_DIST = 42;   // ultimate LOD — flat-color heightmap, main-thread built

const loadedChunks = new Map();
const buildQueue   = [];
const pendingChunks = new Map();       // "key" -> pending LOD level (streaming worker)
const pendingMiningChunks = new Map(); // "key" -> pending LOD level (mining worker)
let lastPCX = null, lastPCZ = null, lastZone = null;
const DEEP_BOUNDARY = 100;
const LAVA_BOUNDARY = -100;

function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

// ── Ultimate LOD (shader-driven) ──────────────────────────────────────────────
// A single fixed grid mesh whose Y position and biome colour are computed
// entirely in the vertex shader every frame.  No per-frame CPU work, no
// load/unload logic — the mesh never changes, only two int uniforms update
// when the player crosses a chunk boundary.
//
// Noise is a direct GLSL port of hash/valueNoise/mountainNoise/surfaceY from
// world.js so the horizon silhouette matches the actual terrain exactly.

const ULOD_R     = ULTIMATE_LOD_DIST;          // 42 chunks
const ULOD_SIDE  = ULOD_R * 2 + 1;             // 85 vertices per axis
const ULOD_CHUNK = 16;                          // == CHUNK, kept as literal for GLSL

// One byte per LOD cell: 255 = chunk loaded (hide LOD), 0 = unloaded (show LOD)
const lodMaskData = new Uint8Array(ULOD_SIDE * ULOD_SIDE);
const lodMaskTex  = new THREE.DataTexture(lodMaskData, ULOD_SIDE, ULOD_SIDE, THREE.RedFormat, THREE.UnsignedByteType);
lodMaskTex.magFilter = THREE.NearestFilter;
lodMaskTex.minFilter = THREE.NearestFilter;

let lodMaskDirty = true;
let lastMaskCX = null, lastMaskCZ = null;

function markLodMaskDirty() { lodMaskDirty = true; }

function updateLodMask() {
    const cx0 = ultimateUniforms.uCenterCX.value;
    const cz0 = ultimateUniforms.uCenterCZ.value;
    if (!lodMaskDirty && cx0 === lastMaskCX && cz0 === lastMaskCZ) return;
    lodMaskData.fill(0);
    for (const key of loadedChunks.keys()) {
        const parts = key.split(',');
        const cx = +parts[0], cz = +parts[2];
        const dx = cx - cx0, dz = cz - cz0;
        if (dx >= -ULOD_R && dx <= ULOD_R && dz >= -ULOD_R && dz <= ULOD_R) {
            lodMaskData[(dz + ULOD_R) * ULOD_SIDE + (dx + ULOD_R)] = 255;
        }
    }
    lodMaskTex.needsUpdate = true;
    lodMaskDirty = false;
    lastMaskCX = cx0;
    lastMaskCZ = cz0;
}

const ultimateUniforms = {
    uCenterCX:     { value: 0 },
    uCenterCZ:     { value: 0 },
    uCamXZ:        curveUniforms.uCamXZ,
    uPlanetRadius: curveUniforms.uPlanetRadius,
    uBSeedX:       { value: bSeedX },
    uBSeedZ:       { value: bSeedZ },
    uBOffset:      { value: bOffset },
    uMSeedX:       { value: mSeedX },
    uMSeedZ:       { value: mSeedZ },
    uIsMoon:         { value: 0.0 },
    uIsFates:        { value: 0.0 },
    uColorForest:    { value: new THREE.Color(0x6b8c3a) },
    uColorDesert:    { value: new THREE.Color(0xc2b280) },
    uColorTundra:    { value: new THREE.Color(0xb0ccd0) },
    uColorMoon:      { value: new THREE.Color(0xa0a0aa) },
    uColorMtnMoon:   { value: new THREE.Color(0x787880) },
    uColorMtnForest: { value: new THREE.Color(0x888888) },
    uColorMtnDesert: { value: new THREE.Color(0xb0a080) },
    uColorMtnTundra: { value: new THREE.Color(0xd0e0e8) },
    uColorVoidGrass: { value: new THREE.Color(0x3a1a5c) },
    uColorVoidDirt:  { value: new THREE.Color(0x1e0f2e) },
    uLoadedMask:   { value: lodMaskTex },
    uUlodR:        { value: ULOD_R },
    uUlodSide:     { value: ULOD_SIDE },
    uStopFade:     { value: 0.0 },
};

// Sample each texture's average colour async; just update uniforms when ready —
// the single mesh re-reads them on the next draw with no rebuild needed.
async function sampleTexAvgColor(url) {
    const blob = await (await fetch(url)).blob();
    const img  = await createImageBitmap(blob);
    const off  = new OffscreenCanvas(img.width, img.height);
    const ctx  = off.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
    return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
}

(async () => {
    const [grass, sand, igrass, stone, sandstone, ice, moonMtn, voidGrass, voidDirt] = await Promise.all([
        sampleTexAvgColor('assets/prototype/forest/grass.png'),
        sampleTexAvgColor('assets/prototype/desert/sand.png'),
        sampleTexAvgColor('assets/prototype/snow/igrass.png'),
        sampleTexAvgColor('assets/prototype/forest/stone.png'),
        sampleTexAvgColor('assets/prototype/desert/sandstone.png'),
        sampleTexAvgColor('assets/prototype/snow/ice.png'),
        sampleTexAvgColor('assets/prototype/moon/moon_mountain_rock.png'),
        sampleTexAvgColor('assets/prototype/fates/voidgrass.png'),
        sampleTexAvgColor('assets/prototype/fates/voiddirt.png'),
    ]);
    ultimateUniforms.uColorForest.value.copy(grass);
    ultimateUniforms.uColorDesert.value.copy(sand);
    ultimateUniforms.uColorTundra.value.copy(igrass);
    ultimateUniforms.uColorMtnForest.value.copy(stone);
    ultimateUniforms.uColorMtnDesert.value.copy(sandstone);
    ultimateUniforms.uColorMtnTundra.value.copy(ice);
    // Moon LOD uses a fixed light grey; mountain areas use the sampled texture colour darkened slightly
    ultimateUniforms.uColorMoon.value.set(0xc0c0c8);
    ultimateUniforms.uColorMtnMoon.value.copy(moonMtn).multiplyScalar(0.75);
    ultimateUniforms.uColorVoidGrass.value.copy(voidGrass);
    ultimateUniforms.uColorVoidDirt.value.copy(voidDirt);
})();

const ultimateLodMat = new THREE.ShaderMaterial({
    uniforms: ultimateUniforms,
    glslVersion: THREE.GLSL3,

    vertexShader: /* glsl */`
precision highp float;
precision highp int;

uniform int   uCenterCX;
uniform int   uCenterCZ;
uniform vec2  uCamXZ;
uniform float uPlanetRadius;
uniform float uBSeedX;
uniform float uBSeedZ;
uniform float uBOffset;
uniform float uMSeedX;
uniform float uMSeedZ;
uniform float uIsMoon;
uniform float uIsFates;
uniform vec3  uColorForest;
uniform vec3  uColorDesert;
uniform vec3  uColorTundra;
uniform vec3  uColorMoon;
uniform vec3  uColorMtnMoon;
uniform vec3  uColorMtnForest;
uniform vec3  uColorMtnDesert;
uniform vec3  uColorMtnTundra;
uniform vec3  uColorVoidGrass;
uniform vec3  uColorVoidDirt;

out vec3 vColor;
out vec2 vChunkOffset;

// ── Hash (matches world.js hash(x,y,z)) ─────────────────────────────────────
// All ops in uint so overflow wraps predictably (two's-complement on every GPU).
float hash3i(int x, int y, int z) {
    uint n = uint(x) * 1619u + uint(y) * 31337u + uint(z) * 6971u;
    n = (n ^ (n >> 13u)) * 0x45d9f3bu;
    n =  n ^ (n >> 15u);
    return float(n & 0x7fffffffu) / 2147483647.0;
}

// ── Value noise (matches world.js valueNoise) ────────────────────────────────
float valueNoise(float x, float y, float z) {
    int ix = int(floor(x)), iy = int(floor(y)), iz = int(floor(z));
    float fx = x - float(ix), fy = y - float(iy), fz = z - float(iz);
    float ux = fx*fx*(3.0-2.0*fx), uy = fy*fy*(3.0-2.0*fy), uz = fz*fz*(3.0-2.0*fz);
    return hash3i(ix,   iy,   iz  )*(1.0-ux)*(1.0-uy)*(1.0-uz)
         + hash3i(ix+1, iy,   iz  )*ux      *(1.0-uy)*(1.0-uz)
         + hash3i(ix,   iy+1, iz  )*(1.0-ux)*uy      *(1.0-uz)
         + hash3i(ix+1, iy+1, iz  )*ux      *uy      *(1.0-uz)
         + hash3i(ix,   iy,   iz+1)*(1.0-ux)*(1.0-uy)*uz
         + hash3i(ix+1, iy,   iz+1)*ux      *(1.0-uy)*uz
         + hash3i(ix,   iy+1, iz+1)*(1.0-ux)*uy      *uz
         + hash3i(ix+1, iy+1, iz+1)*ux      *uy      *uz;
}

// ── Mountain noise (matches world.js mountainNoise) ──────────────────────────
float mountainNoise(float wx, float wz) {
    float dx = wx - 8.0, dz = wz - 8.0;
    float spawnT    = clamp((sqrt(dx*dx + dz*dz) - 400.0) / 100.0, 0.0, 1.0);
    float spawnMask = spawnT * spawnT * (3.0 - 2.0 * spawnT);
    if (spawnMask < 0.001) return 0.0;

    float maskRaw = valueNoise(wx / 150.0 + uMSeedX, 17.3, wz / 150.0 + uMSeedZ);
    float maskT   = clamp((maskRaw - 0.54) / 0.26, 0.0, 1.0);
    float mask    = maskT * maskT * (3.0 - 2.0 * maskT);
    if (mask < 0.001) return 0.0;

    float ridged = 0.0, amp = 1.0, freq = 1.0, wt = 0.0;
    for (int i = 0; i < 5; i++) {
        float n = valueNoise(wx * freq / 70.0 + uMSeedX,
                             53.1 + float(i) * 5.3,
                             wz * freq / 70.0 + uMSeedZ);
        float r = 1.0 - abs(2.0 * n - 1.0);
        ridged += amp * r * r * r;
        wt     += amp;
        amp    *= 0.5;
        freq   *= 2.05;
    }
    return spawnMask * mask * (ridged / wt) * 100.0;
}

// ── Surface height (matches world.js surfaceY, without Math.round) ────────────
float surfaceY(float wx, float wz) {
    float n = valueNoise(wx / 80.0, 0.0, wz / 80.0) * 0.45
            + valueNoise(wx / 30.0, 0.0, wz / 30.0) * 0.35
            + valueNoise(wx / 12.0, 0.0, wz / 12.0) * 0.20;
    return 154.0 + n * 28.0 + mountainNoise(wx, wz);
}

// ── Fates wild surface height ─────────────────────────────────────────────────
float fatesSurfaceY(float wx, float wz) {
    float n = valueNoise(wx / 22.0, 0.0, wz / 22.0) * 0.45
            + valueNoise(wx /  9.0, 0.0, wz /  9.0) * 0.32
            + valueNoise(wx /  4.0, 0.0, wz /  4.0) * 0.15
            + valueNoise(wx /  1.8, 0.0, wz /  1.8) * 0.08;
    return 120.0 + n * 110.0;
}

// ── Fates smooth surface height (matches smoothSurf formula) ──────────────────
float fatesSmoothSurfaceY(float wx, float wz) {
    float n = valueNoise(wx / 80.0, 0.0, wz / 80.0) * 0.50
            + valueNoise(wx / 30.0, 0.0, wz / 30.0) * 0.35
            + valueNoise(wx / 12.0, 0.0, wz / 12.0) * 0.15;
    return 155.0 + n * 25.0;
}

// ── Fates biome blend (0 = wild, 1 = smooth, matches JS fatesBiome) ───────────
float fatesBiomeT(float wx, float wz) {
    float raw = valueNoise(wx / 250.0, 0.0, wz / 250.0);
    return clamp((raw - 0.4) / 0.2, 0.0, 1.0);
}

// ── Biome FBM (matches world.js biomeFBM / getBiome) ─────────────────────────
float biomeValue(float wx, float wz) {
    float val = 0.0, amp = 0.5, freq = 1.0;
    for (int i = 0; i < 4; i++) {
        val  += amp * valueNoise(wx / 800.0 * freq + uBSeedX,
                                 0.0,
                                 wz / 800.0 * freq + uBSeedZ);
        freq *= 2.0; amp *= 0.5;
    }
    val = mod(mod(val + uBOffset, 1.0) + 1.0, 1.0);
    return val; // <0.33 tundra, <0.66 forest, >=0.66 desert
}

void main() {
    float wx = (float(uCenterCX) + position.x) * 16.0;
    float wz = (float(uCenterCZ) + position.z) * 16.0;
    float wy;
    float fatesBT = 0.0;
    if (uIsFates > 0.5) {
        fatesBT = fatesBiomeT(wx, wz);
        wy = mix(fatesSurfaceY(wx, wz), fatesSmoothSurfaceY(wx, wz), fatesBT);
    } else {
        wy = surfaceY(wx, wz);
    }

    // Planet curve
    float cdx = wx - uCamXZ.x;
    float cdz = wz - uCamXZ.y;
    float dist2 = cdx * cdx + cdz * cdz;
    if (uIsMoon > 0.5) {
        // Moon curvature (radius 250) would push LOD vertices underground before
        // they're ever visible. Apply Moon curvature only up to the loaded-chunk
        // boundary (SUPER_LOD_DIST * CHUNK = 256 blocks), then continue with
        // Earth curvature so the distant LOD stays above the horizon.
        const float kBound2 = 256.0 * 256.0;
        wy -= min(dist2, kBound2) / (2.0 * uPlanetRadius)
            + max(0.0, dist2 - kBound2) / (2.0 * 2500.0);
    } else {
        wy -= dist2 / (2.0 * uPlanetRadius);
    }

    // Biome colour
    if (uIsFates > 0.5) {
        // Height relative to each biome's range, blended between them
        float tLow  = mix(120.0, 155.0, fatesBT);
        float tHigh = mix(230.0, 180.0, fatesBT);
        float ct = clamp((wy - tLow) / max(tHigh - tLow, 1.0), 0.0, 1.0);
        vColor = mix(uColorVoidDirt, uColorVoidGrass, ct * ct);
    } else if (uIsMoon > 0.5) {
        float mnt = mountainNoise(wx, wz);
        vColor = (mnt > 1.5) ? uColorMtnMoon : uColorMoon;
    } else {
        float bv  = biomeValue(wx, wz);
        float mnt = mountainNoise(wx, wz);
        if (mnt > 1.5) {
            if      (bv < 0.33) vColor = uColorMtnTundra;
            else if (bv < 0.66) vColor = uColorMtnForest;
            else                vColor = uColorMtnDesert;
        } else {
            if      (bv < 0.33) vColor = uColorTundra;
            else if (bv < 0.66) vColor = uColorForest;
            else                vColor = uColorDesert;
        }
    }

    vChunkOffset = position.xz; // pass raw (dx, dz) offsets to fragment shader
    gl_Position = projectionMatrix * modelViewMatrix * vec4(wx, wy, wz, 1.0);
}`,

    fragmentShader: /* glsl */`
precision mediump float;
uniform sampler2D uLoadedMask;
uniform float uUlodR;
uniform float uUlodSide;
uniform float uStopFade;
in  vec3 vColor;
in  vec2 vChunkOffset;
out vec4 fragColor;
void main() {
    // Determine which chunk cell this fragment is in and discard if loaded.
    // When stopFade is active the mask is ignored so the LOD shows through
    // the fading detail meshes.
    if (uStopFade < 0.5) {
        int dx = int(floor(vChunkOffset.x));
        int dz = int(floor(vChunkOffset.y));
        float u = (float(dx) + uUlodR + 0.5) / uUlodSide;
        float v = (float(dz) + uUlodR + 0.5) / uUlodSide;
        if (texture(uLoadedMask, vec2(u, v)).r > 0.5) discard;
    }
    fragColor = vec4(vColor, 1.0);
}`,
});

let ultimateLodMesh = null;

// Build the grid once — positions are integer chunk offsets (dx, 0, dz).
// The vertex shader converts them to world space via uCenterCX/CZ each frame.
(function buildUltimateGrid() {
    const nv  = ULOD_SIDE * ULOD_SIDE;
    const pos = new Float32Array(nv * 3);
    let vi = 0;
    for (let dz = -ULOD_R; dz <= ULOD_R; dz++) {
        for (let dx = -ULOD_R; dx <= ULOD_R; dx++) {
            pos[vi++] = dx; pos[vi++] = 0; pos[vi++] = dz;
        }
    }

    const indices = [];
    for (let zi = 0; zi < ULOD_SIDE - 1; zi++) {
        for (let xi = 0; xi < ULOD_SIDE - 1; xi++) {
            const tl = zi * ULOD_SIDE + xi;
            const tr = tl + 1, bl = tl + ULOD_SIDE, br = bl + 1;
            indices.push(tl, bl, tr,  tr, bl, br);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(indices);

    ultimateLodMesh = new THREE.Mesh(geo, ultimateLodMat);
    ultimateLodMesh.frustumCulled = false; // bounding box is in offset-space, not world-space
    ultimateLodMesh.castShadow    = false;
    ultimateLodMesh.receiveShadow = false;
    scene.add(ultimateLodMesh);
}());

// Initialize Workers
// meshWorker handles chunk streaming; miningWorker handles mesh rebuilds after mining/placing.
const meshWorker   = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const miningWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function broadcastWorkers(msg) {
    meshWorker.postMessage(msg);
    miningWorker.postMessage(msg);
}

// Sync the biome seeds to both workers immediately
broadcastWorkers({ type: 'initBiome', sx: bSeedX, sz: bSeedZ, inv: bOffset, mx: mSeedX, mz: mSeedZ });

meshWorker.onmessage = function(e) {
    if (e.data.type === 'meshResult') {
        const { cx, cy, cz, results, lod } = e.data;
        const key = chunkKey(cx, cy, cz);
        if (pendingChunks.get(key) === lod) pendingChunks.delete(key);
        applyMeshResults(cx, cy, cz, lod, results);
    }
};

miningWorker.onmessage = function(e) {
    if (e.data.type === 'meshResult') {
        const { cx, cy, cz, results, lod } = e.data;
        const key = chunkKey(cx, cy, cz);
        if (pendingMiningChunks.get(key) === lod) pendingMiningChunks.delete(key);
        applyMeshResults(cx, cy, cz, lod, results);
    }
};

function applyMeshResults(cx, cy, cz, lod, results) {
    const key = chunkKey(cx, cy, cz);
    const current = loadedChunks.get(key);
    if (current && current.lod < lod) return;
    if (current) { for (const m of current.meshes) { scene.remove(m); m.geometry.dispose(); } }
    const meshes = [];
    for (const data of results) {
        if (!data) continue;
        const mat = MATS[data.type];
        if (!mat) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
        geo.setAttribute('uv',       new THREE.BufferAttribute(data.uvs, 2));
        geo.setAttribute('color',    new THREE.BufferAttribute(data.col, 3));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = data.type !== WATER;
        m.receiveShadow = true;
        if (data.type !== WATER) m.customDepthMaterial = curveDepthMat;
        scene.add(m);
        meshes.push(m);
    }
    if (xrayMode) {
        for (const m of meshes) {
            m.visible = m.material === MATS[IRON_ORE] || m.material === MATS[LEAD_ORE];
        }
    }
    loadedChunks.set(key, { meshes, lod });
    markLodMaskDirty();
}

function rebuildChunk(cx, cy, cz, lod = 1) {
    const key = chunkKey(cx, cy, cz);
    if (mainThreadMesh) {
        // Pre-generate the 3x3x3 neighbourhood (mirrors what the worker does)
        for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
            world.get((cx + dx) * CHUNK, (cy + dy) * CHUNK, (cz + dz) * CHUNK);
        const results = buildChunkMesh(world, cx, cy, cz, fullbright, lod, voxelMode, useGaussian, supercomputerMode, xrayMode);
        applyMeshResults(cx, cy, cz, lod, results);
        pendingChunks.delete(key);
    } else {
        meshWorker.postMessage({ type: 'buildMesh', cx, cy, cz, lod, fullbright });
        pendingChunks.set(key, lod);
    }
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

    // CY floor for distant LOD in the overworld: surface is always at y≥154 (CY≥9),
    // so CY 6-8 (y=96-143) is 100% solid underground and invisible from outside.
    const DISTANT_CY_FLOOR = 9;

    for (let dx = -SUPER_LOD_DIST; dx <= SUPER_LOD_DIST; dx++)
    for (let dz = -SUPER_LOD_DIST; dz <= SUPER_LOD_DIST; dz++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dz));
        let baseLod = 1;
        if (currentQuality === 'medium') baseLod = 2;
        else if (currentQuality === 'potato') baseLod = 3;

        let lod;
        if      (dist <= RENDER_DIST)   lod = baseLod;
        else if (dist <= MID_LOD_DIST)  lod = Math.max(baseLod, 2);
        else if (dist <= MAX_LOD_DIST)  lod = Math.max(baseLod, 4);
        else                            lod = Math.max(baseLod, 8);

        const cy0 = (lod >= 2 && zone === 0) ? Math.max(startCY, DISTANT_CY_FLOOR) : startCY;
        for (let cy = cy0; cy <= endCY; cy++)
            desired.set(chunkKey(pcx + dx, cy, pcz + dz), lod);
    }

    // Unload chunks that fell out of range
    let anyUnloaded = false;
    for (const [key, entry] of loadedChunks) {
        if (!desired.has(key)) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
            loadedChunks.delete(key);
            anyUnloaded = true;
        }
    }
    if (anyUnloaded) markLodMaskDirty();

    // Enqueue newly visible chunks, closest first
    const toAdd = [];
    for (const [key, lod] of desired) {
        const entry = loadedChunks.get(key);
        const pendingLod = pendingChunks.get(key);

        // We need a rebuild if it's missing or the quality differs from desired.
        // However, don't request it if there's already a request in flight 
        // that is equal to or better than the one we want.
        const needsChange = !entry || entry.lod !== lod;
        const isBetterPending = pendingLod !== undefined && pendingLod <= lod;

        if (needsChange && !isBetterPending) {
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

// ── Game state (declared early — settings UI references these) ─────────────────
let flyMode        = false;
let inceptionMode  = false;
let fpsMode        = false;
let stopFade       = false;
let speedMultiplier = 1;
let isFlying       = false;
let supercomputerMode = false;

// ── Save / load state ─────────────────────────────────────────────────────────
let gameActive       = false;          // true once a game (new or loaded) has started
let currentWorldName = null;
const worldDeltas    = new Map();      // "x,y,z" -> v  (deduplicated player changes)

// ── Settings menu ─────────────────────────────────────────────────────────────
let settingsOpen      = false;
let hasStartedPlaying = false;
let resolutionScale   = 1.0;
let shadowMapSize     = 1024;
let useGaussian       = true;
let mainThreadMesh    = false;
let currentQuality    = 'ultra';

const QUALITY_PROFILES = {
    ultra:  { resolution: 1.0,  shadows: 1024, gaussian: true  },
    super:  { resolution: 1.0,  shadows: 512,  gaussian: true  },
    medium: { resolution: 0.75, shadows: 256,  gaussian: false },
    potato: { resolution: 0.5,  shadows: 0,    gaussian: false },
};

function applyQualityProfile(name) {
    currentQuality = name;
    const p = QUALITY_PROFILES[name];
    applyResolution(p.resolution);
    applyShadowRes(p.shadows);
    applyGaussian(p.gaussian);
    // Force chunk stream re-evaluation to apply new LOD baseline
    lastPCX = null;
}

const settingsOverlay = document.createElement('div');
settingsOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);display:none;align-items:center;justify-content:center;z-index:3000;';
document.body.appendChild(settingsOverlay);

const settingsPanel = document.createElement('div');
settingsPanel.style.cssText = 'background:rgba(14,14,14,0.97);border:1px solid rgba(255,255,255,0.13);border-radius:14px;padding:28px 32px 24px;font-family:monospace;color:#fff;min-width:340px;display:flex;flex-direction:column;gap:20px;user-select:none;';
settingsOverlay.appendChild(settingsPanel);

// Title
const settingsTitle = document.createElement('div');
settingsTitle.style.cssText = 'font-size:16px;font-weight:bold;letter-spacing:0.04em;';
settingsTitle.textContent = 'Settings';
settingsPanel.appendChild(settingsTitle);

// Quality row
const qualityRow = document.createElement('div');
qualityRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
const qualityLabel = document.createElement('span');
qualityLabel.style.cssText = 'font-size:13px;color:#ccc;white-space:nowrap;';
qualityLabel.textContent = 'Quality';
qualityRow.appendChild(qualityLabel);

const qualityBtnGroup = document.createElement('div');
qualityBtnGroup.style.cssText = 'display:flex;gap:6px;';

const QUALITY_LEVELS = [
    { id: 'ultra',  label: 'Ultra'  },
    { id: 'super',  label: 'Super'  },
    { id: 'medium', label: 'Medium' },
    { id: 'potato', label: 'Potato' },
];

const qualityBtns = {};
QUALITY_LEVELS.forEach(({ id, label }) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'font-family:monospace;font-size:12px;padding:5px 11px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);cursor:pointer;background:rgba(255,255,255,0.07);color:#fff;transition:background 0.15s;';
    btn.onmouseenter = () => { if (currentQuality !== id) btn.style.background = 'rgba(255,255,255,0.15)'; };
    btn.onmouseleave = () => { btn.style.background = currentQuality === id ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)'; };
    btn.addEventListener('click', () => { applyQualityProfile(id); refreshSettings(); });
    qualityBtns[id] = btn;
    qualityBtnGroup.appendChild(btn);
});

qualityRow.appendChild(qualityBtnGroup);
settingsPanel.appendChild(qualityRow);

// Advanced dropdown toggle
const advancedToggle = document.createElement('button');
advancedToggle.style.cssText = 'font-family:monospace;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);cursor:pointer;background:rgba(255,255,255,0.05);color:#aaa;text-align:left;display:flex;align-items:center;gap:6px;width:100%;';
advancedToggle.innerHTML = '<span id="adv-arrow" style="font-size:10px;">▶</span> Advanced';
settingsPanel.appendChild(advancedToggle);

// Advanced panel (hidden by default)
const advancedPanel = document.createElement('div');
advancedPanel.style.cssText = 'display:none;flex-direction:column;gap:14px;border-left:2px solid rgba(255,255,255,0.1);padding-left:14px;margin-left:2px;';
settingsPanel.appendChild(advancedPanel);

let advancedOpen = false;
advancedToggle.addEventListener('click', () => {
    advancedOpen = !advancedOpen;
    advancedPanel.style.display = advancedOpen ? 'flex' : 'none';
    document.getElementById('adv-arrow').textContent = advancedOpen ? '▼' : '▶';
});

function makeAdvRow(label, buttons) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:12px;color:#aaa;white-space:nowrap;';
    lbl.textContent = label;
    row.appendChild(lbl);
    const grp = document.createElement('div');
    grp.style.cssText = 'display:flex;gap:5px;';
    const btnRefs = [];
    buttons.forEach(({ text, onClick, isActive }) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 9px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;background:rgba(255,255,255,0.07);color:#ddd;transition:background 0.15s;';
        if (isActive && isActive()) btn.style.background = 'rgba(255,255,255,0.22)';
        btn.onmouseenter = () => { if (!isActive || !isActive()) btn.style.background = 'rgba(255,255,255,0.14)'; };
        btn.onmouseleave = () => { btn.style.background = isActive && isActive() ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)'; };
        btn.addEventListener('click', () => {
            currentQuality = null; // custom
            onClick();
            refreshSettings();
        });
        btnRefs.push({ btn, isActive });
        grp.appendChild(btn);
    });
    row.appendChild(grp);
    return { row, grp, btnRefs };
}

const resRow    = makeAdvRow('Resolution', [
    { text: '100%', onClick: () => applyResolution(1.0),  isActive: () => resolutionScale === 1.0  },
    { text: '75%',  onClick: () => applyResolution(0.75), isActive: () => resolutionScale === 0.75 },
    { text: '50%',  onClick: () => applyResolution(0.5),  isActive: () => resolutionScale === 0.5  },
]);
const shadowRow = makeAdvRow('Shadows', [
    { text: '1024', onClick: () => applyShadowRes(1024), isActive: () => shadowMapSize === 1024 },
    { text: '512',  onClick: () => applyShadowRes(512),  isActive: () => shadowMapSize === 512  },
    { text: '256',  onClick: () => applyShadowRes(256),  isActive: () => shadowMapSize === 256  },
    { text: 'Off',  onClick: () => applyShadowRes(0),    isActive: () => shadowMapSize === 0    },
]);
const gaussRow  = makeAdvRow('Gaussian Blur', [
    { text: 'On',  onClick: () => applyGaussian(true),  isActive: () =>  useGaussian },
    { text: 'Off', onClick: () => applyGaussian(false), isActive: () => !useGaussian },
]);
advancedPanel.appendChild(resRow.row);
advancedPanel.appendChild(shadowRow.row);
advancedPanel.appendChild(gaussRow.row);

// ── Extra stats section ───────────────────────────────────────────────────────
let showFps = false;
let showXyz = false;
let showBiome = false;
let showSpeed = false;

const statsContainer = document.createElement('div');
statsContainer.style.cssText = 'position:fixed;top:20px;right:20px;display:flex;flex-direction:column;gap:2px;z-index:1001;pointer-events:none;';
document.body.appendChild(statsContainer);

const xyzDisplay = document.createElement('div');
xyzDisplay.style.cssText = 'color:white;font-family:monospace;font-size:13px;text-shadow:1px 1px 1px black;display:none;';
statsContainer.appendChild(xyzDisplay);

const biomeDisplay = document.createElement('div');
biomeDisplay.style.cssText = 'color:white;font-family:monospace;font-size:13px;text-shadow:1px 1px 1px black;display:none;';
statsContainer.appendChild(biomeDisplay);

const speedDisplay = document.createElement('div');
speedDisplay.style.cssText = 'color:white;font-family:monospace;font-size:13px;text-shadow:1px 1px 1px black;display:none;';
statsContainer.appendChild(speedDisplay);

const extraToggle = document.createElement('button');
extraToggle.style.cssText = 'font-family:monospace;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);cursor:pointer;background:rgba(255,255,255,0.05);color:#aaa;text-align:left;display:flex;align-items:center;gap:6px;width:100%;';
extraToggle.innerHTML = '<span id="extra-arrow" style="font-size:10px;">▶</span> Extra';
settingsPanel.appendChild(extraToggle);

const extraPanel = document.createElement('div');
extraPanel.style.cssText = 'display:none;flex-direction:column;gap:10px;border-left:2px solid rgba(255,255,255,0.1);padding-left:14px;margin-left:2px;';
settingsPanel.appendChild(extraPanel);

let extraOpen = false;
extraToggle.addEventListener('click', () => {
    extraOpen = !extraOpen;
    extraPanel.style.display = extraOpen ? 'flex' : 'none';
    document.getElementById('extra-arrow').textContent = extraOpen ? '▼' : '▶';
});

function makeToggleRow(label, getState, setState) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:12px;color:#aaa;white-space:nowrap;';
    lbl.textContent = label;
    row.appendChild(lbl);
    const btn = document.createElement('button');
    const updateBtn = () => {
        const on = getState();
        btn.textContent = on ? 'On' : 'Off';
        btn.style.background = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
    };
    btn.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 9px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;color:#ddd;transition:background 0.15s;';
    btn.addEventListener('click', () => { setState(!getState()); updateBtn(); });
    updateBtn();
    row.appendChild(btn);
    return { row, updateBtn };
}

const fpsToggle   = makeToggleRow('FPS Counter', () => showFps,   v => { showFps = v;   fpsDisplay.style.display = v ? '' : 'none'; });
const xyzToggle   = makeToggleRow('XYZ Coords',  () => showXyz,   v => { showXyz = v;   xyzDisplay.style.display = v ? '' : 'none'; });
const biomeToggle = makeToggleRow('Biome',        () => showBiome, v => { showBiome = v; biomeDisplay.style.display = v ? '' : 'none'; });
const speedToggle = makeToggleRow('Speed',        () => showSpeed, v => { showSpeed = v; speedDisplay.style.display = v ? '' : 'none'; });
const mainThreadToggle = makeToggleRow('Mesh updates on main thread', () => mainThreadMesh, v => { mainThreadMesh = v; });
const bilinearToggle = makeToggleRow('Bilinear Filtering', () => bilinearFiltering, v => { bilinearFiltering = v; applyFilterMode(); });
extraPanel.appendChild(fpsToggle.row);
extraPanel.appendChild(xyzToggle.row);
extraPanel.appendChild(biomeToggle.row);
extraPanel.appendChild(speedToggle.row);
extraPanel.appendChild(mainThreadToggle.row);
extraPanel.appendChild(bilinearToggle.row);

// ── Cheats section ────────────────────────────────────────────────────────────
let cheatsUnlocked = false;

// Warning overlay
const cheatsWarningOverlay = document.createElement('div');
cheatsWarningOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);display:none;align-items:center;justify-content:center;z-index:4000;';
document.body.appendChild(cheatsWarningOverlay);

const cheatsWarningBox = document.createElement('div');
cheatsWarningBox.style.cssText = 'background:rgba(18,10,10,0.98);border:1px solid rgba(255,80,80,0.3);border-radius:14px;padding:28px 32px 24px;font-family:monospace;color:#fff;max-width:340px;display:flex;flex-direction:column;gap:18px;text-align:center;';
cheatsWarningOverlay.appendChild(cheatsWarningBox);

const warningIcon = document.createElement('div');
warningIcon.style.cssText = 'font-size:28px;color:#ff6060;';
warningIcon.textContent = '⚠';
cheatsWarningBox.appendChild(warningIcon);

const warningText = document.createElement('div');
warningText.style.cssText = 'font-size:13px;color:#ddd;line-height:1.6;';
warningText.textContent = 'These are cheats. They give you an unfair advantage. Use them at your own loss.';
cheatsWarningBox.appendChild(warningText);

const warningBtns = document.createElement('div');
warningBtns.style.cssText = 'display:flex;gap:10px;justify-content:center;';

const acceptBtn = document.createElement('button');
acceptBtn.textContent = 'Accept';
acceptBtn.style.cssText = 'font-family:monospace;font-size:12px;padding:7px 18px;border-radius:7px;border:1px solid rgba(255,80,80,0.4);cursor:pointer;background:rgba(255,60,60,0.15);color:#ff9090;';
acceptBtn.addEventListener('click', () => {
    cheatsUnlocked = true;
    cheatsWarningOverlay.style.display = 'none';
    cheatsPanel.style.display = 'flex';
    document.getElementById('cheats-arrow').textContent = '▼';
    cheatsOpen = true;
});
warningBtns.appendChild(acceptBtn);

const cancelBtn = document.createElement('button');
cancelBtn.textContent = 'Cancel';
cancelBtn.style.cssText = 'font-family:monospace;font-size:12px;padding:7px 18px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;background:rgba(255,255,255,0.07);color:#ccc;';
cancelBtn.addEventListener('click', () => { cheatsWarningOverlay.style.display = 'none'; });
warningBtns.appendChild(cancelBtn);
cheatsWarningBox.appendChild(warningBtns);

// Cheats toggle row
const cheatsToggle = document.createElement('button');
cheatsToggle.style.cssText = 'font-family:monospace;font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid rgba(255,80,80,0.25);cursor:pointer;background:rgba(255,60,60,0.06);color:#ff9090;text-align:left;display:flex;align-items:center;gap:6px;width:100%;';
cheatsToggle.innerHTML = '<span id="cheats-arrow" style="font-size:10px;">▶</span> Cheats';
settingsPanel.appendChild(cheatsToggle);

const cheatsPanel = document.createElement('div');
cheatsPanel.style.cssText = 'display:none;flex-direction:column;gap:14px;border-left:2px solid rgba(255,80,80,0.2);padding-left:14px;margin-left:2px;';
settingsPanel.appendChild(cheatsPanel);

let cheatsOpen = false;
cheatsToggle.addEventListener('click', () => {
    if (!cheatsUnlocked) {
        cheatsWarningOverlay.style.display = 'flex';
        return;
    }
    cheatsOpen = !cheatsOpen;
    cheatsPanel.style.display = cheatsOpen ? 'flex' : 'none';
    document.getElementById('cheats-arrow').textContent = cheatsOpen ? '▼' : '▶';
});

function makeCheatRow(label, desc, control) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:12px;color:#ff9090;white-space:nowrap;font-weight:bold;';
    lbl.textContent = label;
    top.appendChild(lbl);
    top.appendChild(control);
    wrap.appendChild(top);
    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:10px;color:#888;line-height:1.4;';
    descEl.textContent = desc;
    wrap.appendChild(descEl);
    return wrap;
}

// Fly cheat
const flyBtn = document.createElement('button');
flyBtn.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 10px;border-radius:5px;border:1px solid rgba(255,80,80,0.25);cursor:pointer;color:#ff9090;transition:background 0.15s;';
const updateFlyBtn = () => {
    flyBtn.textContent = flyMode ? 'On' : 'Off';
    flyBtn.style.background = flyMode ? 'rgba(255,80,80,0.25)' : 'rgba(255,255,255,0.05)';
};
updateFlyBtn();
flyBtn.addEventListener('click', () => {
    flyMode = !flyMode;
    if (!flyMode) isFlying = false;
    showFeedback(`fly mode ${flyMode ? 'on' : 'off'}`);
    updateFlyBtn();
});
cheatsPanel.appendChild(makeCheatRow('Fly', 'Toggle flight mode. Double-jump or Space while flying to ascend. Works with speed.', flyBtn));

// Speed cheat
const speedCheatRow = document.createElement('div');
speedCheatRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
const speedInput = document.createElement('input');
speedInput.type = 'number';
speedInput.min = '1';
speedInput.max = '100';
speedInput.value = String(speedMultiplier);
speedInput.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 6px;border-radius:5px;border:1px solid rgba(255,80,80,0.25);background:rgba(0,0,0,0.4);color:#ff9090;width:54px;';
speedInput.addEventListener('click', e => e.stopPropagation());
speedInput.addEventListener('keydown', e => e.stopPropagation());
const speedApplyBtn = document.createElement('button');
speedApplyBtn.textContent = 'Set';
speedApplyBtn.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 9px;border-radius:5px;border:1px solid rgba(255,80,80,0.25);cursor:pointer;background:rgba(255,80,80,0.12);color:#ff9090;';
speedApplyBtn.addEventListener('click', () => {
    const val = parseFloat(speedInput.value);
    if (!isNaN(val) && val > 0) {
        speedMultiplier = val;
        showFeedback(`speed set to ${val}x`);
    }
});
speedCheatRow.appendChild(speedInput);
speedCheatRow.appendChild(speedApplyBtn);
cheatsPanel.appendChild(makeCheatRow('Speed', 'Multiply your movement speed. Also scales fly speed. Default is 1. High values may cause physics issues.', speedCheatRow));

// Inception cheat
const inceptionBtn = document.createElement('button');
inceptionBtn.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 10px;border-radius:5px;border:1px solid rgba(255,80,80,0.25);cursor:pointer;color:#ff9090;transition:background 0.15s;';
const updateInceptionBtn = () => {
    inceptionBtn.textContent = inceptionMode ? 'On' : 'Off';
    inceptionBtn.style.background = inceptionMode ? 'rgba(255,80,80,0.25)' : 'rgba(255,255,255,0.05)';
};
updateInceptionBtn();
inceptionBtn.addEventListener('click', () => {
    inceptionMode = !inceptionMode;
    showFeedback(`inception mode ${inceptionMode ? 'on' : 'off'}`);
    updateInceptionBtn();
});
cheatsPanel.appendChild(makeCheatRow('Inception', 'Warps world geometry into a surreal curved globe effect. Purely visual — does not affect physics or collision.', inceptionBtn));

// Stop Fade cheat
const stopFadeBtn = document.createElement('button');
stopFadeBtn.style.cssText = 'font-family:monospace;font-size:11px;padding:4px 10px;border-radius:5px;border:1px solid rgba(255,80,80,0.25);cursor:pointer;color:#ff9090;transition:background 0.15s;';
const updateStopFadeBtn = () => {
    stopFadeBtn.textContent = stopFade ? 'On' : 'Off';
    stopFadeBtn.style.background = stopFade ? 'rgba(255,80,80,0.25)' : 'rgba(255,255,255,0.05)';
};
updateStopFadeBtn();
stopFadeBtn.addEventListener('click', () => {
    stopFade = !stopFade;
    ultimateUniforms.uStopFade.value = stopFade ? 1.0 : 0.0;
    showFeedback(`stop fade ${stopFade ? 'on' : 'off'}`);
    updateStopFadeBtn();
});
cheatsPanel.appendChild(makeCheatRow('Stop Fade', 'Prevents terrain meshes from fading out at high altitude.', stopFadeBtn));

// Save world button
const saveWorldBtn = document.createElement('button');
saveWorldBtn.textContent = 'Save World';
saveWorldBtn.style.cssText = 'font-family:monospace;font-size:13px;padding:9px;border-radius:8px;border:1px solid rgba(100,220,100,0.28);cursor:pointer;background:rgba(100,220,100,0.07);color:#aaffaa;margin-top:4px;';
saveWorldBtn.addEventListener('click', async () => {
    await saveCurrentWorld();
    settingsOpen = false;
    settingsOverlay.style.display = 'none';
    showSaveConfirmOverlay();
});
settingsPanel.appendChild(saveWorldBtn);

// Resume button (always last)
const resumeBtn = document.createElement('button');
resumeBtn.textContent = 'Resume  [Esc]';
resumeBtn.style.cssText = 'font-family:monospace;font-size:13px;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;background:rgba(255,255,255,0.09);color:#fff;margin-top:4px;';
resumeBtn.addEventListener('click', closeSettings);
settingsPanel.appendChild(resumeBtn);

function refreshSettings() {
    // Quality preset buttons
    QUALITY_LEVELS.forEach(({ id }) => {
        qualityBtns[id].style.background = currentQuality === id ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
    });
    // Advanced row buttons
    [resRow, shadowRow, gaussRow].forEach(({ btnRefs }) => {
        btnRefs.forEach(({ btn, isActive }) => {
            btn.style.background = isActive && isActive() ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
        });
    });
    // Extra toggles
    fpsToggle.updateBtn();
    xyzToggle.updateBtn();
    biomeToggle.updateBtn();
    speedToggle.updateBtn();
    // Cheat buttons
    updateFlyBtn();
    updateInceptionBtn();
    speedInput.value = String(speedMultiplier);
}

function applyResolution(scale) {
    resolutionScale = scale;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function applyShadowRes(size) {
    shadowMapSize = size;
    if (size === 0) {
        renderer.shadowMap.enabled = false;
    } else {
        renderer.shadowMap.enabled = true;
        sunLight.shadow.mapSize.set(size, size);
        if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    }
    // Force material updates so shadow state is re-evaluated
    for (const mat of Object.values(MATS)) mat.needsUpdate = true;
}

function applyGaussian(enabled) {
    useGaussian = enabled;
    broadcastWorkers({ type: 'setGaussian', useGaussian: enabled });
    // Rebuild all loaded chunks so the new density mode takes effect
    for (const [key, entry] of loadedChunks) {
        const [cx, cy, cz] = key.split(',').map(Number);
        rebuildChunk(cx, cy, cz, entry.lod);
    }
}

function openSettings() {
    settingsOpen = true;
    settingsOverlay.style.display = 'flex';
    overlay.style.display = 'none';
    refreshSettings();
}

function closeSettings() {
    settingsOpen = false;
    settingsOverlay.style.display = 'none';
    renderer.domElement.requestPointerLock();
}

document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) {
        hasStartedPlaying = true;
        overlay.style.display = 'none';
    } else if (inventoryOpen || scOpen) {
        overlay.style.display = 'none'; // inventory/sc handles its own state
    } else if (!gameActive) {
        overlay.style.display = 'none'; // main menu is handling the screen
    } else if (hasStartedPlaying && !getIsDead()) {
        openSettings();
    } else {
        overlay.style.display = 'flex';
    }
});

// Escape or backtick while settings are open closes them and re-locks
window.addEventListener('keydown', e => {
    if ((e.code === 'Escape' || e.code === 'Backquote') && settingsOpen) {
        closeSettings();
    } else if (e.code === 'Backquote' && !settingsOpen && !inventoryOpen) {
        e.preventDefault();
        document.exitPointerLock();
    }
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
const _meshRaycaster = new THREE.Raycaster();
_meshRaycaster.far = 12;
const _magnetNormal = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camDir    = new THREE.Vector3();
const _camHit    = new THREE.Vector3();
const hud    = document.getElementById('hud');
const fpsDisplay = document.createElement('div');
fpsDisplay.style.cssText = 'color:white;font-family:monospace;font-size:13px;text-shadow:1px 1px 1px black;display:none;';
statsContainer.insertBefore(fpsDisplay, statsContainer.firstChild);

const cmdInput = document.getElementById('command-input');
const cmdFeedback = document.getElementById('command-feedback');
let miningProgress = 0;
let miningTarget = null;
let miningParticleTimer = 0;
const shake = { amount: 0, time: 0 };
let pickaxeBreaking = false;
let pickaxeSwingTime = 0;
let last = performance.now();
let dynamiteMode   = false;
let instamineMode  = false;

// ── Space Music ───────────────────────────────────────────────────────────────
const cosmologyAudio = new Audio('assets/music/Cosmology.m4a');
cosmologyAudio.loop = true;
cosmologyAudio.volume = 0;

// ── Fates Dialogue Music ──────────────────────────────────────────────────────
const fatedAudio = new Audio('assets/music/Fated.mp3');
fatedAudio.loop = true;
fatedAudio.volume = 0;
let _fatedFadeInterval = null;

function playFatedMusic() {
    clearInterval(_fatedFadeInterval);
    fatedAudio.currentTime = 0;
    fatedAudio.volume = 0;
    fatedAudio.play().catch(() => {});
    let v = 0;
    _fatedFadeInterval = setInterval(() => {
        v = Math.min(v + 0.02, 1);
        fatedAudio.volume = v;
        if (v >= 1) clearInterval(_fatedFadeInterval);
    }, 50);
}

function stopFatedMusic() {
    clearInterval(_fatedFadeInterval);
    let v = fatedAudio.volume;
    _fatedFadeInterval = setInterval(() => {
        v = Math.max(v - 0.02, 0);
        fatedAudio.volume = v;
        if (v <= 0) { clearInterval(_fatedFadeInterval); fatedAudio.pause(); }
    }, 50);
}
let cosmologyPlaying = false;
let fullbright = false;
let voxelMode = false;
let xrayMode = false;
let isTransitioning = false;
let fatesFirstEntry = true;
let fatesVisitCount = 0;
let fatesNoTimer = false;
let fatesCountdownEl = null;

// ── Main menu ─────────────────────────────────────────────────────────────────
const mainMenuEl = document.createElement('div');
mainMenuEl.style.cssText = 'position:fixed;inset:0;z-index:5000;background:url("assets/textures/title.png") center/cover no-repeat;image-rendering:pixelated;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:110px;gap:10px;';
document.body.appendChild(mainMenuEl);

const _menuBtnBase = 'font-family:monospace;font-size:15px;padding:13px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.22);cursor:pointer;color:#fff;letter-spacing:0.05em;min-width:220px;transition:background 0.15s,border-color 0.15s;';

function _menuBtn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = _menuBtnBase + 'background:rgba(0,0,0,0.55);';
    b.onmouseenter = () => { b.style.background = 'rgba(0,0,0,0.8)'; b.style.borderColor = 'rgba(255,255,255,0.45)'; };
    b.onmouseleave = () => { b.style.background = 'rgba(0,0,0,0.55)'; b.style.borderColor = 'rgba(255,255,255,0.22)'; };
    return b;
}

const mmNewBtn  = _menuBtn('New Game');
const mmLoadBtn = _menuBtn('Load Save');
mainMenuEl.appendChild(mmNewBtn);
mainMenuEl.appendChild(mmLoadBtn);

// ── Shared modal helpers ──────────────────────────────────────────────────────
function _modalOverlay(z = 5100) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;inset:0;z-index:${z};background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;`;
    document.body.appendChild(el);
    return el;
}
function _modalBox() {
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(12,12,12,0.98);border:1px solid rgba(255,255,255,0.13);border-radius:12px;padding:28px 32px 24px;font-family:monospace;color:#fff;display:flex;flex-direction:column;gap:16px;';
    return el;
}
function _modalTitle(text) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:15px;font-weight:bold;letter-spacing:0.03em;';
    el.textContent = text;
    return el;
}
function _btn(label, style = '') {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-family:monospace;font-size:12px;padding:7px 20px;border-radius:7px;cursor:pointer;transition:background 0.12s;' + style;
    return b;
}
function _btnRow(...btns) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    btns.forEach(b => row.appendChild(b));
    return row;
}

// ── Supercomputer Modal ───────────────────────────────────────────────────────
const scOverlay = _modalOverlay(6000);
const scBox     = _modalBox();
scBox.style.minWidth = '300px';
scOverlay.appendChild(scBox);
scBox.appendChild(_modalTitle('Supercomputer Mode'));

const scLabel = document.createElement('div');
scLabel.style.cssText = 'font-size:12px;color:#aaa;';
scLabel.textContent = 'Blur Intensity (Radius):';
scBox.appendChild(scLabel);

const scSlider = document.createElement('input');
scSlider.type = 'range';
scSlider.min = '1';
scSlider.max = '6';
scSlider.value = '3';
scSlider.style.cssText = 'width:100%;cursor:pointer;';
scBox.appendChild(scSlider);

const scInput = document.createElement('input');
scInput.type = 'number';
scInput.value = '3';
scInput.style.cssText = 'font-family:monospace;font-size:14px;color:#adf;text-align:center;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:4px;width:60px;margin:0 auto;display:block;outline:none;';
scInput.addEventListener('keydown', e => e.stopPropagation());
scInput.addEventListener('click', e => e.stopPropagation());
scSlider.oninput = () => { scInput.value = scSlider.value; };
scInput.oninput  = () => { scSlider.value = scInput.value; };
scBox.appendChild(scInput);

const scApplyBtn = _btn('Apply', 'border:1px solid rgba(100,255,100,0.4);background:rgba(100,255,100,0.1);color:#afffba;');
scBox.appendChild(_btnRow(scApplyBtn));

scApplyBtn.addEventListener('click', () => {
    const radius = parseInt(scInput.value) || 1;
    supercomputerMode = radius > 1 ? radius : false;
    scOverlay.style.display = 'none';
    scOpen = false;
    
    broadcastWorkers({ type: 'setSupercomputer', enabled: supercomputerMode });
    for (const key of Array.from(loadedChunks.keys())) {
        const [cx, cy, cz] = key.split(',').map(Number);
        const entry = loadedChunks.get(key);
        rebuildChunk(cx, cy, cz, entry ? entry.lod : 1);
    }
    
    showFeedback(`supercomputer mode: radius ${radius}`);
    renderer.domElement.requestPointerLock();
});

// ── New game modal ────────────────────────────────────────────────────────────
const ngOverlay = _modalOverlay(5100);
const ngBox     = _modalBox();
ngBox.style.minWidth = '300px';
ngOverlay.appendChild(ngBox);
ngBox.appendChild(_modalTitle('New World'));

const ngInput = document.createElement('input');
ngInput.type        = 'text';
ngInput.placeholder = 'World name...';
ngInput.maxLength   = 40;
ngInput.style.cssText = 'font-family:monospace;font-size:13px;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.55);color:#fff;outline:none;';
ngBox.appendChild(ngInput);

const ngCreate = _btn('Create', 'border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.1);color:#fff;');
const ngCancel = _btn('Cancel', 'border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#bbb;');
ngBox.appendChild(_btnRow(ngCancel, ngCreate));

function openNgModal() { ngOverlay.style.display = 'flex'; ngInput.value = ''; setTimeout(() => ngInput.focus(), 40); }
function closeNgModal() { ngOverlay.style.display = 'none'; }

mmNewBtn.addEventListener('click', openNgModal);
ngCancel.addEventListener('click', closeNgModal);
ngInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') ngCreate.click(); if (e.key === 'Escape') closeNgModal(); });
ngInput.addEventListener('click', e => e.stopPropagation());
ngCreate.addEventListener('click', () => {
    const name = ngInput.value.trim();
    if (!name) { ngInput.focus(); return; }
    closeNgModal();
    startNewGame(name);
});

// ── Load save modal ───────────────────────────────────────────────────────────
const ldOverlay = _modalOverlay(5100);
const ldBox     = _modalBox();
ldBox.style.cssText += 'min-width:460px;max-height:70vh;overflow:hidden;';
ldOverlay.appendChild(ldBox);
ldBox.appendChild(_modalTitle('Load Save'));

const ldList = document.createElement('div');
ldList.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:52vh;padding-right:4px;';
ldBox.appendChild(ldList);

const ldClose = _btn('Cancel', 'border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#bbb;align-self:flex-end;');
ldBox.appendChild(ldClose);
ldClose.addEventListener('click', () => { ldOverlay.style.display = 'none'; });

mmLoadBtn.addEventListener('click', async () => {
    ldOverlay.style.display = 'flex';
    ldList.innerHTML = '<div style="color:#888;font-size:12px;padding:6px 0;">Loading saves...</div>';
    const worlds = await listWorlds();
    ldList.innerHTML = '';
    if (worlds.length === 0) {
        ldList.innerHTML = '<div style="color:#888;font-size:12px;padding:6px 0;">No saves found.</div>';
        return;
    }
    worlds.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    for (const w of worlds) {
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;display:flex;flex-direction:row;overflow:hidden;transition:background 0.12s,border-color 0.12s;';
        card.onmouseenter = () => { card.style.background = 'rgba(255,255,255,0.07)'; card.style.borderColor = 'rgba(255,255,255,0.22)'; };
        card.onmouseleave = () => { card.style.background = ''; card.style.borderColor = 'rgba(255,255,255,0.1)'; };

        let thumbEl = null;
        if (w.thumbnail) {
            const img = document.createElement('img');
            img.src = w.thumbnail;
            img.style.cssText = 'width:160px;height:90px;object-fit:cover;flex-shrink:0;display:block;';
            card.appendChild(img);
            thumbEl = img;
        }

        const info = document.createElement('div');
        info.style.cssText = 'display:flex;flex-direction:column;gap:3px;justify-content:center;padding:10px 14px;';
        const wName = document.createElement('div');
        wName.style.cssText = 'font-size:13px;font-weight:bold;';
        wName.textContent = w.name;
        const wDate = document.createElement('div');
        wDate.style.cssText = 'font-size:11px;color:#777;';
        wDate.textContent = w.savedAt ? new Date(w.savedAt).toLocaleString() : '';
        info.appendChild(wName);
        info.appendChild(wDate);
        card.appendChild(info);

        card.addEventListener('click', () => {
            const rect = thumbEl ? thumbEl.getBoundingClientRect() : null;
            _pendingLoadThumbRect = rect;
            ldOverlay.style.display = 'none';
            renderer.domElement.requestPointerLock();
            if (thumbEl) startLoadCinematic(thumbEl.src, rect);
            doLoadGame(w.name);
        });
        ldList.appendChild(card);
    }
});

let _pendingLoadThumbRect = null;

// ── Load cinematic ────────────────────────────────────────────────────────────
const LOAD_EXPAND_MS = 650;

const loadCinematicEl = document.createElement('div');
loadCinematicEl.style.cssText = 'position:fixed;z-index:9998;overflow:hidden;display:none;pointer-events:none;';
const loadCinematicImg = document.createElement('img');
loadCinematicImg.style.cssText = 'width:100%;height:100%;object-fit:cover;transform-origin:center center;';
loadCinematicEl.appendChild(loadCinematicImg);
document.body.appendChild(loadCinematicEl);

let isLoadCinematic = false;

function startLoadCinematic(src, rect) {
    loadCinematicImg.src = src;
    loadCinematicImg.style.animation  = '';
    loadCinematicImg.style.transform  = 'scale(1)';
    loadCinematicImg.style.transition = '';

    if (rect) {
        loadCinematicEl.style.left   = rect.left   + 'px';
        loadCinematicEl.style.top    = rect.top    + 'px';
        loadCinematicEl.style.width  = rect.width  + 'px';
        loadCinematicEl.style.height = rect.height + 'px';
    } else {
        loadCinematicEl.style.left   = '0';
        loadCinematicEl.style.top    = '0';
        loadCinematicEl.style.width  = window.innerWidth  + 'px';
        loadCinematicEl.style.height = window.innerHeight + 'px';
    }

    loadCinematicEl.style.opacity    = '1';
    loadCinematicEl.style.transition = '';
    loadCinematicEl.style.display    = 'block';

    void loadCinematicEl.offsetWidth;

    loadCinematicEl.style.transition = `left ${LOAD_EXPAND_MS}ms ease-in-out, top ${LOAD_EXPAND_MS}ms ease-in-out, width ${LOAD_EXPAND_MS}ms ease-in-out, height ${LOAD_EXPAND_MS}ms ease-in-out`;
    loadCinematicEl.style.left   = '0';
    loadCinematicEl.style.top    = '0';
    loadCinematicEl.style.width  = window.innerWidth  + 'px';
    loadCinematicEl.style.height = window.innerHeight + 'px';

    isLoadCinematic = true;
}

// ── Game start / load / save ──────────────────────────────────────────────────
function _clearWorld() {
    for (const entry of loadedChunks.values())
        for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
    loadedChunks.clear();
    buildQueue.length = 0;
    pendingChunks.clear();
    pendingMiningChunks.clear();
    lastPCX = null; lastPCZ = null; lastZone = null;
    markLodMaskDirty();
}

function _resetPlayerState() {
    player.pos.set(8, 184, 8);
    player.yaw = 0; player.pitch = 0;
    player.vel.set(0, 0, 0);
    world.dimension = DIM_EARTH;
    gameTime = DEFAULT_CYCLE * 0.25;
    for (let i = 0; i < 9;  i++) inventory[i]     = null;
    for (let i = 0; i < 27; i++) mainInventory[i]  = null;
    selectedSlot = 0;
    updateInventoryUI();
}

function startNewGame(name) {
    world.reset();
    _clearWorld();
    const s = newRandomSeeds();
    broadcastWorkers({ type: 'resetWorld' });
    broadcastWorkers({ type: 'initBiome', sx: s.bSeedX, sz: s.bSeedZ, inv: s.bOffset, mx: s.mSeedX, mz: s.mSeedZ });
    broadcastWorkers({ type: 'setDimension', dim: DIM_EARTH });
    _resetPlayerState();
    currentWorldName = name;
    worldDeltas.clear();
    gameActive = true;
    mainMenuEl.style.display = 'none';
    renderer.domElement.requestPointerLock();
}

async function doLoadGame(name) {
    const data = await loadWorld(name);
    if (!data) {
        // Abort any cinematic that was started optimistically
        loadCinematicEl.style.display = 'none';
        isLoadCinematic = false;
        showFeedback('save not found');
        return;
    }

    // Set player and camera immediately so the first rendered frame is correct
    player.pos.set(data.player.x, data.player.y, data.player.z);
    player.yaw        = data.player.yaw   ?? 0;
    player.pitch      = data.player.pitch ?? 0;
    player.vel.set(0, 0, 0);
    player.bobTimer   = 0;
    player.stepOffset = 0;
    camera.position.set(data.player.x, data.player.y + EYE_HEIGHT, data.player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

    world.reset();
    _clearWorld();

    const { bSeedX: sx, bSeedZ: sz, bOffset: inv, mSeedX: mx, mSeedZ: mz } = data.seeds;
    syncBiomeParams(sx, sz, inv, mx, mz);
    broadcastWorkers({ type: 'resetWorld' });
    broadcastWorkers({ type: 'initBiome', sx, sz, inv, mx, mz });

    const dim = data.dimension ?? DIM_EARTH;
    world.dimension = dim;
    broadcastWorkers({ type: 'setDimension', dim });

    if (data.gameTime !== undefined) gameTime = data.gameTime;

    for (let i = 0; i < 9;  i++) inventory[i]    = data.inventory?.[i]     ?? null;
    for (let i = 0; i < 27; i++) mainInventory[i] = data.mainInventory?.[i] ?? null;
    selectedSlot = data.selectedSlot ?? 0;
    updateInventoryUI();

    currentWorldName = name;
    worldDeltas.clear();

    // Apply every saved delta immediately, before any buildMesh requests are queued.
    // Worker messages are FIFO: these setVoxel calls arrive before the streaming
    // system's first buildMesh, so every chunk is generated-with-delta-applied.
    const savedDeltas = data.deltas ?? [];
    for (const { x, y, z, v } of savedDeltas) {
        world.set(x, y, z, v);              // main-thread world gets delta now
        worldDeltas.set(`${x},${y},${z}`, v);
    }
    for (const { x, y, z, v } of savedDeltas)
        broadcastWorkers({ type: 'setVoxel', x, y, z, v }); // workers get delta before any buildMesh

    gameActive = true;

    if (isLoadCinematic) {
        // Hide menu and start zoom after expand; chunks already streaming above
        setTimeout(() => {
            mainMenuEl.style.display = 'none';
            loadCinematicImg.style.animation = 'load-zoom 4s ease-in forwards';
            loadCinematicEl.style.transition = '';
        }, LOAD_EXPAND_MS);

        // After zoom-in: freeze scale then ease back to 1×
        setTimeout(() => {
            loadCinematicImg.style.animation  = 'none';
            loadCinematicImg.style.transform  = 'scale(1.18)';
            void loadCinematicImg.offsetWidth;
            loadCinematicImg.style.transition = 'transform 2s ease-in-out';
            loadCinematicImg.style.transform  = 'scale(1)';
        }, LOAD_EXPAND_MS + 4000);

        // Fade out after scale-back completes
        setTimeout(() => {
            loadCinematicImg.style.transition = '';
            loadCinematicEl.style.transition  = 'opacity 0.7s ease-in';
            loadCinematicEl.style.opacity     = '0';
            setTimeout(() => {
                loadCinematicEl.style.display    = 'none';
                loadCinematicEl.style.transition = '';
                loadCinematicImg.style.transform = '';
                isLoadCinematic = false;
            }, 700);
        }, LOAD_EXPAND_MS + 4000 + 2000);
    } else {
        mainMenuEl.style.display = 'none';
    }
}

function captureScreenshot() {
    const prevRatio = renderer.getPixelRatio();
    const prevW     = window.innerWidth;
    const prevH     = window.innerHeight;
    const prevAspect = camera.aspect;
    const prevHudAspect = hudCamera.aspect;

    renderer.setPixelRatio(1);
    renderer.setSize(1920, 1080, false);
    camera.aspect = 1920 / 1080;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/jpeg', 0.88);

    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevW, prevH, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    hudCamera.aspect = prevHudAspect;
    hudCamera.updateProjectionMatrix();

    return dataURL;
}

async function saveCurrentWorld() {
    if (!gameActive || !currentWorldName) return;
    const thumbnail = captureScreenshot();
    const deltas = [...worldDeltas.entries()].map(([key, v]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, v };
    });
    await saveWorld({
        name: currentWorldName,
        savedAt: Date.now(),
        thumbnail,
        seeds: { bSeedX, bSeedZ, bOffset, mSeedX, mSeedZ },
        player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch },
        dimension: world.dimension,
        gameTime,
        inventory:     [...inventory],
        mainInventory: [...mainInventory],
        selectedSlot,
        deltas,
    });
    showFeedback('world saved');
}

function showSaveConfirmOverlay() {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.72);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:monospace;';

    const msg = document.createElement('div');
    msg.textContent = 'World saved!';
    msg.style.cssText = 'color:#aaffaa;font-size:22px;letter-spacing:0.05em;';

    const question = document.createElement('div');
    question.textContent = 'Return to main menu?';
    question.style.cssText = 'color:#fff;font-size:16px;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:14px;';

    const btnBase = 'font-family:monospace;font-size:14px;padding:10px 28px;border-radius:8px;cursor:pointer;letter-spacing:0.04em;';

    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Yes';
    yesBtn.style.cssText = btnBase + 'background:rgba(100,220,100,0.12);border:1px solid rgba(100,220,100,0.4);color:#aaffaa;';
    yesBtn.addEventListener('click', () => { location.reload(); });

    const noBtn = document.createElement('button');
    noBtn.textContent = 'No';
    noBtn.style.cssText = btnBase + 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);color:#fff;';
    noBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        renderer.domElement.requestPointerLock();
    });

    btnRow.appendChild(yesBtn);
    btnRow.appendChild(noBtn);
    modal.appendChild(msg);
    modal.appendChild(question);
    modal.appendChild(btnRow);
    document.body.appendChild(modal);
}

function startMoonTransition() {
    isTransitioning = true;
    fadeOverlay.style.opacity = '1';

    setTimeout(() => {
        // Switch dimension
        world.dimension = DIM_MOON;
        broadcastWorkers({ type: 'setDimension', dim: DIM_MOON });
        curveUniforms.uPlanetRadius.value = MOON_PLANET_RADIUS;
        ultimateUniforms.uIsMoon.value  = 1.0;
        ultimateUniforms.uIsFates.value = 0.0;
        setTerrainFog(false);

        // Clear current meshes
        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
        }
        loadedChunks.clear();
        markLodMaskDirty();
        buildQueue.length = 0;
        pendingChunks.clear();
        pendingMiningChunks.clear();

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
        broadcastWorkers({ type: 'setDimension', dim: DIM_EARTH });
        curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
        ultimateUniforms.uIsMoon.value  = 0.0;
        ultimateUniforms.uIsFates.value = 0.0;
        setTerrainFog(false);

        // Clear current meshes
        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
        }
        loadedChunks.clear();
        markLodMaskDirty();
        buildQueue.length = 0;
        pendingChunks.clear();
        pendingMiningChunks.clear();

        // Spawn below the moon sphere in Earth
        // moonSphere in Earth is at (500, 3800, 20)
        player.pos.set(500, 3750, 20);
        player.vel.set(0, -10, 0); // Start falling

        fadeOverlay.style.opacity = '0';
        setTimeout(() => isTransitioning = false, 1000);
    }, 1000);
}

function startWaterTransition() {
    isTransitioning = true;
    fadeOverlay.style.opacity = '1';

    setTimeout(() => {
        world.dimension = DIM_WATER;
        broadcastWorkers({ type: 'setDimension', dim: DIM_WATER });
        curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
        ultimateUniforms.uIsMoon.value  = 0.0;
        ultimateUniforms.uIsFates.value = 0.0;
        setTerrainFog(false);

        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
        }
        loadedChunks.clear();
        markLodMaskDirty();
        buildQueue.length = 0;
        pendingChunks.clear();
        pendingMiningChunks.clear();

        // Spawn above the water surface (water is y=20-29, spawn at y=32)
        player.pos.set(8, 32, 8);
        player.vel.set(0, -5, 0);

        fadeOverlay.style.opacity = '0';
        setTimeout(() => isTransitioning = false, 1000);
    }, 1000);
}

function setTerrainFog(enabled) {
    for (const m of Object.values(MATS)) {
        if (m.fog !== enabled) {
            m.fog = enabled;
            m.needsUpdate = true;
        }
    }
}

const fatesIntroOverlay = document.createElement('div');
fatesIntroOverlay.style.cssText = 'position:fixed;inset:0;z-index:4500;background:black url("assets/prototype/fates/bg.gif") center/cover no-repeat;opacity:0;pointer-events:none;transition:opacity 1s;';
document.body.appendChild(fatesIntroOverlay);

const fatesRedOverlay = document.createElement('div');
fatesRedOverlay.style.cssText = 'position:absolute;inset:0;background:url("assets/prototype/fates/bg_red.gif") center/cover no-repeat;opacity:0;transition:opacity 1s;pointer-events:none;';
fatesIntroOverlay.appendChild(fatesRedOverlay);

const fatesWhiteOverlay = document.createElement('div');
fatesWhiteOverlay.style.cssText = 'position:absolute;inset:0;background:url("assets/prototype/fates/bg_white.gif") center/cover no-repeat;opacity:0;transition:opacity 1s;pointer-events:none;';
fatesIntroOverlay.appendChild(fatesWhiteOverlay);

function startFatesIntro(onDone, dialogueData = FATES_DIALOGUE) {
    // Remove transition so the overlay appears in the same paint frame the death
    // blackout clears — no gap between them.
    fatesIntroOverlay.style.transition = 'none';
    fatesIntroOverlay.style.opacity = '1';
    fatesIntroOverlay.style.pointerEvents = 'auto';
    fatesRedOverlay.style.opacity = '0';
    // Re-enable transition after the instant snap so the fade-out is still smooth.
    requestAnimationFrame(() => { fatesIntroOverlay.style.transition = 'opacity 1s'; });
    playFatedMusic();
    showDialogue(dialogueData, () => {
        fatesIntroOverlay.style.opacity = '0';
        fatesIntroOverlay.style.pointerEvents = 'none';
        stopFatedMusic();
        setTimeout(onDone, 1000);
    }, {
        shake: (amount) => { shake.amount = amount; shake.time = 0; },
        bg: (name) => {
            fatesRedOverlay.style.opacity   = name === 'red'   ? '1' : '0';
            fatesWhiteOverlay.style.opacity = name === 'white' ? '1' : '0';
        },
    });
}

function startFatesTransition() {
    isTransitioning = true;
    fadeOverlay.style.opacity = '1';

    setTimeout(() => {
        world.dimension = DIM_FATES;
        broadcastWorkers({ type: 'setDimension', dim: DIM_FATES });
        curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
        ultimateUniforms.uIsMoon.value  = 0.0;
        ultimateUniforms.uIsFates.value = 1.0;
        setTerrainFog(true);

        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
        }
        loadedChunks.clear();
        markLodMaskDirty();
        buildQueue.length = 0;
        pendingChunks.clear();
        pendingMiningChunks.clear();

        const fatesSpawn = findFatesSmoothSpawn();
        player.pos.set(150, fatesSpawn.y, 450);
        player.vel.set(0, 0, 0);

        fadeOverlay.style.opacity = '0';
        setTimeout(() => {
            isTransitioning = false;
            startFatesCountdown();
        }, 1000);
    }, 1000);
}

function respawnFromFates() {
    isTransitioning = true;
    world.dimension = DIM_EARTH;
    broadcastWorkers({ type: 'setDimension', dim: DIM_EARTH });
    curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
    ultimateUniforms.uIsMoon.value  = 0.0;
    ultimateUniforms.uIsFates.value = 0.0;
    setTerrainFog(false);

    for (const entry of loadedChunks.values()) {
        for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
    }
    loadedChunks.clear();
    markLodMaskDirty();
    buildQueue.length = 0;
    pendingChunks.clear();
    pendingMiningChunks.clear();

    const spawnY = world.surfaceAt(8, 8) + 2;
    player.pos.set(8, spawnY, 8);
    player.vel.set(0, 0, 0);
    isFlying = false;

    startPixelAnim(64, 1, 800, () => {
        isTransitioning = false;
        document.body.requestPointerLock?.();
    });
}

function startFatesCountdown() {
    let count = 20;
    let elapsed = 0;

    const el = document.createElement('div');
    fatesCountdownEl = el;
    el.textContent = '20';
    Object.assign(el.style, {
        position: 'fixed',
        zIndex: '4000',
        pointerEvents: 'none',
        userSelect: 'none',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        color: 'rgba(220, 200, 255, 1)',
        textShadow: '0 0 40px rgba(180, 100, 255, 0.9), 0 0 100px rgba(180, 100, 255, 0.4)',
        opacity: '0',
        fontSize: '20vw',
        lineHeight: '1',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        transition: 'opacity 0.6s ease',
    });
    document.body.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!fatesNoTimer) el.style.opacity = '1';
    }));

    const interval = setInterval(() => {
        if (fatesNoTimer) return;

        elapsed++;
        count--;

        if (count <= 0) {
            clearInterval(interval);
            el.textContent = '0';
            startPixelAnim(1, 64, 700, () => {
                el.remove();
                fatesCountdownEl = null;
                respawnFromFates();
            });
            return;
        }

        el.textContent = String(count);

        if (elapsed === 2) {
            el.style.transition = 'opacity 0.5s ease, font-size 0.8s cubic-bezier(0.4,0,0.2,1), top 0.8s cubic-bezier(0.4,0,0.2,1), left 0.8s cubic-bezier(0.4,0,0.2,1), transform 0.8s cubic-bezier(0.4,0,0.2,1)';
            el.style.fontSize = '2.5rem';
            el.style.top = 'calc(100vh - 16px)';
            el.style.left = '16px';
            el.style.transform = 'translate(0, -100%)';
        }
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
    { cmd: '/ram',        display: '/ram' },
    { cmd: '/collect',    display: '/collect' },
    { cmd: '/dynamite',   display: '/dynamite' },
    { cmd: '/instamine',  display: '/instamine' },
    { cmd: '/fly',        display: '/fly' },
    { cmd: '/water',      display: '/water' },
    { cmd: '/fps',        display: '/fps' },
    { cmd: '/stopfade',   display: '/stopfade' },
    { cmd: '/fullbright', display: '/fullbright' },
    { cmd: '/inception',  display: '/inception' },
    { cmd: '/ptp',        display: '/ptp' },
    { cmd: '/kill',       display: '/kill' },
    { cmd: '/notimer',    display: '/notimer' },
    { cmd: '/re',         display: '/re' },
    { cmd: '/sc',         display: '/sc' },
    { cmd: '/tpr',        display: '/tpr' },
    { cmd: '/tskip',      display: '/tskip' },
    { cmd: '/vox',        display: '/vox' },
    { cmd: '/xray',       display: '/xray' },
    { cmd: '/give',       display: '/give <block> <count>',  multi: true },
    { cmd: '/spawn',      display: '/spawn <creature>',      multi: true },
    { cmd: '/speed',      display: '/speed <multiplier>',    multi: true },
    { cmd: '/tp',         display: '/tp <x> <y> <z>',       multi: true },
    { cmd: '/warp',       display: '/warp <dimension>',      multi: true },
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

        // Dimension chips for /warp
        if (activeMulti.cmd === '/warp') {
            const WARP_DIMS = ['earth', 'moon', 'water'];
            const typed = raw.slice(activeMulti.cmd.length + 1).toLowerCase().trim();
            const matches = WARP_DIMS.filter(d => d.startsWith(typed) && d !== typed);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
            for (const dim of (matches.length ? matches : WARP_DIMS)) {
                row.appendChild(makeChip(dim, () => {
                    cmdInput.value = '/warp ' + dim;
                    cmdInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }));
            }
            cmdRecsEl.appendChild(row);
        }

        // Creature chips for /spawn
        if (activeMulti.cmd === '/spawn') {
            const typed = raw.slice(activeMulti.cmd.length + 1).toLowerCase().trim();
            const matches = Object.keys(CREATURE_BY_NAME).filter(n => n.startsWith(typed) && n !== typed);
            const list = matches.length > 0 ? matches : Object.keys(CREATURE_BY_NAME);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
            for (const name of list) {
                row.appendChild(makeChip(name, () => {
                    cmdInput.value = '/spawn ' + name;
                    cmdInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }));
            }
            cmdRecsEl.appendChild(row);
        }

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
        
        if (cmd === '/ram') {
            const info = renderer.info;
            const lines = [
                `chunks: ${loadedChunks.size}  build queue: ${buildQueue.length}  pending: ${pendingChunks.size}`,
                `entities: ${slimes.length} slimes  ${wraithLeviathans.length} wraiths  ${gravestones.length} gravestones`,
                `drops: ${drops.length}`,
                `draw calls: ${info.render.calls}  triangles: ${(info.render.triangles / 1000).toFixed(1)}k`,
                `geometries: ${info.memory.geometries}  textures: ${info.memory.textures}`,
            ];
            const prev = cmdFeedback.textContent;
            cmdFeedback.innerHTML = lines.join('<br>');
            cmdFeedback.style.opacity = '1';
            setTimeout(() => {
                cmdFeedback.style.opacity = '0';
                setTimeout(() => { cmdFeedback.textContent = ''; }, 300);
            }, 5000);
        } else if (cmd === '/collect') {
            const count = drops.length;
            for (let i = drops.length - 1; i >= 0; i--) {
                addToInventory(drops[i].type);
                scene.remove(drops[i].mesh);
            }
            drops.length = 0;
            showFeedback(count > 0 ? `collected ${count} drop${count !== 1 ? 's' : ''}` : 'no drops to collect');
        } else if (cmd === '/dynamite') {
            dynamiteMode = !dynamiteMode;
            showFeedback(`dynamite ${dynamiteMode ? 'on' : 'off'}`);
        } else if (cmd === '/instamine') {
            instamineMode = !instamineMode;
            showFeedback(`instamine ${instamineMode ? 'on' : 'off'}`);
        } else if (cmd === '/fps') {
            fpsMode = !fpsMode;
            showFps = fpsMode;
            fpsToggle.updateBtn();
            showFeedback(`fps counter ${fpsMode ? 'on' : 'off'}`);
        } else if (cmd === '/stopfade') {
            stopFade = !stopFade;
            ultimateUniforms.uStopFade.value = stopFade ? 1.0 : 0.0;
            updateStopFadeBtn();
            showFeedback(`stop fade ${stopFade ? 'on' : 'off'}`);
        } else if (cmd === '/inception') {
            inceptionMode = !inceptionMode;
            updateInceptionBtn();
            showFeedback(`inception mode ${inceptionMode ? 'on' : 'off'}`);
        } else if (cmd.startsWith('/warp ')) {
            const dim = cmd.slice(6).trim();
            if (isTransitioning) {
                showFeedback('already transitioning');
            } else if (dim === 'earth') {
                if (world.dimension === DIM_EARTH) {
                    showFeedback('already on earth');
                } else {
                    showFeedback('warping to earth...');
                    pixelTransition(() => {
                        world.dimension = DIM_EARTH;
                        broadcastWorkers({ type: 'setDimension', dim: DIM_EARTH });
                        curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
                        ultimateUniforms.uIsMoon.value = 0.0;
                        ultimateUniforms.uIsFates.value = 0.0;
                        setTerrainFog(false);
                        for (const entry of loadedChunks.values()) {
                            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
                        }
                        loadedChunks.clear();
                        markLodMaskDirty();
                        buildQueue.length = 0;
                        pendingChunks.clear();
                        pendingMiningChunks.clear();
                        player.pos.set(8, 184, 8);
                        player.vel.set(0, 0, 0);
                        isFlying = false;
                    });
                }
            } else if (dim === 'moon') {
                if (world.dimension === DIM_MOON) {
                    showFeedback('already on moon');
                } else {
                    showFeedback('warping to moon...');
                    pixelTransition(() => {
                        world.dimension = DIM_MOON;
                        broadcastWorkers({ type: 'setDimension', dim: DIM_MOON });
                        curveUniforms.uPlanetRadius.value = MOON_PLANET_RADIUS;
                        ultimateUniforms.uIsMoon.value = 1.0;
                        ultimateUniforms.uIsFates.value = 0.0;
                        setTerrainFog(false);
                        for (const entry of loadedChunks.values()) {
                            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
                        }
                        loadedChunks.clear();
                        markLodMaskDirty();
                        buildQueue.length = 0;
                        pendingChunks.clear();
                        pendingMiningChunks.clear();
                        const tx = 8, tz = 8;
                        player.pos.set(tx, world.surfaceAt(tx, tz) + 50, tz);
                        player.vel.set(0, -5, 0);
                    });
                }
            } else if (dim === 'water') {
                if (world.dimension === DIM_WATER) {
                    showFeedback('already in water dimension');
                } else {
                    showFeedback('warping to water...');
                    pixelTransition(() => {
                        world.dimension = DIM_WATER;
                        broadcastWorkers({ type: 'setDimension', dim: DIM_WATER });
                        curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
                        ultimateUniforms.uIsMoon.value = 0.0;
                        ultimateUniforms.uIsFates.value = 0.0;
                        setTerrainFog(false);
                        for (const entry of loadedChunks.values()) {
                            for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
                        }
                        loadedChunks.clear();
                        markLodMaskDirty();
                        buildQueue.length = 0;
                        pendingChunks.clear();
                        pendingMiningChunks.clear();
                        player.pos.set(8, 32, 8);
                        player.vel.set(0, -5, 0);
                    });
                }
            } else {
                showFeedback('unknown dimension — try: earth, moon, water');
            }
        } else if (cmd === '/water') {
            if (!isTransitioning) {
                if (world.dimension === DIM_WATER) {
                    showFeedback('already in water dimension');
                } else {
                    startWaterTransition();
                    showFeedback('teleporting to water dimension...');
                }
            }
        } else if (cmd === '/notimer') {
            fatesNoTimer = !fatesNoTimer;
            if (fatesCountdownEl) fatesCountdownEl.style.opacity = fatesNoTimer ? '0' : '1';
            showFeedback(fatesNoTimer ? 'fates timer disabled' : 'fates timer enabled');
        } else if (cmd === '/kill') {
            damagePlayer(getPlayerHealth());
        } else if (cmd === '/re') {
            if (world.dimension !== DIM_EARTH) {
                world.dimension = DIM_EARTH;
                broadcastWorkers({ type: 'setDimension', dim: DIM_EARTH });
                curveUniforms.uPlanetRadius.value = EARTH_PLANET_RADIUS;
                ultimateUniforms.uIsMoon.value = 0.0;
                ultimateUniforms.uIsFates.value = 0.0;
                setTerrainFog(false);
                for (const entry of loadedChunks.values()) {
                    for (const m of entry.meshes) { scene.remove(m); m.geometry.dispose(); }
                }
                loadedChunks.clear();
                markLodMaskDirty();
                buildQueue.length = 0;
                pendingChunks.clear();
                pendingMiningChunks.clear();
            }
            player.pos.set(8, 184, 8);
            player.vel.set(0, 0, 0);
            isFlying = false;
            camera.position.copy(player.getEyePosition());
            camera.rotation.copy(player.getCameraRotation());
            showFeedback('respawned');
        } else if (cmd === '/sc') {
            scOpen = true;
            document.exitPointerLock();
            scOverlay.style.display = 'flex';
        } else if (cmd === '/fly') {
            flyMode = !flyMode;
            if (!flyMode) isFlying = false;
            updateFlyBtn();
            showFeedback(`fly mode ${flyMode ? 'on' : 'off'}`);
        } else if (cmd === '/allday') {
            window._wraithIgnoreDay = !window._wraithIgnoreDay;
            setWraithIgnoreDay(!!window._wraithIgnoreDay);
            showFeedback(`wraith day despawn ${window._wraithIgnoreDay ? 'disabled' : 'enabled'}`);
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
            broadcastWorkers({ type: 'setVoxelMode', voxelMode });
            setCollisionMode(voxelMode);
            showFeedback(`voxel mode ${voxelMode ? 'on' : 'off'}`);
            for (const key of Array.from(loadedChunks.keys())) {
                const [cx, cy, cz] = key.split(',').map(Number);
                const entry = loadedChunks.get(key);
                rebuildChunk(cx, cy, cz, entry ? entry.lod : 1);
            }
        } else if (cmd === '/xray') {
            xrayMode = !xrayMode;
            broadcastWorkers({ type: 'setXray', xrayMode });
            for (const key of Array.from(loadedChunks.keys())) {
                const [cx, cy, cz] = key.split(',').map(Number);
                const entry = loadedChunks.get(key);
                rebuildChunk(cx, cy, cz, entry ? entry.lod : 1);
            }
            showFeedback(`xray ${xrayMode ? 'on' : 'off'}`);
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
                speedInput.value = String(val);
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
        } else if (cmd.startsWith('/spawn ')) {
            const name = cmd.slice(7).trim();
            if (!CREATURE_BY_NAME[name]) {
                showFeedback(`unknown creature: ${name} — try: ${Object.keys(CREATURE_BY_NAME).join(', ')}`);
            } else if (name === 'wraith') {
                if (spawnWraithLeviathan()) showFeedback('spawned wraith');
                else showFeedback('wraith model not loaded yet');
            } else {
                spawnCreatureAt(name, player.pos.x, player.pos.y, player.pos.z);
                showFeedback(`spawned ${name}`);
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

    broadcastWorkers({ type: 'setVoxel', x, y, z, v: type });
    updateAffectedChunks(x, y, z);
    world.updateLightAt(x, y, z);
    if (type === WORKBENCH) spawnWorkbenchAt(x, y, z);
    worldDeltas.set(`${x},${y},${z}`, type);
    if (net.connected) net.sendBlockChange(x, y, z, type);
    return true;
}

function mineBlock(x, y, z) {
    const type = world.get(x, y, z);
    if (type === WORKBENCH) removeWorkbenchAt(x, y, z);
    world.set(x, y, z, 0); // clear before spawning drop so it lands in air
    world.updateLightAt(x, y, z);
    broadcastWorkers({ type: 'setVoxel', x, y, z, v: 0 });
    worldDeltas.set(`${x},${y},${z}`, 0);
    if (net.connected) net.sendBlockChange(x, y, z, 0);
    if (type !== 0) {
        spawnDrop(type, x, y, z);
        if (type === DIRT) {
            const held = inventory[selectedSlot];
            if (held?.type === WOODCHIP && (held?.count ?? 0) > 0 && Math.random() < 0.75) {
                spawnDrop(FLINT, x, y, z);
            }
        }
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

function rebuildChunkMining(cx, cy, cz, lod = 1) {
    const key = chunkKey(cx, cy, cz);
    if (mainThreadMesh) {
        for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
            world.get((cx + dx) * CHUNK, (cy + dy) * CHUNK, (cz + dz) * CHUNK);
        const results = buildChunkMesh(world, cx, cy, cz, fullbright, lod, voxelMode, useGaussian, supercomputerMode, xrayMode);
        applyMeshResults(cx, cy, cz, lod, results);
        pendingMiningChunks.delete(key);
    } else {
        miningWorker.postMessage({ type: 'buildMesh', cx, cy, cz, lod, fullbright });
        pendingMiningChunks.set(key, lod);
    }
}

function updateAffectedChunks(x, y, z) {
    for (const [cx, cy, cz] of world.affectedChunks(x, y, z)) {
        const entry = loadedChunks.get(chunkKey(cx, cy, cz));
        if (entry) rebuildChunkMining(cx, cy, cz, entry.lod);
    }
}


// ── Slime System ─────────────────────────────────────────────────────────────
initSlimes(scene, world, player, camera, showFeedback, applyPlanetCurve, curveDepthMat);

// ── Wraith Leviathan System ───────────────────────────────────────────────────
initWraithLeviathans(scene, world, player, camera, applyPlanetCurve, curveDepthMat);
CREATURE_BY_NAME['wraith'] = true;

// ── Gravestone System ─────────────────────────────────────────────────────────
initGravestones(scene, world, input, spawnDrop, shake);

// ── Health + Vignette + Death ──────────────────────────────────────────────────
initHealth({
    player,
    getIsFlying: () => isFlying,
    setIsFlying: (v) => { isFlying = v; },
    getSlimes: () => slimes,
    placeGravestone,
    inventory,
    mainInventory,
    getSelectedSlot: () => selectedSlot,
    setSelectedSlot: (v) => { selectedSlot = v; },
    updateInventoryUI,
    shake,
    onRebirth: () => {
        fatesVisitCount++;
        if (fatesFirstEntry) {
            fatesFirstEntry = false;
            startFatesIntro(() => startFatesTransition());
        } else if (fatesVisitCount === 2) {
            startFatesIntro(() => startFatesTransition(), FATES_DIALOGUE_RETURN);
        } else {
            startFatesTransition();
        }
    },
});

// ── Gameplay ──────────────────────────────────────────────────────────────────

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt  = Math.min((now - last) / 1000, 0.05);
    last = now;

    updatePixelEffect(dt);

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

    if (fpsMode || showFps) {
        fpsDisplay.style.display = '';
        fpsDisplay.textContent = `fps ${Math.round(1 / dt)}`;
    } else {
        fpsDisplay.style.display = 'none';
    }
    if (showXyz && player && player.pos) {
        xyzDisplay.textContent = `x ${player.pos.x.toFixed(1)}  y ${player.pos.y.toFixed(1)}  z ${player.pos.z.toFixed(1)}`;
    }

    updateParticles(dt);
    updateDrops(dt);
    updateSlimes(dt);
    updateWraithLeviathans(dt, dayIntensity);
    updateHealth(dt);
    updateVignette(dt);
    updateDeathSequence(dt);
    updateDialogue(dt);

    // ── Atmosphere & Space Transitions ────────────────────────────────────────
    // We move this above the early return so the sky/terrain updates even if input isn't locked
    const biome = world.getBiomeAt(player.pos.x, player.pos.z);
    let biomeSky = forestSkyColor;
    if (biome === BIOME_DESERT) biomeSky = desertSkyColor;
    else if (biome === BIOME_TUNDRA) biomeSky = tundraSkyColor;

    if (showBiome) {
        const biomeNames = { [BIOME_FOREST]: 'Forest', [BIOME_DESERT]: 'Desert', [BIOME_TUNDRA]: 'Tundra' };
        biomeDisplay.textContent = `biome  ${biomeNames[biome] ?? 'Unknown'}`;
    }
    if (showSpeed) {
        const hspd = Math.sqrt(player.vel.x ** 2 + player.vel.z ** 2);
        speedDisplay.textContent = `speed  ${hspd.toFixed(1)} m/s`;
    }

    const isMoon  = world.dimension === DIM_MOON;
    const isWater = world.dimension === DIM_WATER;
    const isFates = world.dimension === DIM_FATES;

    // Darken biome sky based on sun position
    if (isWater) {
        currentSkyColor.lerp(waterSkyColor, dt * 4);
    } else if (isFates) {
        currentSkyColor.lerp(fatesSkyColor, dt * 4);
    } else {
        currentSkyColor.lerp(biomeSky, dt * 2);
    }
    tempColor.copy(currentSkyColor).lerp(nightSkyColor, (isWater || isFates) ? 0 : 1 - dayIntensity);

    const height = player.pos.y;

    // Transition starts at cloud height (170) and reaches vacuum by y=430
    const spaceT = (isMoon || isWater || isFates) ? (isMoon ? 1 : 0) : Math.min(Math.max((height - CLOUD_Y) / 260, 0), 1);

    scene.background.lerpColors(tempColor, spaceColor, spaceT);

    // Dawn/dusk: blend a warm orange glow into the sky when the sun is near the horizon
    if (!isMoon && !isWater && !isFates && spaceT < 0.95) {
        const horizonBlend = Math.max(0, 1.0 - Math.abs(sunYMult) * 3.5) * (1 - spaceT);
        scene.background.lerp(dawnDuskColor, horizonBlend * 0.45);
    }

    if (isMoon) {
        scene.background.copy(spaceColor);
        scene.fog.density = 0;
    } else if (isWater) {
        scene.fog.color.copy(scene.background);
        scene.fog.density = 0.012;
    } else if (isFates) {
        scene.background.set(0x5a00aa);
        scene.fog.color.set(0x5a00aa);
        scene.fog.density = 0.04;
        if (ultimateLodMesh) ultimateLodMesh.visible = false;
    } else {
        if (ultimateLodMesh) ultimateLodMesh.visible = true;
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

    // Sun color: warm orange-gold at the horizon, cool white at noon
    const horizonT = Math.max(0, sunYMult); // 0 at horizon, 1 at peak
    sunLight.color.setRGB(1.0, THREE.MathUtils.lerp(0.5, 1.0, horizonT), THREE.MathUtils.lerp(0.2, 0.95, horizonT));
    sunLight.intensity = isMoon ? 1.2 : dayIntensity * 1.2;

    // Moon light: opposite the sun, fades in as sun sets
    const nightIntensity = isMoon ? 0 : Math.max(0, THREE.MathUtils.smoothstep(-sunYMult, -0.2, 0.4));
    moonLight.intensity = nightIntensity * 0.15;

    // Hemisphere sky/ground colors shift with the time of day
    hemiLight.color.setRGB(
        THREE.MathUtils.lerp(0.03, 0.53, dayIntensity),
        THREE.MathUtils.lerp(0.03, 0.81, dayIntensity),
        THREE.MathUtils.lerp(0.15, 0.92, dayIntensity)
    );
    hemiLight.groundColor.setRGB(
        THREE.MathUtils.lerp(0.04, 0.29, dayIntensity),
        THREE.MathUtils.lerp(0.04, 0.23, dayIntensity),
        THREE.MathUtils.lerp(0.04, 0.13, dayIntensity)
    );
    hemiLight.intensity = isMoon ? 0 : (0.08 + 0.3 * dayIntensity);

    // Ambient: cool blue at night, neutral white during the day
    ambientLight.color.setRGB(
        THREE.MathUtils.lerp(0.4, 1.0, dayIntensity),
        THREE.MathUtils.lerp(0.5, 1.0, dayIntensity),
        THREE.MathUtils.lerp(0.9, 1.0, dayIntensity)
    );
    ambientLight.intensity = isMoon ? 0.6 : (0.04 + 0.2 * dayIntensity);

    starSphere.material.opacity = isMoon ? 1 : spaceT;
    starSphere.position.copy(player.pos);

    // ── Terrain Fade ──────────────────────────────────────────────────────────
    // Terrain is opaque at y=500 and fully transparent at y=540.
    // When stopFade is on the detail meshes are forced to 0 opacity so the
    // opaque LOD surface underneath is immediately visible.
    const terrainOpacity = stopFade ? 0 : Math.min(Math.max(1 - (height - 500) / 40, 0), 1);
    for (const [type, m] of Object.entries(MATS)) {
        if (Number(type) === WATER) continue; // water keeps its fixed opacity
        m.opacity = terrainOpacity;
        m.depthWrite = terrainOpacity > 0.5;
    }

    // Planet sphere positions + opacity.
    // Opacity is driven solely by terrainOpacity in DIM_EARTH so the spheres are
    // never culled by any other mechanism — they fade in as terrain fades out.
    if (isWater || isFates) {
        earthSphere.material.opacity = 0;
        cloudSphere.material.opacity = 0;
        atmosphereMat.uniforms.opacity.value = 0;
        moonSphere.material.opacity  = 0;
        moonAtmosMat.uniforms.opacity.value = 0;
    } else if (isMoon) {
        earthSphere.position.set(player.pos.x, 1000, player.pos.z);
        earthSphere.rotation.x = -Math.PI / 2;
        earthSphere.material.opacity = 1;

        cloudSphere.position.set(player.pos.x, 1000, player.pos.z);
        cloudSphere.material.opacity = 1;

        atmosphereSphere.position.set(player.pos.x, 1000, player.pos.z);
        atmosphereSphere.rotation.x = -Math.PI / 2;
        atmosphereMat.uniforms.opacity.value = 1;

        moonSphere.position.set(player.pos.x, -700, player.pos.z);
        moonSphere.rotation.x = Math.PI / 2;
        moonSphere.material.opacity = 0;
        moonAtmosMat.uniforms.opacity.value = 0;

        if (!isTransitioning && player.pos.y > 470) {
            startEarthTransition();
        }
    } else {
        earthSphere.position.x = player.pos.x;
        earthSphere.position.z = player.pos.z;
        earthSphere.material.opacity = 1 - terrainOpacity;

        cloudSphere.position.x = player.pos.x;
        cloudSphere.position.z = player.pos.z;
        cloudSphere.material.opacity = 1 - terrainOpacity;

        atmosphereSphere.position.x = player.pos.x;
        atmosphereSphere.position.z = player.pos.z;
        atmosphereMat.uniforms.opacity.value = 1 - terrainOpacity;

        moonSphere.position.set(500, 3800, 20);
        moonSphere.rotation.x = -Math.PI / 2;
        moonSphere.material.opacity = 1 - terrainOpacity;

        moonAtmosSphere.position.set(500, 3800, 20);
        moonAtmosMat.uniforms.opacity.value = 1 - terrainOpacity;

        if (!isTransitioning && world.dimension === DIM_EARTH && player.pos.distanceTo(moonSphere.position) < 600) {
            startMoonTransition();
        }
    }

        // Planet rotation: fixed axial spin + subtle rolling based on player movement
    earthSphere.rotation.y += dt * 0.05;
    cloudSphere.rotation.y += dt * 0.1;
    if (world.dimension === DIM_EARTH) {
        // Roll in the opposite direction of movement to simulate traversal
        earthSphere.rotation.x -= player.vel.z * dt * 0.0001;
        earthSphere.rotation.z += player.vel.x * dt * 0.0001;
        cloudSphere.rotation.x -= player.vel.z * dt * 0.0002;
        cloudSphere.rotation.z += player.vel.x * dt * 0.0002;
    }
    moonSphere.rotation.y += dt * 0.02;

    const cloudVisible = !isMoon && !isWater && !isFates;
    cloudLayerGroups.forEach(({ group, clouds, baseOpacity, baseY, layerThickness }) => {
        group.position.x = player.pos.x;
        group.position.z = player.pos.z;
        const aboveT = Math.min(Math.max((height - baseY - layerThickness) / 55, 0), 1);
        const layerOpacity = cloudVisible ? baseOpacity * (1 - aboveT) : 0;
        clouds.forEach(mesh => {
            mesh.position.x += dt * mesh.userData.driftX;
            mesh.position.z += dt * mesh.userData.driftZ;
            if (mesh.position.x >  CLOUD_FIELD_R) mesh.position.x -= CLOUD_FIELD_R * 2;
            if (mesh.position.x < -CLOUD_FIELD_R) mesh.position.x += CLOUD_FIELD_R * 2;
            if (mesh.position.z >  CLOUD_FIELD_R) mesh.position.z -= CLOUD_FIELD_R * 2;
            if (mesh.position.z < -CLOUD_FIELD_R) mesh.position.z += CLOUD_FIELD_R * 2;
            mesh.visible = cloudVisible;
            mesh.material.opacity = layerOpacity;
        });
    });

    // Advance Gerstner wave time
    waterUniforms.uTime.value += dt;

    if (gameActive) {
        updateChunkStream();
        processBuildQueue(3);
    }

    if (!gameActive) {
        overlay.style.display = 'none';
        renderer.render(scene, camera);
        return;
    }

    if (isLoadCinematic) {
        overlay.style.display = 'none';
        camera.position.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
        camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        renderer.render(scene, camera);
        return;
    }

    if (getIsDead()) {
        renderer.render(scene, camera);
        return;
    }

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
        if (input.checkDoubleJump()) {
            isFlying = !isFlying;
            if (isFlying) showFeedback('flying');
            else showFeedback('landed');
        }
    }

    // ── Apply flight movement before player update ────────────────────────────
    if (isFlying) {
        const flySpeed = 20 * speedMultiplier;
        if (input.isFlyUp()) player.vel.y = flySpeed;
        else if (input.isFlyDown()) player.vel.y = -flySpeed;
        else player.vel.y = 0;
    }

    // Detect water: player is "in water" when any voxel from feet to chest is WATER
    const _px = Math.floor(player.pos.x), _pz = Math.floor(player.pos.z);
    const inWater = !isFlying && (
        world.get(_px, Math.floor(player.pos.y + 0.1),  _pz) === WATER ||
        world.get(_px, Math.floor(player.pos.y + 0.9),  _pz) === WATER
    );

    player.update(dt, input, isFlying, inceptionMode, speedMultiplier, inWater);

    if (net.connected) {
        net.tickPositionBroadcast(dt, player.pos, player.yaw, player.pitch);
        updateRemotePlayers(dt);
    }

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
        if (thirdPerson) {
            const targetY = player.pos.y + EYE_HEIGHT * 0.7;
            _camTarget.set(player.pos.x, targetY, player.pos.z);
            const idealDist = 5;

            // Compute direction from player to ideal camera position
            _camDir.set(
                Math.sin(player.yaw) * Math.cos(player.pitch),
                -Math.sin(player.pitch),
                Math.cos(player.yaw) * Math.cos(player.pitch)
            );

            // Check for voxel obstructions along the camera path
            const hit = raycastVoxel(world, _camTarget, _camDir, idealDist);
            let camDist = idealDist;

            if (hit) {
                // If obstructed, clamp distance to just before the block
                _camHit.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
                camDist = Math.max(0.4, _camTarget.distanceTo(_camHit) - 0.8);
            }

            camera.position.set(
                _camTarget.x + _camDir.x * camDist,
                _camTarget.y + _camDir.y * camDist,
                _camTarget.z + _camDir.z * camDist
            );
            camera.lookAt(player.pos.x, targetY, player.pos.z);
        } else {
            camera.position.copy(player.getEyePosition());
            camera.rotation.copy(player.getCameraRotation());
        }

        if (localModel) {
            for (const m of localModel.meshes) {
                if (thirdPerson) m.layers.enable(0); else m.layers.disable(0);
            }
            localModel.scene.position.set(player.pos.x, player.pos.y, player.pos.z);
            localModel.scene.rotation.y = player.yaw + Math.PI / 2;
            _animateModel(localModel, horizontalSpeed, dt, player.pitch);
        }

        curveUniforms.uCamXZ.value.set(camera.position.x, camera.position.z);
        ultimateUniforms.uCenterCX.value = Math.floor(player.pos.x / CHUNK);
        ultimateUniforms.uCenterCZ.value = Math.floor(player.pos.z / CHUNK);
        updateLodMask();


        // Move the sun relative to the player
        const sunDist = 150;
        const sx = Math.cos(sunAngle) * sunDist; // Shadows will shift directionally
        const sy = Math.sin(sunAngle) * sunDist; // Sun sets/rises
        sunLight.position.set(player.pos.x + sx, player.pos.y + sy, player.pos.z + 50);
        sunLight.target.position.set(player.pos.x, player.pos.y, player.pos.z);

        // Moon light: opposite the sun in the sky
        moonLight.position.set(player.pos.x - sx, player.pos.y - sy, player.pos.z - 50);
        moonLight.target.position.set(player.pos.x, player.pos.y, player.pos.z);
    }

    // Punch slime check — intercepts click before block mining
    if (!getIsDead() && input.peekClick() && tryPunchSlime()) input.flushClick();

    // Mining
    camera.getWorldDirection(rayDir);

    // Gravestone mining takes priority over voxel mining
    const graveConsumed = updateGraveMining(dt, camera.position, rayDir);

    let hit = graveConsumed ? null : raycastVoxel(world, camera.position, rayDir, 12);

    // Magnet targeting: if the voxel DDA missed but a chunk mesh was hit,
    // step just inside the surface to find the nearest solid voxel.
    if (!hit) {
        _meshRaycaster.set(camera.position, rayDir);
        const chunkMeshes = [];
        for (const entry of loadedChunks.values()) {
            for (const m of entry.meshes) chunkMeshes.push(m);
        }
        const meshIntersects = _meshRaycaster.intersectObjects(chunkMeshes, false);
        if (meshIntersects.length > 0) {
            const ix = meshIntersects[0];
            // Step a small epsilon inside the surface to land in the solid voxel
            const px = ix.point.x + rayDir.x * 0.01;
            const py = ix.point.y + rayDir.y * 0.01;
            const pz = ix.point.z + rayDir.z * 0.01;
            const vx = Math.floor(px), vy = Math.floor(py), vz = Math.floor(pz);
            if (world.get(vx, vy, vz)) {
                // Snap the mesh face normal to the nearest axis for block placement
                _magnetNormal.copy(ix.face.normal).transformDirection(ix.object.matrixWorld);
                const ax = Math.abs(_magnetNormal.x), ay = Math.abs(_magnetNormal.y), az = Math.abs(_magnetNormal.z);
                let fn;
                if (ax >= ay && ax >= az)      fn = [Math.sign(_magnetNormal.x)|0, 0, 0];
                else if (ay >= ax && ay >= az) fn = [0, Math.sign(_magnetNormal.y)|0, 0];
                else                           fn = [0, 0, Math.sign(_magnetNormal.z)|0];
                hit = { x: vx, y: vy, z: vz, face: fn };
            }
        }
    }

    if (hit) {
        highlightMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        highlightMesh.visible = true;

        if (hit.face && input.flushSecondaryClick()) {
            const item = inventory[selectedSlot];
            if (item && item.count > 0 && !TOOL_TYPES.has(item.type)) {
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
        const heldItem = inventory[selectedSlot];
        const hasChip       = heldItem?.type === WOODCHIP   && (heldItem?.count ?? 0) > 0;
        const hasPick       = heldItem?.type === WOODPICK   && (heldItem?.count ?? 0) > 0;
        const hasStonePick  = heldItem?.type === STONEPICK  && (heldItem?.count ?? 0) > 0;
        const breakTime = hasChip && WOODCHIP_BREAK_TIMES[blockType] !== undefined
            ? WOODCHIP_BREAK_TIMES[blockType]
            : hasStonePick && STONEPICK_BREAK_TIMES[blockType] !== undefined
            ? STONEPICK_BREAK_TIMES[blockType]
            : hasPick && WOODPICK_BREAK_TIMES[blockType] !== undefined
            ? WOODPICK_BREAK_TIMES[blockType]
            : (BREAK_TIMES[blockType] ?? Infinity);

        if (input.flushClick() || input.mouseHeld || input.isMining()) {
            if (breakTime === Infinity) {
                // Block is not minable with current tool
                miningProgress = 0;
            } else {
                isBreaking = true;
                if (hasPick || hasStonePick) pickaxeBreaking = true;
                if (breakTime === 0 || dynamiteMode || instamineMode) {
                    performBreak(hit);
                } else {
                    miningProgress += dt;
                    shake.amount = Math.min(breakTime / 3.0, 1.0) * 0.022;
                    shake.time += dt;
                    miningParticleTimer -= dt;
                    if (miningParticleTimer <= 0) {
                        const fx = hit.face ? hit.face[0] : 0;
                        const fy = hit.face ? hit.face[1] : 0;
                        const fz = hit.face ? hit.face[2] : 0;
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
            const newIsWorkbench = newType === WORKBENCH;
            const newIsWoodchip  = newType === WOODCHIP;
            const newIsFlint     = newType === FLINT;
            const newIsStick     = newType === STICK;
            const newIsWoodpick   = newType === WOODPICK;
            const newIsStonepick  = newType === STONEPICK;
            const newIsGlb = newIsWorkbench || newIsWoodchip || newIsFlint || newIsStick || newIsWoodpick || newIsStonepick;
            heldMesh.material = getHudMat(newType > 0 ? newType : 1);
            heldMesh.visible = newHasItem && !newIsGlb;
            heldWorkbenchGroup.visible  = newHasItem && newIsWorkbench;
            heldWoodchipGroup.visible   = newHasItem && newIsWoodchip;
            heldFlintGroup.visible      = newHasItem && newIsFlint;
            heldStickGroup.visible      = newHasItem && newIsStick;
            heldWoodpickGroup.visible   = newHasItem && newIsWoodpick;
            heldStonepickGroup.visible  = newHasItem && newIsStonepick;
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
            const isWorkbench = polledType === WORKBENCH;
            const isWoodchip  = polledType === WOODCHIP;
            const isFlint     = polledType === FLINT;
            const isStick     = polledType === STICK;
            const isWoodpick   = polledType === WOODPICK;
            const isStonepick  = polledType === STONEPICK;
            const isGlb = isWorkbench || isWoodchip || isFlint || isStick || isWoodpick || isStonepick;
            if (polledType !== lastHeldType) {
                heldMesh.material = getHudMat(polledType > 0 ? polledType : 1);
                lastHeldType = polledType;
            }
            heldMesh.visible = hasItem && !isGlb;
            heldWorkbenchGroup.visible  = hasItem && isWorkbench;
            heldWoodchipGroup.visible   = hasItem && isWoodchip;
            heldFlintGroup.visible      = hasItem && isFlint;
            heldStickGroup.visible      = hasItem && isStick;
            heldWoodpickGroup.visible   = hasItem && isWoodpick;
            heldStonepickGroup.visible  = hasItem && isStonepick;
        }
    }

    // ── Pickaxe swing animation ───────────────────────────────────────────────
    if (pickaxeBreaking) {
        pickaxeSwingTime += dt;
    } else {
        pickaxeSwingTime *= Math.pow(0.0001, dt); // fast decay to rest when not mining
    }
    pickaxeBreaking = false;

    // Rotate around the bottom pivot: sweep forward on each strike
    const _pickAngle = Math.abs(Math.sin(pickaxeSwingTime * Math.PI * 2.8)) * (Math.PI * 0.36);
    heldWoodpickGroup.rotation.x  = -0.3 - _pickAngle;
    heldStonepickGroup.rotation.x = -0.3 - _pickAngle;

    // Every frame: swap hand models based on breaking state; reset flag for next frame
    const handHasItem = heldMesh.visible || heldWorkbenchGroup.visible || heldWoodchipGroup.visible || heldFlintGroup.visible || heldStickGroup.visible || heldWoodpickGroup.visible || heldStonepickGroup.visible;
    handGroup.visible = !handHasItem && !isBreaking;
    handBreakGroup.visible = !handHasItem && isBreaking;
    isBreaking = false;

    // Breaking swing: accumulate time while swinging, reset when idle
    if (handBreakGroup.visible || (handHasItem && breakSwingTime > 0)) {
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
    heldWorkbenchGroup.position.set(hudPosX, hudPosY, hudPosZ);
    heldWoodchipGroup.position.set(hudPosX, hudPosY, hudPosZ);
    heldFlintGroup.position.set(hudPosX, hudPosY, hudPosZ);
    heldStickGroup.position.set(hudPosX, hudPosY, hudPosZ);
    heldWoodpickGroup.position.set(hudPosX, hudPosY - 2.2, hudPosZ + 1.0);
    heldStonepickGroup.position.set(hudPosX, hudPosY - 2.2, hudPosZ + 1.0);
    handGroup.position.set(hudPosX, hudPosY, hudPosZ);
    handBreakGroup.position.set(hudPosX, hudPosY, hudPosZ);

    // Screen shake: decay and apply oscillation offset to camera
    shake.amount *= Math.pow(0.001, dt);
    const _sRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const _sUp    = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const sx = Math.sin(shake.time * 47.3) * shake.amount;
    const sy = Math.sin(shake.time * 31.7 + 1.4) * shake.amount;
    camera.position.addScaledVector(_sRight, sx);
    camera.position.addScaledVector(_sUp, sy);
    camera.updateMatrixWorld();

    renderer.render(scene, camera);

    // Undo shake offset so player position stays clean
    camera.position.addScaledVector(_sRight, -sx);
    camera.position.addScaledVector(_sUp, -sy);
    camera.updateMatrixWorld();

    // Render the HUD cube on top without clearing the colour buffer
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(hudScene, hudCamera);
    renderer.autoClear = true;
}

// ── Multiplayer ───────────────────────────────────────────────────────────────

const remoteLabelsEl = document.createElement('div');
remoteLabelsEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:500;';
document.body.appendChild(remoteLabelsEl);

const _rpScreen = new THREE.Vector3();

// ── Player model ──────────────────────────────────────────────────────────────

new GLTFLoader().load('assets/models/player1.glb', gltf => {
    playerModelTemplate = gltf.scene;
    playerModelTemplate.traverse(o => { if (o.isMesh) o.castShadow = true; });
    localModel = _makePlayerModel();
    // Layer 2: visible to shadow cameras always, hidden from main camera in first person
    localModel.scene.traverse(o => { if (o.isMesh) o.layers.enable(2); });
    sunLight.shadow.camera.layers.enable(2);
    moonLight.shadow.camera.layers.enable(2);
    scene.add(localModel.scene);
});

function _makePlayerModel() {
    const root   = playerModelTemplate.clone(true);
    root.scale.setScalar(0.75);
    const meshes = [];
    root.traverse(o => { if (o.isMesh) meshes.push(o); });
    return {
        scene:     root,
        meshes,
        head:      root.getObjectByName('head'),
        rightArm:  root.getObjectByName('right_arm'),
        leftArm:   root.getObjectByName('left_arm'),
        rightLeg:  root.getObjectByName('right_leg'),
        leftLeg:   root.getObjectByName('left_leg'),
        walkCycle: 0,
    };
}

function _animateModel(pm, speed, dt, pitch = 0) {
    pm.walkCycle += dt * 10;
    const amp = Math.min(speed * 0.06, 0.55);
    const s = Math.sin(pm.walkCycle) * amp;
    if (pm.rightArm) pm.rightArm.rotation.z = Math.PI - s;
    if (pm.leftArm)  pm.leftArm.rotation.z  = -s;
    if (pm.rightLeg) pm.rightLeg.rotation.z = -s;
    if (pm.leftLeg)  pm.leftLeg.rotation.z  =  s;
    if (pm.head)     pm.head.rotation.z     =  pitch;
}

function addRemotePlayer(id, username) {
    if (remotePlayers.has(id)) return;

    const model = playerModelTemplate ? _makePlayerModel() : null;
    if (model) scene.add(model.scene);

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'position:fixed;font-family:monospace;font-size:12px;color:#fff;background:rgba(0,0,0,0.6);padding:2px 7px;border-radius:4px;transform:translateX(-50%);white-space:nowrap;pointer-events:none;';
    labelEl.textContent = username;
    remoteLabelsEl.appendChild(labelEl);

    remotePlayers.set(id, {
        model, labelEl,
        pos:       new THREE.Vector3(8, 184, 8),
        targetPos: new THREE.Vector3(8, 184, 8),
        yaw: 0,
        pitch: 0,
    });
}

function removeRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    if (rp.model) {
        scene.remove(rp.model.scene);
        rp.model.scene.traverse(o => {
            if (o.isMesh) { o.geometry.dispose(); if (o.material) o.material.dispose(); }
        });
    }
    rp.labelEl.remove();
    remotePlayers.delete(id);
}

function updateRemotePlayers(dt) {
    for (const rp of remotePlayers.values()) {
        const prevX = rp.pos.x, prevZ = rp.pos.z;
        rp.pos.lerp(rp.targetPos, Math.min(dt * 15, 1));
        const speed = Math.sqrt((rp.pos.x - prevX) ** 2 + (rp.pos.z - prevZ) ** 2) / dt;
        rp.pitch = THREE.MathUtils.lerp(rp.pitch || 0, rp.targetPitch || 0, Math.min(dt * 15, 1));

        if (rp.model) {
            rp.model.scene.position.set(rp.pos.x, rp.pos.y, rp.pos.z);
            rp.model.scene.rotation.y = rp.yaw + Math.PI / 2;
            _animateModel(rp.model, speed, dt, rp.pitch);
        }

        _rpScreen.set(rp.pos.x, rp.pos.y + 2.1, rp.pos.z);
        _rpScreen.project(camera);

        if (_rpScreen.z < 1 && Math.abs(_rpScreen.x) < 1.1 && Math.abs(_rpScreen.y) < 1.1) {
            const sx = (_rpScreen.x *  0.5 + 0.5) * window.innerWidth;
            const sy = (_rpScreen.y * -0.5 + 0.5) * window.innerHeight;
            rp.labelEl.style.display = '';
            rp.labelEl.style.left = sx + 'px';
            rp.labelEl.style.top  = (sy - 4) + 'px';
        } else {
            rp.labelEl.style.display = 'none';
        }
    }
}

// ── Network callbacks ─────────────────────────────────────────────────────────

net.onPlayerJoin = (id, username) => addRemotePlayer(id, username);

net.onPlayerLeave = (id) => removeRemotePlayer(id);

net.onPlayerMove = (id, pos, yaw, pitch) => {
    const rp = remotePlayers.get(id);
    if (rp) {
        rp.targetPos.set(pos.x, pos.y, pos.z);
        rp.yaw = yaw;
        rp.targetPitch = pitch;
    }
};

net.onBlockChange = (x, y, z, v) => {
    if (v === WORKBENCH) spawnWorkbenchAt(x, y, z);
    else if (v === 0 && world.get(x, y, z) === WORKBENCH) removeWorkbenchAt(x, y, z);
    world.set(x, y, z, v);
    world.updateLightAt(x, y, z);
    broadcastWorkers({ type: 'setVoxel', x, y, z, v });
    worldDeltas.set(`${x},${y},${z}`, v);
    updateAffectedChunks(x, y, z);
};

net.onWorldState = (data) => {
    const { seeds, deltas, gameTime: gt, players } = data;

    // Clear any remote players that arrived before world_state
    for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id);

    world.reset();
    _clearWorld();
    const { bSeedX: sx, bSeedZ: sz, bOffset: inv, mSeedX: mx, mSeedZ: mz } = seeds;
    syncBiomeParams(sx, sz, inv, mx, mz);
    broadcastWorkers({ type: 'resetWorld' });
    broadcastWorkers({ type: 'initBiome', sx, sz, inv, mx, mz });
    broadcastWorkers({ type: 'setDimension', dim: DIM_EARTH });
    world.dimension = DIM_EARTH;
    if (gt !== undefined) gameTime = gt;

    worldDeltas.clear();
    for (const { x, y, z, v } of (deltas ?? [])) {
        world.set(x, y, z, v);
        worldDeltas.set(`${x},${y},${z}`, v);
    }
    for (const { x, y, z, v } of (deltas ?? [])) {
        broadcastWorkers({ type: 'setVoxel', x, y, z, v });
    }

    for (const p of (players ?? [])) {
        addRemotePlayer(p.id, p.username);
        if (p.pos) {
            const rp = remotePlayers.get(p.id);
            if (rp) { rp.pos.set(p.pos.x, p.pos.y, p.pos.z); rp.targetPos.copy(rp.pos); }
        }
    }

    _resetPlayerState();
    gameActive = true;
    mainMenuEl.style.display = 'none';
    renderer.domElement.requestPointerLock();
};

net.onHostLeft = () => {
    showFeedback('Host disconnected');
    for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id);
    isLanOpen = false;
    net.disconnect();
};

net.onError = (msg) => {
    showFeedback(msg || 'Server error');
    net.disconnect();
};

// ── Shared input style ────────────────────────────────────────────────────────
const _mpInStyle = 'font-family:monospace;font-size:13px;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.55);color:#fff;outline:none;width:100%;box-sizing:border-box;';

function _mpInput(placeholder, maxLen = 40) {
    const el = document.createElement('input');
    el.type = 'text'; el.placeholder = placeholder; el.maxLength = maxLen;
    el.style.cssText = _mpInStyle;
    el.addEventListener('click', e => e.stopPropagation());
    el.addEventListener('keydown', e => e.stopPropagation());
    return el;
}

// ── Open to LAN modal ─────────────────────────────────────────────────────────
const lanOverlay = _modalOverlay(5200);
const lanBox     = _modalBox();
lanBox.style.minWidth = '320px';
lanOverlay.appendChild(lanBox);
lanBox.appendChild(_modalTitle('Open to LAN'));

// Form state
const lanFormDiv    = document.createElement('div');
lanFormDiv.style.cssText = 'display:contents;';
const lanUserInput  = _mpInput('Your username...', 20);
const lanWorldInput = _mpInput('World name...', 40);
const lanHint       = document.createElement('div');
lanHint.style.cssText  = 'font-size:11px;color:#777;line-height:1.5;';
lanHint.textContent    = 'Friends can join from anywhere using the room code.';
const lanConfirmBtn = _btn('Open to LAN', 'border:1px solid rgba(100,180,255,0.4);background:rgba(100,180,255,0.1);color:#aaccff;');
const lanCancelBtn  = _btn('Cancel',      'border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#bbb;');
lanFormDiv.appendChild(lanUserInput);
lanFormDiv.appendChild(lanWorldInput);
lanFormDiv.appendChild(lanHint);
lanFormDiv.appendChild(_btnRow(lanCancelBtn, lanConfirmBtn));
lanBox.appendChild(lanFormDiv);

// Success state (hidden until room is opened)
const lanSuccessDiv = document.createElement('div');
lanSuccessDiv.style.cssText = 'display:none;flex-direction:column;align-items:center;gap:12px;';
const lanCodeEl     = document.createElement('div');
lanCodeEl.style.cssText = 'font-family:monospace;font-size:36px;font-weight:bold;color:#adf;letter-spacing:8px;text-align:center;padding:8px 0;';
const lanShareHint  = document.createElement('div');
lanShareHint.style.cssText = 'font-size:12px;color:#888;text-align:center;';
lanShareHint.textContent   = 'Share this code with friends to join.';
const lanCopyBtn = _btn('Copy Code', 'border:1px solid rgba(100,180,255,0.4);background:rgba(100,180,255,0.1);color:#aaccff;');
lanCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(lanCodeEl.textContent);
    lanCopyBtn.textContent = 'Copied!';
    setTimeout(() => { lanCopyBtn.textContent = 'Copy Code'; }, 1500);
});
const lanDoneBtn = _btn('Done', 'border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#bbb;');
lanDoneBtn.addEventListener('click', () => { lanOverlay.style.display = 'none'; closeSettings(); });
lanSuccessDiv.appendChild(lanCodeEl);
lanSuccessDiv.appendChild(lanShareHint);
lanSuccessDiv.appendChild(_btnRow(lanCopyBtn, lanDoneBtn));
lanBox.appendChild(lanSuccessDiv);

lanCancelBtn.addEventListener('click',  () => { lanOverlay.style.display = 'none'; });
lanUserInput.addEventListener( 'keydown', e => { if (e.key === 'Enter') lanConfirmBtn.click(); if (e.key === 'Escape') lanCancelBtn.click(); e.stopPropagation(); });
lanWorldInput.addEventListener('keydown', e => { if (e.key === 'Enter') lanConfirmBtn.click(); if (e.key === 'Escape') lanCancelBtn.click(); e.stopPropagation(); });

lanConfirmBtn.addEventListener('click', async () => {
    const username  = lanUserInput.value.trim();
    const worldName = lanWorldInput.value.trim() || currentWorldName || 'World';
    if (!username) { lanUserInput.focus(); return; }

    lanConfirmBtn.textContent = 'Opening…';
    lanConfirmBtn.disabled    = true;

    net.disconnect();
    try {
        await net.connect(WS_URL);
    } catch {
        showFeedback('Cannot reach server — is it deployed?');
        lanConfirmBtn.textContent = 'Open to LAN';
        lanConfirmBtn.disabled    = false;
        return;
    }

    const deltas = [...worldDeltas.entries()].map(([key, v]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { x, y, z, v };
    });
    const roomCode = await net.hostWorld(username, worldName,
        { bSeedX, bSeedZ, bOffset, mSeedX, mSeedZ },
        deltas, gameTime,
        { x: player.pos.x, y: player.pos.y, z: player.pos.z }
    );

    localUsername    = username;
    isLanOpen        = true;
    currentWorldName = worldName;
    lanConfirmBtn.textContent      = 'Open to LAN';
    lanConfirmBtn.disabled         = false;
    lanFormDiv.style.display       = 'none';
    lanSuccessDiv.style.display    = 'flex';
    lanCodeEl.textContent          = roomCode;
});

// "Open to LAN" button in settings panel (before Save World)
const openLanBtn = document.createElement('button');
openLanBtn.textContent = 'Open to LAN';
openLanBtn.style.cssText = 'font-family:monospace;font-size:13px;padding:9px;border-radius:8px;border:1px solid rgba(100,180,255,0.28);cursor:pointer;background:rgba(100,180,255,0.07);color:#aaccff;margin-top:4px;';
openLanBtn.addEventListener('click', () => {
    lanFormDiv.style.display    = 'contents';
    lanSuccessDiv.style.display = 'none';
    lanWorldInput.value         = currentWorldName ?? '';
    lanOverlay.style.display    = 'flex';
    setTimeout(() => lanUserInput.focus(), 40);
});
settingsPanel.insertBefore(openLanBtn, saveWorldBtn);

// ── Join Multiplayer modal ────────────────────────────────────────────────────
const joinOverlay = _modalOverlay(5100);
const joinBox     = _modalBox();
joinBox.style.minWidth = '380px';
joinOverlay.appendChild(joinBox);
joinBox.appendChild(_modalTitle('Join Multiplayer'));

const joinUserInput = _mpInput('Username...', 20);

const joinRoomHeader = document.createElement('div');
joinRoomHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
const joinRoomLabel  = document.createElement('div');
joinRoomLabel.style.cssText = 'font-size:11px;color:#777;';
joinRoomLabel.textContent   = 'Open Worlds';
const joinRefreshBtn = _btn('↻', 'border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#aaa;padding:4px 10px;font-size:14px;');
joinRoomHeader.appendChild(joinRoomLabel);
joinRoomHeader.appendChild(joinRefreshBtn);

const joinRoomList = document.createElement('div');
joinRoomList.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto;';

const joinCodeInput = _mpInput('Or enter room code...', 8);
joinCodeInput.style.textTransform = 'uppercase';

let _selectedRoomId = null;

async function _loadRooms() {
    joinRoomList.innerHTML = '';
    _selectedRoomId = null;
    const loading = document.createElement('div');
    loading.style.cssText = 'color:#666;font-size:11px;padding:4px 2px;';
    loading.textContent   = 'Loading…';
    joinRoomList.appendChild(loading);
    try {
        const r     = await fetch(HTTP_URL + '/api/rooms', { signal: AbortSignal.timeout(4000) });
        const list  = await r.json();
        joinRoomList.innerHTML = '';
        if (!list.length) {
            const el = document.createElement('div');
            el.style.cssText = 'color:#666;font-size:11px;padding:4px 2px;';
            el.textContent   = 'No open worlds yet.';
            joinRoomList.appendChild(el);
            return;
        }
        for (const room of list) {
            const entry = document.createElement('div');
            entry.style.cssText = 'border:1px solid rgba(255,255,255,0.12);border-radius:7px;padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.12s;';
            entry.addEventListener('mouseenter', () => { if (_selectedRoomId !== room.id) entry.style.background = 'rgba(255,255,255,0.07)'; });
            entry.addEventListener('mouseleave', () => { if (_selectedRoomId !== room.id) entry.style.background = ''; });
            const nameEl = document.createElement('span');
            nameEl.style.cssText = 'font-size:13px;font-weight:bold;';
            nameEl.textContent   = room.worldName;
            const metaEl = document.createElement('span');
            metaEl.style.cssText = 'font-size:11px;color:#777;font-family:monospace;';
            metaEl.textContent   = `${room.playerCount} online · ${room.id}`;
            entry.appendChild(nameEl);
            entry.appendChild(metaEl);
            entry.addEventListener('click', () => {
                for (const el of joinRoomList.children) { el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.background = ''; }
                entry.style.borderColor = 'rgba(100,180,255,0.45)';
                entry.style.background  = 'rgba(100,180,255,0.1)';
                _selectedRoomId     = room.id;
                joinCodeInput.value = '';
            });
            joinRoomList.appendChild(entry);
        }
    } catch {
        joinRoomList.innerHTML = '';
        const el = document.createElement('div');
        el.style.cssText = 'color:#c66;font-size:11px;padding:4px 2px;';
        el.textContent   = 'Could not reach server.';
        joinRoomList.appendChild(el);
    }
}

joinRefreshBtn.addEventListener('click', _loadRooms);
joinCodeInput.addEventListener('input', () => {
    joinCodeInput.value = joinCodeInput.value.toUpperCase();
    if (joinCodeInput.value) {
        _selectedRoomId = null;
        for (const el of joinRoomList.children) { el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.background = ''; }
    }
});

const joinConnectBtn = _btn('Connect', 'border:1px solid rgba(100,180,255,0.4);background:rgba(100,180,255,0.1);color:#aaccff;');
const joinCancelBtn  = _btn('Cancel',  'border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#bbb;');

joinBox.appendChild(joinUserInput);
joinBox.appendChild(joinRoomHeader);
joinBox.appendChild(joinRoomList);
joinBox.appendChild(joinCodeInput);
joinBox.appendChild(_btnRow(joinCancelBtn, joinConnectBtn));

joinCancelBtn.addEventListener('click',  () => { joinOverlay.style.display = 'none'; });
joinUserInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') joinConnectBtn.click(); if (e.key === 'Escape') joinCancelBtn.click(); });
joinCodeInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') joinConnectBtn.click(); if (e.key === 'Escape') joinCancelBtn.click(); });

joinConnectBtn.addEventListener('click', async () => {
    const username = joinUserInput.value.trim();
    const roomCode = joinCodeInput.value.trim() || _selectedRoomId;
    if (!username) { joinUserInput.focus(); return; }
    if (!roomCode) { showFeedback('Select a world or enter a room code'); return; }

    joinConnectBtn.textContent = 'Connecting…';
    joinConnectBtn.disabled    = true;

    net.disconnect();
    try {
        await net.connect(WS_URL);
    } catch {
        showFeedback('Cannot reach server');
        joinConnectBtn.textContent = 'Connect';
        joinConnectBtn.disabled    = false;
        return;
    }

    net.joinRoom(roomCode, username);
    localUsername              = username;
    joinOverlay.style.display  = 'none';
    joinConnectBtn.textContent = 'Connect';
    joinConnectBtn.disabled    = false;
    // world_state arrives via net.onWorldState → game starts automatically
});

// "Join Multiplayer" button on main menu
const mmJoinBtn = _menuBtn('Join Multiplayer');
mainMenuEl.appendChild(mmJoinBtn);
mmJoinBtn.addEventListener('click', () => {
    _selectedRoomId           = null;
    joinCodeInput.value       = '';
    joinOverlay.style.display = 'flex';
    setTimeout(() => joinUserInput.focus(), 40);
    _loadRooms();
});

animate();

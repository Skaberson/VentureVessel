export const CHUNK        = 16;
export const MIN_Y        = -200;
export const MAX_Y        = 260;
export const MIN_CY       = Math.floor(MIN_Y / CHUNK);
export const MAX_CY       = Math.floor((MAX_Y - 1) / CHUNK);

export const AIR   = 0;
export const GRASS = 1;
export const DIRT  = 2;
export const STONE = 3;
export const WOOD  = 4;
export const LEAVES = 5;
export const SAND   = 6;
export const SANDSTONE = 7;
export const CACTUS = 8;
export const ICE    = 9;
export const PFROST = 10;
export const IGRASS = 11;
export const PINEWOOD = 12;
export const PINELEAVES = 13;
export const DEEPSTONE = 14;
export const LAVAROCK = 15;
export const MOLTENROCK = 16;
export const MOONSTONE  = 17;
export const WOODPLANKS = 18;
export const WORKBENCH  = 19;
export const WOODCHIP   = 20;
export const FLINT      = 21;
export const WATER      = 22;
export const STICK      = 23;
export const WOODPICK   = 24;
export const MOON_MOUNTAIN_ROCK = 25;
export const VOIDGRASS   = 26;
export const VOIDDIRT    = 27;
export const VOIDSTONE   = 28;
export const VOIDWOOD    = 29;
export const VOIDLEAVES  = 30;
export const STONEPICK   = 31;
export const IRON_ORE   = 32;
export const LEAD_ORE   = 33;

export const DIM_EARTH  = 0;
export const DIM_MOON   = 1;
export const DIM_WATER  = 2;
export const DIM_FATES  = 3;

const GRASS_DEPTH = 3;
const DIRT_DEPTH  = 5;
const MAX_LIGHT   = 15;

// How many voxel steps skylight travels before reaching pitch black.
// Separating this from MAX_LIGHT lets the gradient span many more blocks
// without changing the internal brightness-level scale.
export const LIGHT_LEVELS = 48;

export const BIOME_FOREST = 0;
export const BIOME_DESERT = 1;
export const BIOME_TUNDRA = 2;
const BIOME_SCALE  = 800; // Large biomes
export const PYRAMID_CHANCE = 0.0001; // Much rarer spawn rate

export let bSeedX = Math.random() * 10000;
export let bSeedZ = Math.random() * 10000;

// Calculate an offset so the spawn point (8,8) always lands in the middle of the Forest biome (0.5)
const spawnVal = biomeFBM(8 / BIOME_SCALE + bSeedX, 0, 8 / BIOME_SCALE + bSeedZ);
export let bOffset = 0.5 - spawnVal;

export let mSeedX = Math.random() * 10000;
export let mSeedZ = Math.random() * 10000;

export function syncBiomeParams(sx, sz, offset, mx, mz) {
    bSeedX = sx;
    bSeedZ = sz;
    bOffset = offset;
    if (mx !== undefined) mSeedX = mx;
    if (mz !== undefined) mSeedZ = mz;
}

export function newRandomSeeds() {
    bSeedX  = Math.random() * 10000;
    bSeedZ  = Math.random() * 10000;
    bOffset = 0.5 - biomeFBM(8 / BIOME_SCALE + bSeedX, 0, 8 / BIOME_SCALE + bSeedZ);
    mSeedX  = Math.random() * 10000;
    mSeedZ  = Math.random() * 10000;
    return { bSeedX, bSeedZ, bOffset, mSeedX, mSeedZ };
}

// Search outward in 32-block steps until we land in the smooth fates biome,
// then return the XZ and the surface Y so the caller can spawn on the ground.
export function findFatesSmoothSpawn() {
    const smoothSurfY = (wx, wz) => {
        const n = valueNoise(wx/80, 0, wz/80)*0.50
                + valueNoise(wx/30, 0, wz/30)*0.35
                + valueNoise(wx/12, 0, wz/12)*0.15;
        return Math.round(155 + n * 25);
    };
    for (let r = 0; r <= 24; r++) {
        for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
            const wx = dx * 32, wz = dz * 32;
            if (valueNoise(wx / 250, 0, wz / 250) > 0.5) {
                const x = wx + 8, z = wz + 8;
                return { x, y: smoothSurfY(x, z) + 2, z };
            }
        }
    }
    return { x: 8, y: 182, z: 8 };
}

function getBiome(wx, wz) {
    let v = biomeFBM(wx / BIOME_SCALE + bSeedX, 0, wz / BIOME_SCALE + bSeedZ) + bOffset;
    v = ((v % 1) + 1) % 1; // Wrap into [0, 1] range
    if (v < 0.33) return BIOME_TUNDRA;
    if (v < 0.66) return BIOME_FOREST;
    return BIOME_DESERT;
}

function biomeFBM(x, y, z) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let octave = 0; octave < 4; octave++) { // 4 octaves for complexity
        value += amplitude * valueNoise(x * frequency, y * frequency, z * frequency);
        frequency *= 2;
        amplitude *= 0.5;
    }
    return value;
}

// ── Noise ─────────────────────────────────────────────────────────────────────
export function hash(x, y, z) {
    let n = (x * 1619 + y * 31337 + z * 6971) | 0;
    n = Math.imul(n ^ (n >>> 13), 0x45d9f3b) | 0;
    return ((n ^ (n >>> 15)) & 0x7fffffff) / 0x7fffffff;
}
function valueNoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x-ix, fy = y-iy, fz = z-iz;
    const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy), uz = fz*fz*(3-2*fz);
    return hash(ix,   iy,   iz  )*(1-ux)*(1-uy)*(1-uz)
         + hash(ix+1, iy,   iz  )*ux*(1-uy)*(1-uz)
         + hash(ix,   iy+1, iz  )*(1-ux)*uy*(1-uz)
         + hash(ix+1, iy+1, iz  )*ux*uy*(1-uz)
         + hash(ix,   iy,   iz+1)*(1-ux)*(1-uy)*uz
         + hash(ix+1, iy,   iz+1)*ux*(1-uy)*uz
         + hash(ix,   iy+1, iz+1)*(1-ux)*uy*uz
         + hash(ix+1, iy+1, iz+1)*ux*uy*uz;
}
function mountainNoise(wx, wz) {
    // Suppress mountains within 500 blocks of spawn (8, 8).
    const dx = wx - 8, dz = wz - 8;
    const distSq = dx * dx + dz * dz;
    const spawnFadeStart = 400, spawnFadeEnd = 500;
    const spawnT = Math.max(0, Math.min(1, (Math.sqrt(distSq) - spawnFadeStart) / (spawnFadeEnd - spawnFadeStart)));
    const spawnMask = spawnT * spawnT * (3 - 2 * spawnT);
    if (spawnMask < 0.001) return 0;

    // Seeded mask so mountain range locations differ each world.
    const maskRaw = valueNoise(wx / 150 + mSeedX, 17.3, wz / 150 + mSeedZ);
    const maskT = Math.max(0, Math.min(1, (maskRaw - 0.54) / 0.26));
    const mask = maskT * maskT * (3 - 2 * maskT);
    if (mask < 0.001) return 0;

    // Tighter ridged FBM (scale 70) = narrow individual peaks.
    // Cubing r sharpens the peak profile significantly.
    let ridged = 0, amp = 1.0, freq = 1.0, wt = 0;
    for (let i = 0; i < 5; i++) {
        const n = valueNoise(wx * freq / 70 + mSeedX, 53.1 + i * 5.3, wz * freq / 70 + mSeedZ);
        const r = 1 - Math.abs(2 * n - 1);
        ridged += amp * r * r * r;
        wt += amp;
        amp *= 0.5;
        freq *= 2.05;
    }
    ridged /= wt;

    return spawnMask * mask * ridged * 100;
}
function surfaceY(wx, wz) {
    const n = valueNoise(wx/80, 0, wz/80)*0.45
            + valueNoise(wx/30, 0, wz/30)*0.35
            + valueNoise(wx/12, 0, wz/12)*0.20;
    return Math.round(154 + n * 28 + mountainNoise(wx, wz));
}
function stoneNoise(x, y, z) {
    return valueNoise(x/18, y/18, z/18)*0.65 + valueNoise(x/7, y/7, z/7)*0.35;
}
function oreNoise(x, y, z) {
    return valueNoise(x/15, y/15, z/15)*0.6 + valueNoise(x/6, y/6, z/6)*0.4;
}
function isCave(x, y, z, surf) {
    // Disable caves in the Lava Layer to allow custom rock formations
    if (y < -100) return false;

    // Offset coordinates to decorrelate cave structures from surface terrain
    const ox = x + 1500, oy = y + 500, oz = z + 1500;
    const n = valueNoise(ox / 16, oy / 12, oz / 16);
    
    const tunnel = Math.abs(n - 0.5) < 0.02;
    const cavern = n > 0.97;

    // Rare surface entrances: Use 2D noise mask to allow caves to break the surface
    const entranceMask = valueNoise(x / 60, 123.4, z / 60) > 0.95;
    if (y > surf - 6) return entranceMask && tunnel;

    return (tunnel || cavern) && y > MIN_Y + 4; // Keep a solid floor at the bottom
}

const LDIRS = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1];

export class VoxelWorld {
    constructor() {
        this.dimension   = DIM_EARTH;
        this.chunks      = new Map(); // "cx,cy,cz" -> Uint8Array (types)
        this.lights      = new Map(); // "cx,cy,cz" -> Uint8Array (sky light 0-15)
        this.colorLights = new Map(); // "cx,cy,cz" -> Uint8Array(CHUNK^3 * 3) RGB colored light
        this.litCols     = new Set(); // "dim:cx,cz" columns that have had vertical scan
    }

    // ── Chunk data ────────────────────────────────────────────────────────────
    generateChunk(cx, cy, cz) {
        const key = this._key(cx * CHUNK, cy * CHUNK, cz * CHUNK);
        if (this.chunks.has(key)) return;
        const data = new Uint8Array(CHUNK * CHUNK * CHUNK);
        const x0 = cx*CHUNK, y0 = cy*CHUNK, z0 = cz*CHUNK;

        if (this.dimension === DIM_MOON) {
            for (let lz = 0; lz < CHUNK; lz++)
            for (let lx = 0; lx < CHUNK; lx++) {
                const wx = x0+lx, wz = z0+lz;
                const surf = surfaceY(wx, wz);
                const mntH = mountainNoise(wx, wz);
                const baseSurf = surf - mntH;
                for (let ly = 0; ly < CHUNK; ly++) {
                    const wy = y0 + ly;
                    if (wy <= surf) {
                        data[lx + CHUNK*(ly + CHUNK*lz)] = (mntH > 1.5 && wy > baseSurf) ? MOON_MOUNTAIN_ROCK : MOONSTONE;
                    }
                }
            }
            this.chunks.set(key, data);
            this.lights.set(key, new Uint8Array(CHUNK * CHUNK * CHUNK));
            return;
        }

        if (this.dimension === DIM_FATES) {
            // Biome split: 0 = wild (chaotic), 1 = smooth (forest-like)
            const fatesBiome = (wx, wz) =>
                valueNoise(wx / 250, 0, wz / 250) > 0.5 ? 1 : 0;

            const wildSurf = (wx, wz) => {
                const n = valueNoise(wx/22, 0, wz/22)*0.45
                        + valueNoise(wx/9,  0, wz/9 )*0.32
                        + valueNoise(wx/4,  0, wz/4 )*0.15
                        + valueNoise(wx/1.8,0, wz/1.8)*0.08;
                return Math.round(120 + n * 110);
            };

            const smoothSurf = (wx, wz) => {
                const n = valueNoise(wx/80, 0, wz/80)*0.50
                        + valueNoise(wx/30, 0, wz/30)*0.35
                        + valueNoise(wx/12, 0, wz/12)*0.15;
                return Math.round(155 + n * 25);
            };

            // Floating voidstone chunk check for the smooth biome (~1 per 40-block grid cell)
            const FGRID = 40;
            const isInFloat = (wx, wy, wz) => {
                const gx = Math.floor(wx / FGRID);
                const gz = Math.floor(wz / FGRID);
                for (let dgz = -1; dgz <= 1; dgz++)
                for (let dgx = -1; dgx <= 1; dgx++) {
                    const cx = gx + dgx, cz = gz + dgz;
                    if (hash(cx, 5, cz) < 0.5) continue; // 50% of cells have a chunk
                    const ox = cx * FGRID + Math.floor(hash(cx, 7,  cz) * FGRID);
                    const oy = 195       + Math.floor(hash(cx, 13, cz) * 40);
                    const oz = cz * FGRID + Math.floor(hash(cx, 17, cz) * FGRID);
                    const r  = 3 + hash(cx, 23, cz) * 4; // radius 3–7
                    const dx = wx - ox, dy = wy - oy, dz = wz - oz;
                    if (dx*dx + dy*dy + dz*dz <= r*r) return true;
                }
                return false;
            };

            for (let lz = 0; lz < CHUNK; lz++)
            for (let lx = 0; lx < CHUNK; lx++) {
                const wx = x0 + lx, wz = z0 + lz;
                const biome = fatesBiome(wx, wz);
                const surf  = biome === 0 ? wildSurf(wx, wz) : smoothSurf(wx, wz);

                for (let ly = 0; ly < CHUNK; ly++) {
                    const wy = y0 + ly;
                    let t = AIR;
                    if (wy <= surf) {
                        if (wy === surf)         t = VOIDGRASS;
                        else if (wy >= surf - 4) t = VOIDDIRT;
                        else                     t = VOIDSTONE;
                    } else if (biome === 1 && isInFloat(wx, wy, wz)) {
                        t = VOIDSTONE;
                    }
                    data[lx + CHUNK*(ly + CHUNK*lz)] = t;
                }
            }
            this.chunks.set(key, data);
            this.lights.set(key, new Uint8Array(CHUNK * CHUNK * CHUNK));

            // ── Voidwood Tree Spawning (smooth biome only) ────────────────────
            const FATES_SPAWN_X = 150, FATES_SPAWN_Z = 450;
            for (let lz = 0; lz < CHUNK; lz++)
            for (let lx = 0; lx < CHUNK; lx++) {
                const wx = x0 + lx, wz = z0 + lz;
                if (fatesBiome(wx, wz) !== 1) continue;
                const surf = smoothSurf(wx, wz);
                if (surf < y0 || surf >= y0 + CHUNK) continue;
                if (this.get(wx, surf, wz) !== VOIDGRASS) continue;
                // Protect the hardcoded player spawn area
                const dsx = wx - FATES_SPAWN_X, dsz = wz - FATES_SPAWN_Z;
                if (dsx * dsx + dsz * dsz < 30 * 30) continue;
                if (hash(wx, 0, wz) < 0.015) {
                    this._spawnVoidTree(wx, surf + 1, wz);
                }
            }
            return;
        }

        if (this.dimension === DIM_WATER) {
            const WATER_FLOOR = 0;   // sand starts
            const WATER_BOT   = 20;  // water starts
            const WATER_TOP   = 30;  // water ends (air above)
            for (let lz = 0; lz < CHUNK; lz++)
            for (let lx = 0; lx < CHUNK; lx++)
            for (let ly = 0; ly < CHUNK; ly++) {
                const wy = y0 + ly;
                let t = AIR;
                if (wy >= WATER_FLOOR && wy < WATER_BOT)  t = SAND;
                else if (wy >= WATER_BOT && wy < WATER_TOP) t = WATER;
                data[lx + CHUNK*(ly + CHUNK*lz)] = t;
            }
            this.chunks.set(key, data);
            this.lights.set(key, new Uint8Array(CHUNK * CHUNK * CHUNK));
            return;
        }

        for (let lz = 0; lz < CHUNK; lz++)
        for (let lx = 0; lx < CHUNK; lx++) {
            const wx = x0+lx, wz = z0+lz;
            const biome     = getBiome(wx, wz);
            const surf      = surfaceY(wx, wz);
            const mntH      = mountainNoise(wx, wz);
            const grassBase = surf - GRASS_DEPTH + 1;
            const dirtBase  = grassBase - DIRT_DEPTH;
            const baseSurf  = surf - mntH; // The 'normal' ground level under the mountain

            for (let ly = 0; ly < CHUNK; ly++) {
                const wy = y0+ly;
                let t = AIR;

                if (wy < -100) {
                    // Zone 1: Lava Layer (-200 to -101)
                    if (wy < MIN_Y + 4) {
                        t = LAVAROCK; // Solid floor at the very bottom
                    } else {
                        // Large chunks of Molten Rock using a lower frequency noise
                        const nMolten = valueNoise(wx / 30, wy / 25, wz / 30);
                        if (nMolten > 0.72) {
                            t = MOLTENROCK;
                        } else if (stoneNoise(wx, wy, wz) > 0.55) {
                            t = LAVAROCK;
                        }
                    }
                } else if (wy <= surf) {
                    // Zone 2 & 3: Deep Stone and Overworld
                    // Only place blocks if we are not inside a cave tunnel
                    if (!isCave(wx, wy, wz, surf)) {
                        if (wy < 100) {
                            // Zone 2: Deep Stone Layer (-100 to 99)
                            // Ore concentration increases with depth: depth_t goes 0 at y=100 to 1 at y=-100
                            const depth_t = (100 - wy) / 200;
                            const ironThresh = 0.80 - 0.20 * depth_t;
                            const leadThresh = 0.86 - 0.18 * depth_t;
                            const oN = oreNoise(wx + 500, wy, wz + 500);
                            const oNL = oreNoise(wx + 1000, wy + 200, wz + 1000);
                            if (oNL > leadThresh) t = LEAD_ORE;
                            else if (oN > ironThresh) t = IRON_ORE;
                            else t = DEEPSTONE;
                        } else {
                            // Zone 3: Overworld (100+)
                            let topMat = GRASS, midMat = DIRT, botMat = STONE;
                            if (biome === BIOME_DESERT) {
                                topMat = SAND; midMat = SAND; botMat = SANDSTONE;
                            } else if (biome === BIOME_TUNDRA) {
                                topMat = IGRASS; midMat = PFROST; botMat = ICE;
                            }

                            // If we are above the base terrain and it's a mountain, use stone
                            if (mntH > 1.5 && wy > baseSurf) t = botMat;
                            else if (wy >= grassBase) t = topMat;
                            else if (wy >= dirtBase)  t = midMat;
                            else {
                                const thr = dirtBase > 0 ? 0.72*(wy/dirtBase) : 0;
                                const baseBlock = stoneNoise(wx, wy, wz) > thr ? botMat : midMat;
                                // Iron ore veins in overworld stone, sparser near surface
                                if (baseBlock === STONE) {
                                    const depth_t = (100 - wy) / 200; // negative near surface
                                    const ironThresh = 0.80 - 0.20 * Math.max(0, depth_t);
                                    const oN = oreNoise(wx + 500, wy, wz + 500);
                                    t = oN > ironThresh ? IRON_ORE : STONE;
                                } else {
                                    t = baseBlock;
                                }
                            }
                        }
                    }
                }
                data[lx + CHUNK*(ly + CHUNK*lz)] = t;
            }
        }
        this.chunks.set(key, data);
        this.lights.set(key, new Uint8Array(CHUNK * CHUNK * CHUNK));

        // ── Tree Spawning ─────────────────────────────────────────────────────
        // Only attempt to spawn trees in the chunk containing the surface
        for (let lz = 0; lz < CHUNK; lz++)
        for (let lx = 0; lx < CHUNK; lx++) {
            const wx = x0 + lx, wz = z0 + lz;
            const biome = getBiome(wx, wz);
            const surf = surfaceY(wx, wz);
            if (surf >= y0 && surf < y0 + CHUNK) {
                // Deterministic roll using the existing hash function
                const spawnRoll = hash(wx, 0, wz);
                const blockAtSurface = this.get(wx, surf, wz);

                if (biome === BIOME_FOREST && spawnRoll < 0.015 && blockAtSurface === GRASS) {
                    this._spawnTree(wx, surf + 1, wz, WOOD, LEAVES);
                } else if (biome === BIOME_TUNDRA && spawnRoll < 0.015 && blockAtSurface === IGRASS) {
                    this._spawnTree(wx, surf + 1, wz, PINEWOOD, PINELEAVES);
                } else if (biome === BIOME_DESERT && spawnRoll < 0.02 && blockAtSurface === SAND && (wx % 3 === 0) && (wz % 3 === 0)) {
                    if (spawnRoll < PYRAMID_CHANCE) {
                        this._spawnPyramid(wx, surf, wz);
                    }
                    // Only spawn on a 3x3 grid to prevent cacti from clumping into larger "tree-like" blobs
                    this._spawnCactus(wx, surf + 1, wz);
                }
            }
        }
        // ── Ore Colored Light Seeding ─────────────────────────────────────────
        const oreQ = [];
        for (let lz = 0; lz < CHUNK; lz++)
        for (let ly = 0; ly < CHUNK; ly++)
        for (let lx = 0; lx < CHUNK; lx++) {
            const t = data[lx + CHUNK*(ly + CHUNK*lz)];
            let sr = 0, sg = 0, sb = 0;
            if (t === IRON_ORE) { sr = 24; sg = 12; sb = 0; }
            else if (t === LEAD_ORE) { sr = 0; sg = 10; sb = 24; }
            else continue;
            this._setColoredLight(x0+lx, y0+ly, z0+lz, sr, sg, sb);
            oreQ.push(x0+lx, y0+ly, z0+lz);
        }
        if (oreQ.length > 0) this._propagateColoredLight(oreQ);
    }

    _setColoredLight(x, y, z, r, g, b) {
        if (y < MIN_Y || y >= MAX_Y) return;
        const key = this._key(x, y, z);
        let cl = this.colorLights.get(key);
        if (!cl) { cl = new Uint8Array(CHUNK * CHUNK * CHUNK * 3); this.colorLights.set(key, cl); }
        const i = (this._local(x) + CHUNK * (this._local(y) + CHUNK * this._local(z))) * 3;
        cl[i] = r; cl[i+1] = g; cl[i+2] = b;
    }

    _peekColoredLight(x, y, z) {
        if (y < MIN_Y || y >= MAX_Y) return [0, 0, 0];
        const key = this._key(x, y, z);
        const cl = this.colorLights.get(key);
        if (!cl) return [0, 0, 0];
        const i = (this._local(x) + CHUNK * (this._local(y) + CHUNK * this._local(z))) * 3;
        return [cl[i], cl[i+1], cl[i+2]];
    }

    getColoredLight(x, y, z) {
        return this._peekColoredLight(x, y, z);
    }

    _propagateColoredLight(q) {
        let head = 0;
        while (head < q.length) {
            const x = q[head++], y = q[head++], z = q[head++];
            const [lr, lg, lb] = this._peekColoredLight(x, y, z);
            if (lr <= 1 && lg <= 1 && lb <= 1) continue;
            for (let d = 0; d < 18; d += 3) {
                const nx = x+LDIRS[d], ny = y+LDIRS[d+1], nz = z+LDIRS[d+2];
                if (ny < MIN_Y || ny >= MAX_Y) continue;
                const nk = this._key(nx, ny, nz);
                const nc = this.chunks.get(nk);
                if (!nc) continue;
                const ni = this._local(nx) + CHUNK*(this._local(ny) + CHUNK*this._local(nz));
                const nt = nc[ni];
                if (nt !== AIR && nt !== WATER && nt !== MOLTENROCK && nt !== LEAVES && nt !== PINELEAVES && nt !== VOIDLEAVES) continue;
                const nr = lr > 1 ? lr-1 : 0, ng = lg > 1 ? lg-1 : 0, nb = lb > 1 ? lb-1 : 0;
                const [er, eg, eb] = this._peekColoredLight(nx, ny, nz);
                if (nr <= er && ng <= eg && nb <= eb) continue;
                this._setColoredLight(nx, ny, nz, Math.max(nr,er), Math.max(ng,eg), Math.max(nb,eb));
                q.push(nx, ny, nz);
            }
        }
    }

    _spawnTree(wx, wy, wz, logType, leafType) {
        const h = 5 + Math.floor(hash(wx, wy, wz) * 4);
        // 3x3 trunk base (bottom 2 layers) centered on wx, wz
        for (let dy = 0; dy < 2; dy++)
        for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
            this.set(wx + dx, wy + dy, wz + dz, logType);
        }
        // 2x2 trunk extension centered more closely on the 3x3 base
        for (let dy = 2; dy < h; dy++)
        for (let dx = -1; dx <= 0; dx++)
        for (let dz = -1; dz <= 0; dz++) {
            this.set(wx + dx, wy + dy, wz + dz, logType);
        }
        // Leaf cluster at the tip
        const th = wy + h;
        for (let ly = -2; ly <= 2; ly++)
        for (let lx = -2; lx <= 2; lx++)
        for (let lz = -2; lz <= 2; lz++) {
            if (lx * lx + ly * ly + lz * lz <= 6) {
                if (this.get(wx + lx, th + ly, wz + lz) === AIR) {
                    this.set(wx + lx, th + ly, wz + lz, leafType);
                }
            }
        }
    }

    _spawnVoidTree(wx, wy, wz) {
        const h = 18 + Math.floor(hash(wx, wy, wz) * 10); // 18–27 blocks tall
        const R = 9  + Math.floor(hash(wx, wy + 1, wz) * 4); // canopy radius 9–12
        // Wide 5×5 base trunk (bottom 3 layers)
        for (let dy = 0; dy < 3; dy++)
        for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++)
            this.set(wx + dx, wy + dy, wz + dz, VOIDWOOD);
        // 3×3 mid trunk
        for (let dy = 3; dy < h - 2; dy++)
        for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
            this.set(wx + dx, wy + dy, wz + dz, VOIDWOOD);
        // Single-wide tip
        for (let dy = h - 2; dy < h; dy++)
            this.set(wx, wy + dy, wz, VOIDWOOD);
        // Spherical leaf canopy centred at the top
        const th = wy + h;
        for (let ly = -R; ly <= R; ly++)
        for (let lx = -R; lx <= R; lx++)
        for (let lz = -R; lz <= R; lz++) {
            if (lx * lx + ly * ly + lz * lz <= R * R) {
                if (this.get(wx + lx, th + ly, wz + lz) === AIR)
                    this.set(wx + lx, th + ly, wz + lz, VOIDLEAVES);
            }
        }
    }

    _spawnCactus(wx, wy, wz) {
        const h = 3 + Math.floor(hash(wx, wy, wz) * 3); // Cactus height 3-5
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                for (let dz = 0; dz <= 1; dz++) {
                    this.set(wx + dx, wy + dy, wz + dz, CACTUS);
                }
            }
        }
    }

    _spawnPyramid(wx, wy, wz) {
        const baseSize = 31;
        const height = Math.floor(baseSize / 2) + 1;
        for (let dy = 0; dy < height; dy++) {
            const extent = Math.floor(baseSize / 2) - dy;
            for (let dx = -extent; dx <= extent; dx++) {
                for (let dz = -extent; dz <= extent; dz++) {
                    // Place sandstone, overwriting whatever was there (cacti/sand)
                    this.set(wx + dx, wy + dy, wz + dz, SANDSTONE);
                }
            }
        }
    }

    _local(v) { return ((v % CHUNK) + CHUNK) % CHUNK; }
    _key(x, y, z) {
        return `${this.dimension}:${Math.floor(x/CHUNK)},${Math.floor(y/CHUNK)},${Math.floor(z/CHUNK)}`;
    }

    get(x, y, z) {
        if (y < MIN_Y || y >= MAX_Y) return 0;
        const key = this._key(x, y, z);
        if (!this.chunks.has(key)) this.generateChunk(
            Math.floor(x/CHUNK), Math.floor(y/CHUNK), Math.floor(z/CHUNK));
        return this.chunks.get(key)[this._local(x) + CHUNK*(this._local(y) + CHUNK*this._local(z))];
    }

    isSolid(x, y, z) { const t = this.get(x, y, z); return t > 0 && t !== WATER; }

    set(x, y, z, v) {
        if (y < MIN_Y || y >= MAX_Y) return;
        const key = this._key(x, y, z);
        if (!this.chunks.has(key)) this.generateChunk(
            Math.floor(x/CHUNK), Math.floor(y/CHUNK), Math.floor(z/CHUNK));
        this.chunks.get(key)[this._local(x) + CHUNK*(this._local(y) + CHUNK*this._local(z))] = v;
    }

    // ── Sky light ─────────────────────────────────────────────────────────────

    // Lazy: ensures the XZ column has a vertical sky-light pass done
    _ensureColLit(cx, cz) {
        const colKey = `${this.dimension}:${cx},${cz}`;
        if (this.litCols.has(colKey)) return;
        this.litCols.add(colKey);
        for (let cy = MIN_CY; cy <= MAX_CY; cy++) this.generateChunk(cx, cy, cz);

        const wx0 = cx*CHUNK, wz0 = cz*CHUNK;
        const q = [];
        for (let lz = 0; lz < CHUNK; lz++)
        for (let lx = 0; lx < CHUNK; lx++) {
            // Track the lowest sky-lit air voxel so we can seed BFS from it,
            // allowing skylight to bleed horizontally into adjacent cave air.
            let lowestAirY = MAX_Y;
            for (let wy = MAX_Y-1; wy >= MIN_Y; wy--) {
                this._setLight(wx0+lx, wy, wz0+lz, LIGHT_LEVELS);
                if (this.get(wx0+lx, wy, wz0+lz) === MOLTENROCK) q.push(wx0+lx, wy, wz0+lz);
                // Stop AFTER lighting the first solid block found
                if (this.isSolid(wx0+lx, wy, wz0+lz)) break;
                lowestAirY = wy;
            }
            // Seed BFS from the lowest sky-lit air voxel so light propagates
            // sideways into cave tunnels, decaying with distance from the opening.
            if (lowestAirY < MAX_Y) q.push(wx0+lx, lowestAirY, wz0+lz);
        }
        if (q.length > 0) this._propagateLight(q);
    }

    _setLight(x, y, z, v) {
        if (y < MIN_Y || y >= MAX_Y) return;
        const key = this._key(x, y, z);
        if (!this.lights.has(key)) this.lights.set(key, new Uint8Array(CHUNK*CHUNK*CHUNK));
        this.lights.get(key)[this._local(x) + CHUNK*(this._local(y) + CHUNK*this._local(z))] = v;
    }

    // Reads the stored light value directly without triggering _ensureColLit.
    // Safe to call from inside _propagateLight to avoid mutual recursion.
    _peekLight(x, y, z) {
        if (y < MIN_Y) return 0;
        if (y >= MAX_Y) return LIGHT_LEVELS;
        const key = this._key(x, y, z);
        const ld = this.lights.get(key);
        if (!ld) return 0;
        return ld[this._local(x) + CHUNK*(this._local(y) + CHUNK*this._local(z))];
    }

    getLight(x, y, z) {
        if (y < MIN_Y)             return 0;
        if (y >= MAX_Y)            return LIGHT_LEVELS;
        const cx = Math.floor(x/CHUNK), cz = Math.floor(z/CHUNK);
        this._ensureColLit(cx, cz);
        return this._peekLight(x, y, z);
    }

    // BFS from a newly mined position — spreads sky light into caves.
    // Called once after mining; only updates light, doesn't rebuild meshes.
    updateLightAt(mx, my, mz) {
        // Determine starting light for the newly exposed air voxel
        // (inherit from the voxel above, or full sky if nothing blocks above)
        let startLight = 0;
        if (this.get(mx, my, mz) === MOLTENROCK) startLight = LIGHT_LEVELS;

        for (let y = my + 1; y < MAX_Y; y++) {
            if (this.isSolid(mx, y, mz)) break;
            startLight = this.getLight(mx, y, mz);
            break;
        }
        if (!this.isSolid(mx, my+1, mz) && my+1 >= MAX_Y) startLight = LIGHT_LEVELS;
        if (startLight === 0 && !this.isSolid(mx, my, mz)) {
            // Might be at the very top of a newly opened shaft — do a vertical scan
            this.litCols.delete(`${this.dimension}:${Math.floor(mx/CHUNK)},${Math.floor(mz/CHUNK)}`);
            this._ensureColLit(Math.floor(mx/CHUNK), Math.floor(mz/CHUNK));
            startLight = this.getLight(mx, my, mz);
        }
        if (startLight === 0) return;

        this._setLight(mx, my, mz, startLight);
        this._propagateLight([mx, my, mz]);
    }

    _propagateLight(q) {
        // BFS outward through air and light sources, decaying by 1 per step.
        // Reads block type directly from the chunk buffer — no world API calls,
        // no generateChunk triggers. Skips neighbors in unloaded chunks entirely;
        // those chunks light themselves from their own sky openings when they load.
        let head = 0;
        while (head < q.length) {
            const x = q[head++], y = q[head++], z = q[head++];
            const lv = this._peekLight(x, y, z);
            if (lv <= 1) continue;
            for (let d = 0; d < 18; d += 3) {
                const nx = x+LDIRS[d], ny = y+LDIRS[d+1], nz = z+LDIRS[d+2];
                if (ny < MIN_Y || ny >= MAX_Y) continue;
                const nk = this._key(nx, ny, nz);
                const nc = this.chunks.get(nk);
                if (!nc) continue; // unloaded — skip to avoid cascade chunk generation
                const nt = nc[this._local(nx) + CHUNK*(this._local(ny) + CHUNK*this._local(nz))];
                // Propagate through air, water, molten rock, and transparent leaves
                if (nt !== AIR && nt !== WATER && nt !== MOLTENROCK && nt !== LEAVES && nt !== PINELEAVES) continue;
                if (this._peekLight(nx, ny, nz) >= lv-1) continue;
                this._setLight(nx, ny, nz, lv-1);
                q.push(nx, ny, nz);
            }
        }
    }

    surfaceAt(wx, wz) { return surfaceY(wx, wz); }

    getBiomeAt(wx, wz) {
        return getBiome(wx, wz);
    }

    reset() {
        this.chunks.clear();
        this.lights.clear();
        this.colorLights.clear();
        this.litCols.clear();
    }

    affectedChunks(x, y, z) {
        const set = new Set();
        const add = (vx, vy, vz) => {
            if (vy < MIN_Y || vy >= MAX_Y) return;
            set.add(`${Math.floor(vx/CHUNK)},${Math.floor(vy/CHUNK)},${Math.floor(vz/CHUNK)}`);
        };
        // Gaussian blur radius = 1 means a changed voxel shifts densities at ±1.
        // An MC cube at position C uses corners C and C+1, so cubes at C = mined-2
        // to mined+1 are affected. Combined worst case: ±2 in each axis.
        for (let dz = -2; dz <= 2; dz++)
        for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
            add(x+dx, y+dy, z+dz);
        return [...set].map(s => s.split(',').map(Number));
    }
}

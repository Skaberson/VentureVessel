import { CHUNK, MAX_Y, MOLTENROCK, STONE, DEEPSTONE, LAVAROCK, DIM_MOON, MOONSTONE, WOODPLANKS } from '../world.js';
import { MC_EDGE_TABLE, MC_TRI_TABLE } from './mc_tables.js';

const GAUSS_OFF = [], GAUSS_W = [];
let GAUSS_SUM = 0;
for (let dz=-1;dz<=1;dz++) for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
    const w = Math.exp(-(dx*dx+dy*dy+dz*dz)*0.8);
    GAUSS_OFF.push(dx,dy,dz); GAUSS_W.push(w); GAUSS_SUM += w;
}

// Pre-calculate relative index offsets for the Gaussian weights to speed up the hot loop
function getGaussIdxOffsets(bsx, bsy) {
    const offsets = new Int32Array(GAUSS_W.length);
    for (let i = 0; i < GAUSS_W.length; i++) {
        offsets[i] = GAUSS_OFF[i*3] + bsx * (GAUSS_OFF[i*3+1] + bsy * GAUSS_OFF[i*3+2]);
    }
    return offsets;
}

const CX=[0,1,1,0,0,1,1,0], CY=[0,0,0,0,1,1,1,1], CZ=[0,0,1,1,0,0,1,1];
const EA=[0,1,2,3,4,5,6,7,0,1,2,3], EB=[1,2,3,0,5,6,7,4,4,5,6,7];

const MIN_BRIGHTNESS = 0.2;
const MAX_LIGHT      = 15;

export function buildChunkMesh(world, cx, cy, cz, fullbright = false, lod = 1, voxelMode = false) {
    const x0 = cx*CHUNK, y0 = cy*CHUNK, z0 = cz*CHUNK;
    const x1 = x0+CHUNK+1;
    const y1 = Math.min(y0+CHUNK+1, MAX_Y+1);
    const z1 = z0+CHUNK+1;

    // ── Pre-load solid, type, and light into flat buffers ─────────────────────
    // Using flat arrays avoids per-voxel Map lookups inside the hot MC loop.
    // We need a 1-voxel padding (bx0-1 to bx1+1) to satisfy Gaussian blur and MC lookahead.
    const bx0 = x0 - 1;
    const by0 = y0 - 1;
    const bz0 = z0 - 1;
    const bx1 = x1 + 1;
    const by1 = y1 + 1;
    const bz1 = z1 + 1;
    const bsx=bx1-bx0+1, bsy=by1-by0+1, bsz=bz1-bz0+1;
    const size = bsx*bsy*bsz;

    const solidBuf = new Uint8Array(size);
    const typeBuf  = new Uint8Array(size);
    const lightBuf = new Uint8Array(size);

    let hasSolid = false;
    for (let z=bz0;z<=bz1;z++)
    for (let y=by0;y<=by1;y++)
    for (let x=bx0;x<=bx1;x++) {
        const i = (x-bx0)+bsx*((y-by0)+bsy*(z-bz0));
        const t = world.get(x,y,z);
        if (t > 0) hasSolid = true;
        solidBuf[i] = t > 0 ? 1 : 0;
        typeBuf[i]  = t;
        lightBuf[i] = world.getLight(x,y,z);
    }

    function solid(x,y,z) {
        if (y < by0 || y > by1 || x < bx0 || x > bx1 || z < bz0 || z > bz1) return 0;
        return solidBuf[(x-bx0)+bsx*((y-by0)+bsy*(z-bz0))];
    }
    function getType(x,y,z) {
        if (y < by0 || y > by1 || x < bx0 || x > bx1 || z < bz0 || z > bz1) return 0;
        return typeBuf[(x-bx0)+bsx*((y-by0)+bsy*(z-bz0))];
    }
    function getRawLight(x,y,z) {
        if (y < by0 || y > by1 || x < bx0 || x > bx1 || z < bz0 || z > bz1) return y >= MAX_Y ? MAX_LIGHT : 0;
        if (getType(x, y, z) === MOLTENROCK) return MAX_LIGHT;
        return lightBuf[(x-bx0)+bsx*((y-by0)+bsy*(z-bz0))];
    }

    // ── Density cache ─────────────────────────────────────────────────────────
    const dsx=x1-x0+1, dsy=y1-y0+1, dsz=z1-z0+1;
    const densCache = new Float32Array(dsx * dsy * dsz);
    const gaussIdxOffsets = getGaussIdxOffsets(bsx, bsy);

    for (let z=z0; z<=z1; z++)
    for (let y=y0; y<=y1; y++)
    for (let x=x0; x<=x1; x++) {
        const dIdx     = (x-x0)+dsx*((y-y0)+dsy*(z-z0));
        const baseIdx = (x-bx0)+bsx*((y-by0)+bsy*(z-bz0));
        if (voxelMode) {
            densCache[dIdx] = solidBuf[baseIdx];
        } else {
            // Exclude WOODPLANKS from the Gaussian so smooth terrain doesn't try
            // to blend into plank voxels — planks use box geometry, not MC.
            let sum = 0;
            for (let i = 0; i < GAUSS_W.length; i++) {
                const nIdx = baseIdx + gaussIdxOffsets[i];
                if (typeBuf[nIdx] !== WOODPLANKS) {
                    sum += GAUSS_W[i] * solidBuf[nIdx];
                }
            }
            densCache[dIdx] = sum / GAUSS_SUM;
        }
    }

    function getDens(x,y,z) {
        const idx = (x-x0)+dsx*((y-y0)+dsy*(z-z0));
        if (idx < 0 || idx >= densCache.length) return 0;
        return densCache[idx];
    }

    // Calculates a smooth light value by interpolating the 8 surrounding voxels.
    function brightnessAt(wx,wy,wz) {
        if (fullbright) return 1;

        const x0 = Math.floor(wx), x1 = x0 + 1;
        const y0 = Math.floor(wy), y1 = y0 + 1;
        const z0 = Math.floor(wz), z1 = z0 + 1;
        const tx = wx - x0, ty = wy - y0, tz = wz - z0;

        // Fetch the 8 corner values
        const l000 = getRawLight(x0, y0, z0), l100 = getRawLight(x1, y0, z0);
        const l010 = getRawLight(x0, y1, z0), l110 = getRawLight(x1, y1, z0);
        const l001 = getRawLight(x0, y0, z1), l101 = getRawLight(x1, y0, z1);
        const l011 = getRawLight(x0, y1, z1), l111 = getRawLight(x1, y1, z1);

        // Blend along X
        const v00 = l000 * (1 - tx) + l100 * tx, v10 = l010 * (1 - tx) + l110 * tx;
        const v01 = l001 * (1 - tx) + l101 * tx, v11 = l011 * (1 - tx) + l111 * tx;
        // Blend along Y
        const v0 = v00 * (1 - ty) + v10 * ty, v1 = v01 * (1 - ty) + v11 * ty;
        // Blend along Z
        const final = v0 * (1 - tz) + v1 * tz;
        
        const s = final / MAX_LIGHT;
        return Math.pow(MIN_BRIGHTNESS + s * (1.0 - MIN_BRIGHTNESS), 0.5);
    }

    // ── Marching Cubes ────────────────────────────────────────────────────────
    // Keyed by voxel type so new block types need no changes here.
    const buckets = new Map();

    if (!hasSolid) return [];

    function interp(ax,ay,az,va,bx,by,bz,vb) {
        const t=(0.5-va)/(vb-va+1e-9);
        return[ax+t*(bx-ax),ay+t*(by-ay),az+t*(bz-az)];
    }
    
    for(let z=z0;z<z1-1;z+=lod)
    for(let y=y0;y<y1-1;y+=lod)
    for(let x=x0;x<x1-1;x+=lod){
        const val=[
            getDens(x, y, z),                     getDens(x + lod, y, z),
            getDens(x + lod, y, z + lod),         getDens(x, y, z + lod),
            getDens(x, y + lod, z),               getDens(x + lod, y + lod, z),
            getDens(x + lod, y + lod, z + lod),   getDens(x, y + lod, z + lod),
        ];
        let ci=0;
        for(let i=0;i<8;i++) if(val[i]>=0.5) ci|=(1<<i);
        if(ci===0||ci===255) continue;

        // Precompute all 8 corner materials. type=0 means this corner is a blur artifact
        // (density ≥ 0.5 from Gaussian spillover, but no actual solid voxel here).
        const cornerMat = new Array(8);
        for (let k = 0; k < 8; k++) {
            cornerMat[k] = getType(x + CX[k]*lod, y + CY[k]*lod, z + CZ[k]*lod);
        }

        // Find the best fallback: the solid corner closest to the 0.5 threshold.
        // "Closest to threshold" = lowest density among inside corners, meaning it's
        // the thinnest sliver of solid — i.e., the actual surface voxel, not a deep one.
        let fallbackMat = 0, fallbackDelta = Infinity;
        for (let k = 0; k < 8; k++) {
            if (val[k] < 0.5 || cornerMat[k] === 0) continue;
            const delta = val[k] - 0.5;
            if (delta < fallbackDelta) { fallbackDelta = delta; fallbackMat = cornerMat[k]; }
        }
        if (fallbackMat === 0) {
            fallbackMat = world.dimension === DIM_MOON ? MOONSTONE
                        : (y < -100) ? LAVAROCK : (y < 100 ? DEEPSTONE : STONE);
        }

        const em=MC_EDGE_TABLE[ci];
        const verts=new Array(12);
        for(let e=0;e<12;e++){
            if(!(em&(1<<e))) continue;
            const a=EA[e],b=EB[e];
            verts[e]=interp(x+CX[a]*lod,y+CY[a]*lod,z+CZ[a]*lod,val[a],x+CX[b]*lod,y+CY[b]*lod,z+CZ[b]*lod,val[b]);
        }

        // Per-edge material: use the inside corner's voxel type if it's actually solid,
        // otherwise fall back to the closest-to-surface solid corner in this cell.
        const edgeMat = new Array(12);
        for (let e = 0; e < 12; e++) {
            if (!(em & (1 << e))) continue;
            const inside = val[EA[e]] >= 0.5 ? EA[e] : EB[e];
            edgeMat[e] = cornerMat[inside] > 0 ? cornerMat[inside] : fallbackMat;
        }

        const tris=MC_TRI_TABLE[ci];
        for(let i=0;i<tris.length;i+=3){
            const e0=tris[i], e1=tris[i+1], e2=tris[i+2];
            const v0=verts[e0], v1=verts[e1], v2=verts[e2];

            // Majority vote across the 3 edge inside-corner materials.
            const m0=edgeMat[e0], m1=edgeMat[e1], m2=edgeMat[e2];
            const triMat = (m0 === m1 || m0 === m2) ? m0 : m1;
            if (triMat === WOODPLANKS) continue; // box mesher handles this type
            if (!buckets.has(triMat)) buckets.set(triMat, { pos: [], uvs: [], col: [] });
            const bkt = buckets.get(triMat);

            bkt.pos.push(...v0, ...v1, ...v2);

            // Triplanar UV mapping: Pick projection plane based on triangle normal
            const nx = (v1[1]-v0[1])*(v2[2]-v0[2]) - (v1[2]-v0[2])*(v2[1]-v0[1]);
            const ny = (v1[2]-v0[2])*(v2[0]-v0[0]) - (v1[0]-v0[0])*(v2[2]-v0[2]);
            const nz = (v1[0]-v0[0])*(v2[1]-v0[1]) - (v1[1]-v0[1])*(v2[0]-v0[0]);
            const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);

            if (ay >= ax && ay >= az) {
                // Top/Bottom (XZ Plane)
                bkt.uvs.push(v0[0], v0[2], v1[0], v1[2], v2[0], v2[2]);
            } else if (ax >= az) {
                // Side (YZ Plane)
                bkt.uvs.push(v0[2], v0[1], v1[2], v1[1], v2[2], v2[1]);
            } else {
                // Side (XY Plane)
                bkt.uvs.push(v0[0], v0[1], v1[0], v1[1], v2[0], v2[1]);
            }

            for (const v of [v0, v1, v2]) {
                const br = brightnessAt(v[0], v[1], v[2]);
                bkt.col.push(br, br, br);
            }
        }
    }

    // ── Box voxel pass (WOODPLANKS and any future hard-voxel types) ──────────────
    // Emits explicit quads with face-culling instead of marching cubes,
    // producing perfectly flat cube faces. Winding verified per-face (CCW outward).
    const BOX_FACES = [
        { n:[1,0,0],  q:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]], uv:'zy' }, // +X
        { n:[-1,0,0], q:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]], uv:'zy' }, // -X
        { n:[0,1,0],  q:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]], uv:'xz' }, // +Y
        { n:[0,-1,0], q:[[0,0,1],[0,0,0],[1,0,0],[1,0,1]], uv:'xz' }, // -Y
        { n:[0,0,1],  q:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uv:'xy' }, // +Z
        { n:[0,0,-1], q:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uv:'xy' }, // -Z
    ];

    for (let vz = z0; vz < z0 + CHUNK; vz++)
    for (let vy = y0; vy < y0 + CHUNK; vy++)
    for (let vx = x0; vx < x0 + CHUNK; vx++) {
        if (getType(vx, vy, vz) !== WOODPLANKS) continue;
        if (!buckets.has(WOODPLANKS)) buckets.set(WOODPLANKS, { pos: [], uvs: [], col: [] });
        const bkt = buckets.get(WOODPLANKS);

        for (const { n, q, uv } of BOX_FACES) {
            if (solid(vx + n[0], vy + n[1], vz + n[2])) continue;

            const v0 = [vx+q[0][0], vy+q[0][1], vz+q[0][2]];
            const v1 = [vx+q[1][0], vy+q[1][1], vz+q[1][2]];
            const v2 = [vx+q[2][0], vy+q[2][1], vz+q[2][2]];
            const v3 = [vx+q[3][0], vy+q[3][1], vz+q[3][2]];

            bkt.pos.push(...v0,...v1,...v2, ...v0,...v2,...v3);

            for (const v of [v0,v1,v2,v0,v2,v3]) {
                const br = brightnessAt(v[0], v[1], v[2]);
                bkt.col.push(br, br, br);
            }

            if (uv === 'xz') {
                bkt.uvs.push(v0[0],v0[2], v1[0],v1[2], v2[0],v2[2], v0[0],v0[2], v2[0],v2[2], v3[0],v3[2]);
            } else if (uv === 'zy') {
                bkt.uvs.push(v0[2],v0[1], v1[2],v1[1], v2[2],v2[1], v0[2],v0[1], v2[2],v2[1], v3[2],v3[1]);
            } else {
                bkt.uvs.push(v0[0],v0[1], v1[0],v1[1], v2[0],v2[1], v0[0],v0[1], v2[0],v2[1], v3[0],v3[1]);
            }
        }
    }

    const out = [];
    for (const [type, b] of buckets) {
        if (b.pos.length === 0) continue;
        out.push({
            type,
            pos: new Float32Array(b.pos),
            uvs: new Float32Array(b.uvs),
            col: new Float32Array(b.col),
        });
    }
    return out;
}

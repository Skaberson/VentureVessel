import { VoxelWorld, CHUNK, syncBiomeParams } from './world.js';
import { buildChunkMesh } from './building/mesher.js';

// The worker maintains its own "shadow" copy of the world data
const world = new VoxelWorld();
let voxelMode = false;

self.onmessage = function(e) {
    const { type, cx, cy, cz, lod, fullbright, x, y, z, v, sx, sz, inv, mx, mz, dim } = e.data;

    if (type === 'setVoxelMode') {
        voxelMode = e.data.voxelMode;
    }

    if (type === 'setDimension') {
        world.dimension = dim;
    }

    if (type === 'initBiome') {
        syncBiomeParams(sx, sz, inv, mx, mz);
    }

    if (type === 'setVoxel') {
        world.set(x, y, z, v);
        world.updateLightAt(x, y, z);
    }

    if (type === 'buildMesh') {
        // Ensure the full 3D neighborhood (26 neighbors) is generated before meshing.
        // This prevents "tree-spawn side effects" from occurring while we are
        // reading data for the current chunk, which causes mesh gaps.
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                world.get((cx + dx) * CHUNK, (cy + dy) * CHUNK, (cz + dz) * CHUNK);
            }
            }
        }

        const results = buildChunkMesh(world, cx, cy, cz, fullbright, lod || 1, voxelMode);

        // Use Transferables to move the geometry data without copying it.
        const transferables = [];
        for (const res of results) {
            if (res) {
                transferables.push(res.pos.buffer, res.uvs.buffer, res.col.buffer);
            }
        }

        self.postMessage({ 
            type: 'meshResult', cx, cy, cz, results, lod 
        }, transferables);
    }
};
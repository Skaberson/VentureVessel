// DDA voxel traversal (Amanatides & Woo).
// Returns { x, y, z, face } of the first solid voxel hit, or null.
// `face` is the [nx,ny,nz] normal of the face that was entered.
// Water voxels are skipped — they are non-solid and cannot be mined.
const WATER = 22;
export function raycastVoxel(world, origin, direction, maxDist = 12) {
    const dx = direction.x, dy = direction.y, dz = direction.z;

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dx >= 0 ? 1 : -1;
    const stepY = dy >= 0 ? 1 : -1;
    const stepZ = dz >= 0 ? 1 : -1;

    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    // Distance to the first voxel boundary from origin
    let tMaxX = dx !== 0 ? (stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) / Math.abs(dx) : Infinity;
    let tMaxY = dy !== 0 ? (stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) / Math.abs(dy) : Infinity;
    let tMaxZ = dz !== 0 ? (stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) / Math.abs(dz) : Infinity;

    let face = null;
    let t = 0;

    while (t < maxDist) {
        const t0 = world.get(x, y, z);
        if (t0 && t0 !== WATER) return { x, y, z, face };

        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            t = tMaxX; x += stepX; tMaxX += tDeltaX;
            face = [-stepX, 0, 0];
        } else if (tMaxY < tMaxZ) {
            t = tMaxY; y += stepY; tMaxY += tDeltaY;
            face = [0, -stepY, 0];
        } else {
            t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ;
            face = [0, 0, -stepZ];
        }
    }

    return null;
}

import * as THREE from 'three';

const PARTICLE_NAMES = {
    1: 'forest/grass', 2: 'forest/dirt', 3: 'forest/stone', 4: 'forest/wood', 5: 'forest/leaves',
    6: 'desert/sand', 7: 'desert/sandstone', 8: 'desert/cactus', 9: 'snow/ice', 10: 'snow/pfrost',
    11: 'snow/igrass', 12: 'snow/pinewood', 13: 'snow/iceleaves',
    14: 'forest/dirt',
    15: 'forest/stone',
    16: 'forest/stone'
};
const PARTICLE_POOL_SIZE = 150;
const PARTICLE_HALF_SIZE = 0.18;

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

const particlePools = {};
const _pRight = new THREE.Vector3();
const _pUp    = new THREE.Vector3();

let _scene, _camera, _world, _loadTex;

export function initParticles(scene, camera, world, loadTex) {
    _scene = scene;
    _camera = camera;
    _world = world;
    _loadTex = loadTex;
}

function getParticlePool(voxelType) {
    if (particlePools[voxelType]) return particlePools[voxelType];
    const name = PARTICLE_NAMES[voxelType] || 'dirt';
    const N = PARTICLE_POOL_SIZE;

    const pos  = new Float32Array(N * 3);
    const vel  = new Float32Array(N * 3);
    const life = new Float32Array(N);

    const vPos  = new Float32Array(N * 4 * 3);
    const vUv   = new Float32Array(N * 4 * 2);
    const vLife = new Float32Array(N * 4);
    const idx   = new Uint16Array(N * 6);

    for (let i = 0; i < N; i++) {
        const u = i * 8;
        vUv[u+0]=0; vUv[u+1]=1;
        vUv[u+2]=1; vUv[u+3]=1;
        vUv[u+4]=1; vUv[u+5]=0;
        vUv[u+6]=0; vUv[u+7]=0;
    }

    for (let i = 0; i < N; i++) {
        const ii = i * 6, vi = i * 4;
        idx[ii+0]=vi; idx[ii+1]=vi+1; idx[ii+2]=vi+2;
        idx[ii+3]=vi; idx[ii+4]=vi+2; idx[ii+5]=vi+3;
    }

    for (let i = 0; i < N * 4; i++) vPos[i*3+1] = -1000;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vPos,  3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(vUv,   2));
    geo.setAttribute('life',     new THREE.BufferAttribute(vLife, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: _loadTex(`assets/particles/${name}.png`) } },
        vertexShader:   PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    _scene.add(mesh);

    const pool = { pos, vel, life, vPos, vLife, geo, cursor: 0 };
    particlePools[voxelType] = pool;
    return pool;
}

export function spawnParticles(voxelType, cx, cy, cz, count, speed) {
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

export function updateParticles(dt) {
    _pRight.setFromMatrixColumn(_camera.matrixWorld, 0);
    _pUp.setFromMatrixColumn(_camera.matrixWorld, 1);
    const rx = _pRight.x * PARTICLE_HALF_SIZE, ry = _pRight.y * PARTICLE_HALF_SIZE, rz = _pRight.z * PARTICLE_HALF_SIZE;
    const ux = _pUp.x   * PARTICLE_HALF_SIZE, uy = _pUp.y   * PARTICLE_HALF_SIZE, uz = _pUp.z   * PARTICLE_HALF_SIZE;

    for (const pool of Object.values(particlePools)) {
        let active = false;
        for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
            const vi = i * 4 * 3;
            const li = i * 4;

            if (pool.life[i] <= 0) continue;
            active = true;

            pool.life[i] -= dt * 0.5;
            if (pool.life[i] <= 0) {
                pool.life[i] = 0;
                pool.vPos[vi+1] = pool.vPos[vi+4] = pool.vPos[vi+7] = pool.vPos[vi+10] = -1000;
                pool.vLife[li] = pool.vLife[li+1] = pool.vLife[li+2] = pool.vLife[li+3] = 0;
                continue;
            }

            pool.vel[i*3+1] -= 16 * dt;

            const px = pool.pos[i*3], py = pool.pos[i*3+1], pz = pool.pos[i*3+2];
            const dx = pool.vel[i*3] * dt;
            const dy = pool.vel[i*3+1] * dt;
            const dz = pool.vel[i*3+2] * dt;

            const nx = px + dx;
            if (_world.get(Math.floor(nx), Math.floor(py), Math.floor(pz))) {
                pool.vel[i*3] *= -0.5;
            } else {
                pool.pos[i*3] = nx;
            }

            const curX = pool.pos[i*3];
            const ny = py + dy;
            if (_world.get(Math.floor(curX), Math.floor(ny), Math.floor(pz))) {
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
            if (_world.get(Math.floor(curX), Math.floor(curY), Math.floor(nz))) {
                pool.vel[i*3+2] *= -0.5;
            } else {
                pool.pos[i*3+2] = nz;
            }

            const qx = pool.pos[i*3], qy = pool.pos[i*3+1], qz = pool.pos[i*3+2];
            pool.vPos[vi+0]  = qx - rx + ux; pool.vPos[vi+1]  = qy - ry + uy; pool.vPos[vi+2]  = qz - rz + uz;
            pool.vPos[vi+3]  = qx + rx + ux; pool.vPos[vi+4]  = qy + ry + uy; pool.vPos[vi+5]  = qz + rz + uz;
            pool.vPos[vi+6]  = qx + rx - ux; pool.vPos[vi+7]  = qy + ry - uy; pool.vPos[vi+8]  = qz + rz - uz;
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

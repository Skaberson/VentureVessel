import * as THREE from 'three';
import { DIM_MOON, WOODPLANKS, WORKBENCH } from '../world/world.js';

const GRAVITY    =  22;
const JUMP_SPEED =   9;
const MOVE_SPEED =   8;
const RUN_SPEED  =  13;
const PLAYER_H   =  1.8;
export const EYE_HEIGHT =  1.62;
const RADIUS     =  0.35;
const STEP_HEIGHT = 0.6;  // max slope/step the player auto-climbs

const CAM_PITCH_MIN = -Math.PI * 0.499;
const CAM_PITCH_MAX =  Math.PI * 0.499;
const MOUSE_SENS    =  0.0022;

const _gravityScratch = new THREE.Vector3();
const _moveScratch    = new THREE.Vector3();
const _fwdScratch     = new THREE.Vector3();
const _rightScratch   = new THREE.Vector3();
const _quatScratch = new THREE.Quaternion();

// Probe offsets relative to feet — capsule shape
const PROBES = [];
(function () {
    const r = RADIUS, h = PLAYER_H;
    for (const [ox, oz] of [[0,0],[r,0],[-r,0],[0,r],[0,-r]]) {
        PROBES.push([ox, r,       oz]); // bottom sphere
        PROBES.push([ox, h - r,   oz]); // top sphere
        PROBES.push([ox, h,       oz]); // very top of head
        PROBES.push([ox, h * 0.5, oz]); // waist (walls)
    }
})();

// ── Density field ─────────────────────────────────────────────────────────────

// 3×3×3 Gaussian weights approximating the two-pass separable kernel used by mesher.js.
// Two separable passes with exponent 0.8 give an effective σ ≈ √2× wider, which a
// single-pass 3D kernel matches by halving the exponent to 0.4.
const GAUSS_OFF = [], GAUSS_W = [];
let GAUSS_SUM = 0;
for (let dz = -1; dz <= 1; dz++)
for (let dy = -1; dy <= 1; dy++)
for (let dx = -1; dx <= 1; dx++) {
    const w = Math.exp(-(dx*dx + dy*dy + dz*dz) * 0.4);
    GAUSS_OFF.push(dx, dy, dz);
    GAUSS_W.push(w);
    GAUSS_SUM += w;
}

// Gaussian-blurred solidity at an integer voxel coordinate
function gaussSolidity(world, ix, iy, iz) {
    let sum = 0;
    for (let i = 0; i < GAUSS_W.length; i++) {
        if (world.isSolid(ix + GAUSS_OFF[i*3], iy + GAUSS_OFF[i*3+1], iz + GAUSS_OFF[i*3+2]))
            sum += GAUSS_W[i];
    }
    return sum / GAUSS_SUM;
}

let _voxelMode = false;
export function setCollisionMode(voxel) { _voxelMode = voxel; }

export function sampleDensity(world, x, y, z) { return density(world, x, y, z); }

function density(world, x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);

    // WOODPLANKS / WORKBENCH: direct containment check before any interpolation.
    // Trilinear blending across 8 corners can push the density below 0.5 even
    // when the sample point is physically inside the voxel, causing missed hits.
    const _centerType = world.get(ix, iy, iz);
    if (_centerType === WOODPLANKS || _centerType === WORKBENCH) return 1;

    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ifx = 1-fx, ify = 1-fy, ifz = 1-fz;

    const s = _voxelMode
        ? (vx, vy, vz) => world.isSolid(vx, vy, vz) ? 1 : 0
        : (vx, vy, vz) => {
            // Treat plank/workbench corners as 0 so they don't bleed density into
            // adjacent smooth terrain — their collision is handled by the containment check.
            const _ct = world.get(vx, vy, vz);
            if (_ct === WOODPLANKS || _ct === WORKBENCH) return 0;
            return gaussSolidity(world, vx, vy, vz);
        };

    return s(ix,   iy,   iz  ) * ifx*ify*ifz
         + s(ix+1, iy,   iz  ) * fx *ify*ifz
         + s(ix,   iy+1, iz  ) * ifx*fy *ifz
         + s(ix+1, iy+1, iz  ) * fx *fy *ifz
         + s(ix,   iy,   iz+1) * ifx*ify*fz
         + s(ix+1, iy,   iz+1) * fx *ify*fz
         + s(ix,   iy+1, iz+1) * ifx*fy *fz
         + s(ix+1, iy+1, iz+1) * fx *fy *fz;
}

export function overlaps(world, px, py, pz) {
    for (const [ox, oy, oz] of PROBES)
        if (density(world, px+ox, py+oy, pz+oz) > 0.5) return true;
    return false;
}

// ── Player ────────────────────────────────────────────────────────────────────

export class Player {
    constructor(world) {
        this.world    = world;
        // Spawn well above max terrain (surface peaks around y=76)
        this.pos      = new THREE.Vector3(8, 184, 8);
        this.vel      = new THREE.Vector3();
        this.yaw      = 0;
        this.pitch    = 0;
        this.bobTimer = 0;
        this.onGround = false;
        this.stepOffset = 0; // visual smoothing for step-ups

        this.update = this.update.bind(this);
        this._sweepAxis = this._sweepAxis.bind(this);
        this.getEyePosition = this.getEyePosition.bind(this);
        this.getCameraRotation = this.getCameraRotation.bind(this);

        const geo = new THREE.CapsuleGeometry(RADIUS, PLAYER_H - RADIUS*2, 4, 8);
        const mat = new THREE.MeshPhongMaterial({ color: 0xee6622 });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.castShadow = true;
        this.mesh.visible    = false;
    }

    update(dt, input, isFlying = false, inceptionMode = false, speedMultiplier = 1, inWater = false) {
        // Emergency Unstuck: if player is already inside a block, nudge them upwards
        // to the nearest clear space (up to 2 blocks).
        if (overlaps(this.world, this.pos.x, this.pos.y, this.pos.z)) {
            for (let dy = 0.1; dy <= 2.0; dy += 0.1) {
                if (!overlaps(this.world, this.pos.x, this.pos.y + dy, this.pos.z)) {
                    this.pos.y += dy;
                    this.vel.y = 0;
                    break;
                }
            }
        }

        // Look
        const { dx, dy } = input.flushMouse();
        this.yaw   -= dx * MOUSE_SENS;
        this.pitch -= dy * MOUSE_SENS;
        if (!inceptionMode) {
            this.pitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, this.pitch));
        }

        // Input vector
        const gpMoveX = input.getMoveX();
        const gpMoveY = input.getMoveY();
        const mz = (input.isDown('KeyS')?1:0) - (input.isDown('KeyW')?1:0) + gpMoveY;
        const mx = (input.isDown('KeyD')?1:0) - (input.isDown('KeyA')?1:0) + gpMoveX;

        const isRunning = (input.isDown('ControlLeft') || input.isDown('ControlRight')) && !isFlying;
        const speed = (isRunning ? RUN_SPEED : MOVE_SPEED) * speedMultiplier * (inWater ? 0.6 : 1.0);

        if (inceptionMode) {
            _quatScratch.setFromEuler(this.getCameraRotation());
            
            // Calculate 3D movement relative to camera orientation
            _fwdScratch.set(0, 0, -1).applyQuaternion(_quatScratch);
            _rightScratch.set(1, 0, 0).applyQuaternion(_quatScratch);
            _moveScratch.set(0, 0, 0)
                .addScaledVector(_fwdScratch, -mz) // - because W is -1
                .addScaledVector(_rightScratch, mx);
            
            if (_moveScratch.length() > 0) _moveScratch.normalize().multiplyScalar(speed);

            // Calculate gravity direction (Down relative to camera)
        _gravityScratch.set(0, -1, 0);
            _gravityScratch.applyQuaternion(_quatScratch);

            // Preserve the part of velocity that is aligned with gravity (falling/jumping)
            const vAlongG = this.vel.dot(_gravityScratch);
            this.vel.copy(_moveScratch).addScaledVector(_gravityScratch, vAlongG);
        } else {
            // Standard horizontal movement
            const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
            let vx = fwdX*mz + fwdZ*mx, vz = fwdZ*mz - fwdX*mx;
            const spd = Math.sqrt(vx*vx + vz*vz);
            if (spd > 0) { vx = vx/spd*speed; vz = vz/spd*speed; }
            this.vel.x = vx;
            this.vel.z = vz;
            _gravityScratch.set(0, -1, 0);
        }

        // Jump & gravity (skip gravity when flying)
        if (!isFlying) {
            if (inWater) {
                // Swimming: space rises, no input sinks slowly
                const SWIM_UP   = 5.0;
                const SINK_RATE = 2.0;
                const DRAG      = 6.0;
                if (input.isDown('Space') || input.isJumping()) {
                    this.vel.y += (SWIM_UP - this.vel.y) * Math.min(DRAG * dt, 1.0);
                } else {
                    this.vel.y += (-SINK_RATE - this.vel.y) * Math.min(DRAG * dt, 1.0);
                }
                this.onGround = false;
            } else {
                // Note: jumping is still Y-biased in the current collision engine
                if ((input.isDown('Space') || input.isJumping()) && this.onGround) {
                    this.vel.y = JUMP_SPEED;
                    this.onGround = false;
                }
                this.onGround = false;
                const currentGravity = this.world.dimension === DIM_MOON ? GRAVITY * 0.5 : GRAVITY;
                this.vel.addScaledVector(_gravityScratch, currentGravity * dt);
                if (this.vel.y < -100) this.vel.y = -100; // terminal velocity
            }
        }

        // Axis-separated swept movement (Minecraft-style)
        // Each axis is subdivided into steps no larger than 0.5 to prevent tunnelling
        this._sweepAxis('x', this.vel.x * dt);
        this._sweepAxis('y', this.vel.y * dt);
        this._sweepAxis('z', this.vel.z * dt);

        // Update head bobbing timer
        const horizontalSpeed = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
        if (this.onGround && !isFlying && horizontalSpeed > 0.1) {
            this.bobTimer += dt * 14; // Controls the speed of the bob
        } else {
            this.bobTimer *= Math.exp(-dt * 10); // Smoothly decay the bob when stopping
        }

        this.stepOffset *= Math.exp(-dt * 12); // smoothly decay step visual offset
        this.mesh.position.set(this.pos.x, this.pos.y + PLAYER_H*0.5 + this.stepOffset, this.pos.z);
    }

    _sweepAxis(axis, delta) {
        if (!this.pos) {
            console.warn('Player._sweepAxis called before pos was initialized');
            return;
        }
        if (delta === 0) return;

        const MAX_STEP = 0.4;
        const steps = Math.ceil(Math.abs(delta) / MAX_STEP);
        const stride = delta / steps;

        for (let s = 0; s < steps; s++) {
            const prev = this.pos[axis];
            this.pos[axis] += stride;

            if (overlaps(this.world, this.pos.x, this.pos.y, this.pos.z)) {
                this.pos[axis] = prev;

                if (axis === 'y') {
                    if (stride < 0) this.onGround = true;
                    this.vel.y = 0;
                    break; // Stop vertical movement for this frame
                } else {
                    // Try stepping up over a smooth slope
                    let climbed = false;
                    let climbedAmount = 0;
                    for (let up = 0.1; up <= STEP_HEIGHT; up += 0.1) {
                        this.pos.y  += 0.1;
                        climbedAmount += 0.1;
                        this.pos[axis] += stride;
                        if (!overlaps(this.world, this.pos.x, this.pos.y, this.pos.z)) {
                            climbed = true;
                            this.stepOffset -= climbedAmount; // absorb the visual jump
                            break;
                        }
                        this.pos[axis] -= stride;
                        this.pos.y  -= 0.1;
                        climbedAmount -= 0.1;
                    }
                    if (!climbed) {
                        this.vel[axis] = 0;
                        break; // remaining strides in this axis are blocked
                    }
                }
            }
        }
    }

    getEyePosition() {
        // Apply sine/cosine wave for vertical and horizontal sway
        const bobY = Math.sin(this.bobTimer) * 0.06;
        const bobX = Math.cos(this.bobTimer * 0.5) * 0.03;
        return new THREE.Vector3(this.pos.x + bobX, this.pos.y + EYE_HEIGHT + bobY + this.stepOffset, this.pos.z);
    }

    getCameraRotation() {
        return new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    }
}

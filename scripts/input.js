const GAMEPAD_DEADZONE = 0.2;
const GAMEPAD_LOOK_SENS = 24;
const GAMEPAD_LOOK_SMOOTH = 0.22;

export class Input {
    constructor() {
        this._keys     = new Set();
        this._dx       = 0;
        this._dy       = 0;
        this._clicked   = false;
        this._secondaryClicked = false;
        this.mouseHeld  = false;
        this.locked     = false;
        this._gamepad   = null;
        this._gpAxes    = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 };
        this._gpMine    = false;
        this._gpLookDx  = 0;
        this._gpLookDy  = 0;
        this._lastJumpTime = 0;
        this._doubleJump = false;

        window.addEventListener('keydown', e => {
            this._keys.add(e.code);
            // Prevent space from scrolling the page
            if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') e.preventDefault();
        });
        window.addEventListener('keyup', e => this._keys.delete(e.code));

        window.addEventListener('mousemove', e => {
            if (!this.locked) return;
            this._dx += e.movementX;
            this._dy += e.movementY;
        });

        window.addEventListener('mousedown', e => {
            if (!this.locked) return;
            if (e.button === 0) { this._clicked = true; this.mouseHeld = true; }
            if (e.button === 2) { this._secondaryClicked = true; }
        });
        window.addEventListener('contextmenu', e => e.preventDefault());

        window.addEventListener('mouseup', e => {
            if (e.button === 0) this.mouseHeld = false;
        });

        window.addEventListener('gamepadconnected', e => {
            this._gamepad = e.gamepad;
        });
        window.addEventListener('gamepaddisconnected', e => {
            if (this._gamepad && this._gamepad.index === e.gamepad.index) this._gamepad = null;
        });

        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement !== null;
        });
    }

    static _normalizeAxis(value) {
        return Math.abs(value) < GAMEPAD_DEADZONE ? 0 : value;
    }

    update() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let gp = null;
        for (const pad of gamepads) {
            if (pad && pad.connected) {
                gp = pad;
                break;
            }
        }

        if (!gp) {
            this._gamepad = null;
            this._gpAxes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 };
            this._gpMine = false;
            this._gpLookDx = 0;
            this._gpLookDy = 0;
            return;
        }

        this._gamepad = gp;
        this._gpAxes.leftX  = Input._normalizeAxis(gp.axes[0] ?? 0);
        this._gpAxes.leftY  = Input._normalizeAxis(gp.axes[1] ?? 0);
        this._gpAxes.rightX = Input._normalizeAxis(gp.axes[2] ?? 0);
        this._gpAxes.rightY = Input._normalizeAxis(gp.axes[3] ?? 0);

        const trigger = gp.buttons[7];
        this._gpMine = !!(trigger && (trigger.pressed || trigger.value > 0.5));
        const jump = gp.buttons[0];
        const wasJumping = this._gpJump;
        this._gpJump = !!(jump && (jump.pressed || jump.value > 0.5));
        
        if (this._gpJump && !wasJumping) {
            this._detectJumpPress();
        }

        const targetDx = this.getLookX() * GAMEPAD_LOOK_SENS;
        const targetDy = this.getLookY() * GAMEPAD_LOOK_SENS;
        this._gpLookDx += (targetDx - this._gpLookDx) * GAMEPAD_LOOK_SMOOTH;
        this._gpLookDy += (targetDy - this._gpLookDy) * GAMEPAD_LOOK_SMOOTH;
    }

    _detectJumpPress() {
        const now = performance.now();
        if (now - this._lastJumpTime < 500) {
            this._doubleJump = true;
        }
        this._lastJumpTime = now;
    }

    checkDoubleJump() {
        const result = this._doubleJump;
        this._doubleJump = false;
        return result;
    }

    isDown(code) { return this._keys.has(code); }

    hasGamepad() { return !!this._gamepad; }

    getMoveX() { return this._gpAxes.leftX; }
    getMoveY() { return this._gpAxes.leftY; }
    getLookX() { return this._gpAxes.rightX; }
    getLookY() { return this._gpAxes.rightY; }
    isMining() { return this._gpMine; }
    isJumping() { return this._gpJump; }
    isFlyUp() { return this.isDown('Space') || (this._gamepad && this._gamepad.buttons[0] && this._gamepad.buttons[0].pressed); }
    isFlyDown() { return this.isDown('ShiftLeft') || this.isDown('ShiftRight') || (this._gamepad && this._gamepad.buttons[1] && this._gamepad.buttons[1].pressed); }

    flushMouse() {
        const r = {
            dx: this._dx + this._gpLookDx,
            dy: this._dy + this._gpLookDy
        };
        this._dx = this._dy = 0;
        return r;
    }

    flushClick() {
        const c = this._clicked;
        this._clicked = false;
        return c;
    }

    flushSecondaryClick() {
        const c = this._secondaryClicked;
        this._secondaryClicked = false;
        return c;
    }
}

/// <reference types="p5/global" />

/**
 * Pluggable camera effects. Each effect implements the `CameraEffect`
 * interface, so adding new effects later (hit-stop, chromatic aberration,
 * letterbox, ...) only requires creating a new class and registering it.
 */

import {
    Vec2,
    ShakeOptions,
    FlashOptions,
    FadeOptions,
    ZoomPunchOptions,
    EasingFn
} from './CameraTypes.js';

export interface CameraEffect {
    /** If false, the Camera will prune it from its active list. */
    readonly alive: boolean;
    update(dt: number): void;
    /** Optional world-space offset contributed to the camera position. */
    getOffset?(): Vec2;
    /** Optional rotation (radians) contributed to the camera rotation. */
    getRotation?(): number;
    /** Optional zoom multiplier contributed on top of the camera zoom. */
    getZoomFactor?(): number;
    /** Optional screen-space overlay (drawn after the world is flattened). */
    drawOverlay?(viewW: number, viewH: number): void;
}

/* ============================================================================
 *  EASING
 * ========================================================================== */

export const Easing = {
    linear:    (t: number) => t,
    easeInQuad:  (t: number) => t * t,
    easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
    easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeOutBack: (t: number) => {
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
} as const;


/* ============================================================================
 *  SHAKE (trauma-based)
 *  Trauma is a [0..1] value that decays over time. Offsets are proportional
 *  to trauma^2 (Squirrel Eiserloh's approach), which produces strong shakes
 *  that taper off smoothly instead of a fixed jitter.
 * ========================================================================== */

export class ShakeEffect implements CameraEffect {
    private _trauma = 0;
    private _amplitude: number;
    private _decay: number;
    private _rotational: boolean;
    private _maxAngle: number;

    private _offsetX = 0;
    private _offsetY = 0;
    private _angle = 0;

    constructor(options: ShakeOptions = {}) {
        this._amplitude  = options.amplitude ?? 16;
        this._decay      = options.decay ?? 1.2;
        this._rotational = options.rotational ?? false;
        this._maxAngle   = options.maxAngle ?? 0.05;
    }

    /** Always alive — the camera owns this effect and never prunes it. */
    get alive(): boolean { return true; }

    /** Add trauma to the shake (clamped to 1). Non-destructive stacking. */
    addTrauma(amount: number): void {
        this._trauma = Math.min(1, this._trauma + amount);
    }

    /** Replace shake parameters without resetting current trauma. */
    configure(options: ShakeOptions): void {
        if (options.amplitude !== undefined)  this._amplitude  = options.amplitude;
        if (options.decay !== undefined)      this._decay      = options.decay;
        if (options.rotational !== undefined) this._rotational = options.rotational;
        if (options.maxAngle !== undefined)   this._maxAngle   = options.maxAngle;
    }

    reset(): void {
        this._trauma = 0;
        this._offsetX = this._offsetY = this._angle = 0;
    }

    get trauma(): number { return this._trauma; }

    update(dt: number): void {
        if (this._trauma <= 0) {
            this._offsetX = this._offsetY = this._angle = 0;
            return;
        }
        const t2 = this._trauma * this._trauma;
        this._offsetX = this._amplitude * t2 * (Math.random() * 2 - 1);
        this._offsetY = this._amplitude * t2 * (Math.random() * 2 - 1);
        this._angle   = this._rotational ? this._maxAngle * t2 * (Math.random() * 2 - 1) : 0;
        this._trauma  = Math.max(0, this._trauma - this._decay * dt);
    }

    getOffset(): Vec2 { return { x: this._offsetX, y: this._offsetY }; }
    getRotation(): number { return this._angle; }
}


/* ============================================================================
 *  FLASH (short color pulse)
 * ========================================================================== */

export class FlashEffect implements CameraEffect {
    private _r = 255; private _g = 255; private _b = 255;
    private _peak = 255;
    private _fadeIn = 0;
    private _hold = 0.05;
    private _fadeOut = 0.25;
    private _t = 0;
    private _alive = false;
    private _onComplete: (() => void) | null = null;

    constructor() {}

    get alive(): boolean { return this._alive; }

    trigger(options: FlashOptions = {}): void {
        const c = options.color ?? [255, 255, 255];
        this._r = c[0]; this._g = c[1]; this._b = c[2];
        this._peak    = options.alpha ?? 255;
        this._fadeIn  = options.fadeIn ?? 0;
        this._hold    = options.hold ?? 0.05;
        this._fadeOut = options.fadeOut ?? 0.25;
        this._onComplete = options.onComplete ?? null;
        this._t = 0;
        this._alive = true;
    }

    update(dt: number): void {
        if (!this._alive) return;
        this._t += dt;
        if (this._t >= this._fadeIn + this._hold + this._fadeOut) {
            this._alive = false;
            if (this._onComplete) { const cb = this._onComplete; this._onComplete = null; cb(); }
        }
    }

    drawOverlay(viewW: number, viewH: number): void {
        if (!this._alive) return;
        let alpha = this._peak;
        if (this._t < this._fadeIn) {
            alpha = this._peak * (this._t / Math.max(0.0001, this._fadeIn));
        } else if (this._t > this._fadeIn + this._hold) {
            const k = (this._t - this._fadeIn - this._hold) / Math.max(0.0001, this._fadeOut);
            alpha = this._peak * (1 - k);
        }
        noStroke();
        fill(this._r, this._g, this._b, alpha);
        rect(0, 0, viewW, viewH);
    }
}


/* ============================================================================
 *  FADE (persistent curtain)
 *  Unlike Flash, a Fade holds its target alpha indefinitely until you start
 *  another fade. Useful for room transitions and game-over screens.
 * ========================================================================== */

export class FadeEffect implements CameraEffect {
    private _r = 0; private _g = 0; private _b = 0;
    private _from = 0;
    private _to = 255;
    private _duration = 0.5;
    private _t = 0;
    private _ease: EasingFn = Easing.easeInOutQuad;
    private _hold = true;
    private _running = false;
    private _currentAlpha = 0;
    private _onComplete: (() => void) | null = null;

    get alive(): boolean { return this._running || (this._hold && this._currentAlpha > 0); }

    start(options: FadeOptions = {}): void {
        const c = options.color ?? [0, 0, 0];
        this._r = c[0]; this._g = c[1]; this._b = c[2];
        this._from     = options.from ?? this._currentAlpha;
        this._to       = options.to ?? 255;
        this._duration = options.duration ?? 0.5;
        this._ease     = options.easing ?? Easing.easeInOutQuad;
        this._hold     = options.hold ?? true;
        this._onComplete = options.onComplete ?? null;
        this._t = 0;
        this._running = true;
        this._currentAlpha = this._from;
    }

    /** Force-clear the curtain instantly. */
    clear(): void {
        this._running = false;
        this._currentAlpha = 0;
        this._onComplete = null;
    }

    get alpha(): number { return this._currentAlpha; }

    update(dt: number): void {
        if (!this._running) return;
        this._t += dt;
        const k = Math.min(1, this._t / Math.max(0.0001, this._duration));
        this._currentAlpha = this._from + (this._to - this._from) * this._ease(k);
        if (k >= 1) {
            this._running = false;
            if (!this._hold) this._currentAlpha = 0;
            if (this._onComplete) { const cb = this._onComplete; this._onComplete = null; cb(); }
        }
    }

    drawOverlay(viewW: number, viewH: number): void {
        if (this._currentAlpha <= 0) return;
        noStroke();
        fill(this._r, this._g, this._b, this._currentAlpha);
        rect(0, 0, viewW, viewH);
    }
}


/* ============================================================================
 *  ZOOM PUNCH
 *  Short spike in zoom (out then back in) that's handy for impacts and
 *  dialog emphasis.
 * ========================================================================== */

export class ZoomPunchEffect implements CameraEffect {
    private _amount = 0;
    private _duration = 0.25;
    private _t = 0;
    private _alive = false;
    private _ease: EasingFn = Easing.easeOutCubic;

    get alive(): boolean { return this._alive; }

    trigger(options: ZoomPunchOptions): void {
        this._amount   = options.amount;
        this._duration = options.duration ?? 0.25;
        this._ease     = options.easing ?? Easing.easeOutCubic;
        this._t = 0;
        this._alive = true;
    }

    update(dt: number): void {
        if (!this._alive) return;
        this._t += dt;
        if (this._t >= this._duration) this._alive = false;
    }

    getZoomFactor(): number {
        if (!this._alive) return 1;
        const k = Math.min(1, this._t / this._duration);
        // Bell curve: 0 -> 1 -> 0 via sin(pi * k).
        const bell = Math.sin(Math.PI * k);
        return 1 + this._amount * this._ease(bell);
    }
}

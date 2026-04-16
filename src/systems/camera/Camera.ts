/// <reference types="p5/global" />

/**
 * Camera
 * Usage:
 *   const cam = new Camera({ viewport: { w: 800, h: 600 }, follow: { mode: 'deadzone' } });
 *   cam.setTarget(player);
 *   cam.setBounds({ x: 0, y: 0, w: 2048, h: 1536 });
 *
 *   // in draw():
 *   background(0);
 *   cam.update();
 *   cam.apply();
 *     drawWorld();
 *   cam.reset();
 *   drawHUD();
 */

import {
    Vec2,
    Bounds,
    Viewport,
    Trackable,
    FollowMode,
    FollowOptions,
    ShakeOptions,
    FlashOptions,
    FadeOptions,
    ZoomPunchOptions,
    CameraEventName,
    CameraEvents
} from './CameraTypes.js';
import {
    CameraEffect,
    ShakeEffect,
    FlashEffect,
    FadeEffect,
    ZoomPunchEffect
} from './CameraEffects.js';

export interface CameraConfig {
    viewport?: Viewport;
    position?: Vec2;
    zoom?: number;
    rotation?: number;
    bounds?: Bounds | null;
    follow?: FollowOptions;
    pixelSnap?: boolean;
}

export class Camera {

    /* -- STATE -------------------------------------------------------- */

    public x: number;
    public y: number;
    public zoom: number;
    public rotation: number;

    public viewport: Viewport;
    public bounds: Bounds | null = null;
    public pixelSnap: boolean;

    private _target: Trackable | null = null;
    private _prevTargetPos: Vec2 = { x: 0, y: 0 };
    private _targetVelocity: Vec2 = { x: 0, y: 0 };
    private _followOpts: Required<FollowOptions>;
    private _velX = 0;
    private _velY = 0;

    private _targetZoom: number;
    private _zoomLerpSpeed = 6;

    /* -- EFFECTS ------------------------------------------------------ */

    private _shake = new ShakeEffect();
    private _flash = new FlashEffect();
    private _fade = new FadeEffect();
    private _zoomPunch = new ZoomPunchEffect();
    private _custom: CameraEffect[] = [];

    /* -- EVENTS ------------------------------------------------------- */

    private _listeners: { [K in CameraEventName]?: Array<CameraEvents[K]> } = {};

    /* ================================================================ */

    constructor(config: CameraConfig = {}) {
        this.viewport = config.viewport ?? { w: 800, h: 600 };
        this.x = config.position?.x ?? 0;
        this.y = config.position?.y ?? 0;
        this.zoom = config.zoom ?? 1;
        this.rotation = config.rotation ?? 0;
        this.bounds = config.bounds ?? null;
        this.pixelSnap = config.pixelSnap ?? true;

        this._targetZoom = this.zoom;

        this._followOpts = {
            mode: config.follow?.mode ?? 'lerp',
            lerpSpeed: config.follow?.lerpSpeed ?? 8,
            smoothTime: config.follow?.smoothTime ?? 0.2,
            deadZone: config.follow?.deadZone ?? { w: 64, h: 48 },
            offset: config.follow?.offset ?? { x: 0, y: 0 },
            lookahead: config.follow?.lookahead ?? { factor: 0, max: 0 }
        };
    }

    /* ================================================================
     *  TARGET & FOLLOW
     * ================================================================ */

    setTarget(target: Trackable | null): this {
        this._target = target;
        if (target) {
            this._prevTargetPos.x = target.x;
            this._prevTargetPos.y = target.y;
        }
        this._emit('targetChanged', target);
        return this;
    }

    getTarget(): Trackable | null { return this._target; }

    setFollow(options: FollowOptions): this {
        if (options.mode !== undefined) this._followOpts.mode = options.mode;
        if (options.lerpSpeed !== undefined) this._followOpts.lerpSpeed = options.lerpSpeed;
        if (options.smoothTime !== undefined) this._followOpts.smoothTime = options.smoothTime;
        if (options.deadZone !== undefined) this._followOpts.deadZone = options.deadZone;
        if (options.offset !== undefined) this._followOpts.offset = options.offset;
        if (options.lookahead !== undefined) this._followOpts.lookahead = options.lookahead;
        return this;
    }

    getFollow(): Readonly<Required<FollowOptions>> { return this._followOpts; }

    /** Instantly jump to the current target's position (skips any smoothing). */
    snapToTarget(): this {
        if (!this._target) return this;
        this.x = this._target.x + this._followOpts.offset.x;
        this.y = this._target.y + this._followOpts.offset.y;
        this._velX = this._velY = 0;
        this._clampToBounds();
        this._emit('move', this.x, this.y);
        return this;
    }

    /* ================================================================
     *  BOUNDS / VIEWPORT
     * ================================================================ */

    setBounds(bounds: Bounds | null): this {
        this.bounds = bounds;
        this._emit('boundsChanged', bounds);
        this._clampToBounds();
        return this;
    }

    setViewport(w: number, h: number): this {
        this.viewport = { w, h };
        this._clampToBounds();
        return this;
    }

    /* ================================================================
     *  ZOOM & ROTATION
     * ================================================================ */

    setZoom(z: number, lerp: boolean = false): this {
        this._targetZoom = Math.max(0.01, z);
        if (!lerp) this.zoom = this._targetZoom;
        return this;
    }

    zoomBy(multiplier: number, lerp: boolean = false): this {
        return this.setZoom(this._targetZoom * multiplier, lerp);
    }

    setZoomLerpSpeed(speed: number): this {
        this._zoomLerpSpeed = speed;
        return this;
    }

    setRotation(rad: number): this { this.rotation = rad; return this; }

    /* ================================================================
     *  MOVEMENT
     * ================================================================ */

    moveTo(x: number, y: number): this {
        this.x = x; this.y = y;
        this._clampToBounds();
        this._emit('move', this.x, this.y);
        return this;
    }

    moveBy(dx: number, dy: number): this {
        return this.moveTo(this.x + dx, this.y + dy);
    }

    /* ================================================================
     *  EFFECTS API
     * ================================================================ */

    /**
     * Add trauma to the shake effect.
     *
     *   cam.shake(0.6);                       // quick nudge
     *   cam.shake(1.0, { amplitude: 24 });    // stronger, custom peak
     */
    shake(trauma: number = 0.5, options?: ShakeOptions): this {
        if (options) this._shake.configure(options);
        this._shake.addTrauma(trauma);
        this._emit('shake', trauma);
        return this;
    }

    stopShake(): this { this._shake.reset(); return this; }

    flash(options?: FlashOptions): this {
        this._flash.trigger(options);
        this._emit('flash');
        return this;
    }

    /**
     * Start a screen fade. Typical usage:
     *   cam.fade({ to: 255, duration: 0.4, onComplete: () => loadRoom() });
     *   cam.fade({ from: 255, to: 0, duration: 0.4 });
     */
    fade(options?: FadeOptions): this {
        this._fade.start(options);
        return this;
    }

    /** Instantly clear any persistent fade curtain. */
    clearFade(): this { this._fade.clear(); return this; }

    /** Current opacity of the fade curtain (0..255). */
    getFadeAlpha(): number { return this._fade.alpha; }

    /** Quick inward/outward zoom pulse, e.g. for hits or dialog emphasis. */
    zoomPunch(options: ZoomPunchOptions): this {
        this._zoomPunch.trigger(options);
        return this;
    }

    /**
     * Register a custom effect. Any object implementing `CameraEffect` is
     * accepted — makes it easy to build new systems (chromatic aberration,
     * letterbox, sway, etc.) without touching the Camera class.
     */
    addEffect(effect: CameraEffect): this {
        this._custom.push(effect);
        return this;
    }

    removeEffect(effect: CameraEffect): this {
        const i = this._custom.indexOf(effect);
        if (i >= 0) this._custom.splice(i, 1);
        return this;
    }

    clearEffects(): this {
        this._custom.length = 0;
        this._shake.reset();
        this._flash = new FlashEffect();
        this._fade.clear();
        return this;
    }

    /* ================================================================
     *  EVENTS
     * ================================================================ */

    on<K extends CameraEventName>(event: K, fn: CameraEvents[K]): this {
        (this._listeners[event] ||= [] as any).push(fn as any);
        return this;
    }

    off<K extends CameraEventName>(event: K, fn: CameraEvents[K]): this {
        const arr = this._listeners[event];
        if (!arr) return this;
        const i = (arr as any[]).indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
        return this;
    }

    private _emit<K extends CameraEventName>(event: K, ...args: Parameters<CameraEvents[K]>): void {
        const arr = this._listeners[event];
        if (!arr) return;
        for (const fn of arr as any[]) {
            try { fn(...args); }
            catch (err) { console.error(`[Camera] listener for "${event}" threw:`, err); }
        }
    }

    /* ================================================================
     *  UPDATE
     * ================================================================ */

    /**
     * Advance the camera simulation.
     * @param dtSeconds Optional delta time in seconds. Defaults to p5's
     *                  `deltaTime / 1000`.
     */
    update(dtSeconds?: number): this {
        const dt = dtSeconds ?? ((typeof deltaTime === 'number') ? deltaTime / 1000 : 0.016);

        // Track target velocity for lookahead.
        if (this._target) {
            this._targetVelocity.x = (this._target.x - this._prevTargetPos.x) / Math.max(0.0001, dt);
            this._targetVelocity.y = (this._target.y - this._prevTargetPos.y) / Math.max(0.0001, dt);
            this._prevTargetPos.x = this._target.x;
            this._prevTargetPos.y = this._target.y;
            this._applyFollow(dt);
        }

        // Zoom easing.
        if (this.zoom !== this._targetZoom) {
            const k = 1 - Math.exp(-this._zoomLerpSpeed * dt);
            this.zoom += (this._targetZoom - this.zoom) * k;
            if (Math.abs(this._targetZoom - this.zoom) < 0.0005) this.zoom = this._targetZoom;
            this._emit('zoom', this.zoom);
        }

        // Effects.
        this._shake.update(dt);
        this._flash.update(dt);
        this._fade.update(dt);
        this._zoomPunch.update(dt);
        if (this._fade.alpha > 0) this._emit('fade', this._fade.alpha);

        for (let i = this._custom.length - 1; i >= 0; i--) {
            const e = this._custom[i];
            e.update(dt);
            if (!e.alive) this._custom.splice(i, 1);
        }

        this._clampToBounds();
        return this;
    }

    /* ================================================================
     *  RENDER HOOKS
     * ================================================================ */

    /**
     * Push the camera transform onto p5's matrix stack. Everything drawn
     * between `apply()` and `reset()` is rendered in world space.
     */
    apply(): this {
        const vw = this.viewport.w, vh = this.viewport.h;
        const shakeOff = this._shake.getOffset();
        const rot = this.rotation + (this._shake.getRotation?.() ?? 0);
        const effZoom = this.zoom * (this._zoomPunch.getZoomFactor?.() ?? 1);

        let cx = this.x + shakeOff.x;
        let cy = this.y + shakeOff.y;
        for (const e of this._custom) {
            const o = e.getOffset?.();
            if (o) { cx += o.x; cy += o.y; }
        }
        if (this.pixelSnap) { cx = Math.round(cx); cy = Math.round(cy); }

        push();
        translate(vw * 0.5, vh * 0.5);
        if (effZoom !== 1) scale(effZoom);
        if (rot) rotate(rot);
        translate(-cx, -cy);
        return this;
    }

    /**
     * Pop the camera transform and render all screen-space overlays (flash,
     * fade, custom overlays).
     */
    reset(): this {
        pop();
        const vw = this.viewport.w, vh = this.viewport.h;
        this._flash.drawOverlay?.(vw, vh);
        this._fade.drawOverlay?.(vw, vh);
        for (const e of this._custom) e.drawOverlay?.(vw, vh);
        return this;
    }

    /* ================================================================
     *  COORDINATE CONVERSION
     * ================================================================ */

    /**
     * Convert a world-space point to screen-space pixels. Respects zoom,
     * rotation, and pixel snapping. Useful for UI anchors that track a
     * world entity (floating labels, minimap markers, ...).
     */
    worldToScreen(wx: number, wy: number, out?: Vec2): Vec2 {
        const vw = this.viewport.w, vh = this.viewport.h;
        const shakeOff = this._shake.getOffset();
        const rot = this.rotation + (this._shake.getRotation?.() ?? 0);
        const effZoom = this.zoom * (this._zoomPunch.getZoomFactor?.() ?? 1);
        let cx = this.x + shakeOff.x;
        let cy = this.y + shakeOff.y;
        if (this.pixelSnap) { cx = Math.round(cx); cy = Math.round(cy); }

        let dx = wx - cx, dy = wy - cy;
        if (rot) {
            const cos = Math.cos(rot), sin = Math.sin(rot);
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            dx = rx; dy = ry;
        }
        const result = out ?? { x: 0, y: 0 };
        result.x = dx * effZoom + vw * 0.5;
        result.y = dy * effZoom + vh * 0.5;
        return result;
    }

    /** Reverse of `worldToScreen`. Use with `mouseX`/`mouseY` for clicks. */
    screenToWorld(sx: number, sy: number, out?: Vec2): Vec2 {
        const vw = this.viewport.w, vh = this.viewport.h;
        const shakeOff = this._shake.getOffset();
        const rot = this.rotation + (this._shake.getRotation?.() ?? 0);
        const effZoom = this.zoom * (this._zoomPunch.getZoomFactor?.() ?? 1);
        let cx = this.x + shakeOff.x;
        let cy = this.y + shakeOff.y;
        if (this.pixelSnap) { cx = Math.round(cx); cy = Math.round(cy); }

        let dx = (sx - vw * 0.5) / effZoom;
        let dy = (sy - vh * 0.5) / effZoom;
        if (rot) {
            const cos = Math.cos(-rot), sin = Math.sin(-rot);
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;
            dx = rx; dy = ry;
        }
        const result = out ?? { x: 0, y: 0 };
        result.x = dx + cx;
        result.y = dy + cy;
        return result;
    }

    /** Axis-aligned world-space rectangle currently visible on screen. */
    getVisibleBounds(): Bounds {
        const effZoom = this.zoom * (this._zoomPunch.getZoomFactor?.() ?? 1);
        const w = this.viewport.w / effZoom;
        const h = this.viewport.h / effZoom;
        return { x: this.x - w * 0.5, y: this.y - h * 0.5, w, h };
    }

    /** AABB intersection test — handy for culling off-screen entities. */
    isVisible(wx: number, wy: number, w: number = 0, h: number = 0): boolean {
        const v = this.getVisibleBounds();
        return wx + w >= v.x && wx <= v.x + v.w && wy + h >= v.y && wy <= v.y + v.h;
    }

    /* ================================================================
     *  INTERNALS
     * ================================================================ */

    private _applyFollow(dt: number): void {
        const t = this._target!;
        const look = this._followOpts.lookahead;
        const targetX = t.x + this._followOpts.offset.x
            + Math.max(-look.max, Math.min(look.max, this._targetVelocity.x * look.factor));
        const targetY = t.y + this._followOpts.offset.y
            + Math.max(-look.max, Math.min(look.max, this._targetVelocity.y * look.factor));

        switch (this._followOpts.mode) {
            case 'instant':
                this.x = targetX;
                this.y = targetY;
                break;

            case 'lerp': {
                const k = 1 - Math.exp(-this._followOpts.lerpSpeed * dt);
                this.x += (targetX - this.x) * k;
                this.y += (targetY - this.y) * k;
                break;
            }

            case 'deadzone': {
                const hw = this._followOpts.deadZone.w * 0.5;
                const hh = this._followOpts.deadZone.h * 0.5;
                if (targetX > this.x + hw) this.x = targetX - hw;
                else if (targetX < this.x - hw) this.x = targetX + hw;
                if (targetY > this.y + hh) this.y = targetY - hh;
                else if (targetY < this.y - hh) this.y = targetY + hh;
                break;
            }

            case 'smoothDamp': {
                this.x = this._smoothDamp(this.x, targetX, '_velX', dt);
                this.y = this._smoothDamp(this.y, targetY, '_velY', dt);
                break;
            }
        }

        this._emit('move', this.x, this.y);
    }

    private _smoothDamp(current: number, target: number, velKey: '_velX' | '_velY', dt: number): number {
        const smoothTime = Math.max(0.0001, this._followOpts.smoothTime);
        const omega = 2 / smoothTime;
        const xdt = omega * dt;
        const exp = 1 / (1 + xdt + 0.48 * xdt * xdt + 0.235 * xdt * xdt * xdt);
        const change = current - target;
        const temp = ((this as any)[velKey] + omega * change) * dt;
        (this as any)[velKey] = ((this as any)[velKey] - omega * temp) * exp;
        return target + (change + temp) * exp;
    }

    /**
     * Clamp the camera so that the visible region stays inside `bounds`.
     * If the room is smaller than the viewport on an axis, the camera is
     * centered on that axis instead.
     */
    private _clampToBounds(): void {
        if (!this.bounds) return;
        const effZoom = this.zoom * (this._zoomPunch.getZoomFactor?.() ?? 1);
        const halfW = this.viewport.w / (2 * effZoom);
        const halfH = this.viewport.h / (2 * effZoom);
        const b = this.bounds;

        if (b.w <= halfW * 2) {
            this.x = b.x + b.w * 0.5;
        } else {
            if (this.x - halfW < b.x) this.x = b.x + halfW;
            if (this.x + halfW > b.x + b.w) this.x = b.x + b.w - halfW;
        }
        if (b.h <= halfH * 2) {
            this.y = b.y + b.h * 0.5;
        } else {
            if (this.y - halfH < b.y) this.y = b.y + halfH;
            if (this.y + halfH > b.y + b.h) this.y = b.y + b.h - halfH;
        }
    }
}

/**
 * Shared types used across the camera subsystem.
 */

export interface Vec2 {
    x: number;
    y: number;
}

export interface Bounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Viewport {
    w: number;
    h: number;
}

export interface Trackable {
    x: number;
    y: number;
}

export type EasingFn = (t: number) => number;

/**
 * Follow behavior when a target is assigned.
 *
 *  - 'instant'    : snaps to the target every frame.
 *  - 'lerp'       : exponential smoothing toward the target (fps independent).
 *  - 'deadzone'   : Undertale-style. Camera only moves when the target exits a
 *                   central rectangle, then moves the minimum required to keep
 *                   the target at the rectangle's edge.
 *  - 'smoothDamp' : velocity-based smoothing (Unity SmoothDamp).
 */
export type FollowMode = 'instant' | 'lerp' | 'deadzone' | 'smoothDamp';

export interface FollowOptions {
    mode?: FollowMode;
    /** Used when mode === 'lerp'. Higher = snappier. Default 8. */
    lerpSpeed?: number;
    /** Used when mode === 'smoothDamp'. Seconds to roughly reach target. Default 0.2. */
    smoothTime?: number;
    /** Used when mode === 'deadzone'. Size in world units of the central box. */
    deadZone?: { w: number; h: number };
    /** Extra pixel offset added to the target's position before follow math. */
    offset?: Vec2;
    /** Lookahead: shifts the camera ahead of the target based on its velocity. */
    lookahead?: { factor: number; max: number };
}

export interface ShakeOptions {
    /** Peak offset in pixels when trauma = 1. Default 16. */
    amplitude?: number;
    /** Trauma decay per second. Default 1.2. */
    decay?: number;
    /** If true, the camera also rotates slightly. */
    rotational?: boolean;
    /** Max rotation in radians at trauma = 1. Default 0.05. */
    maxAngle?: number;
}

export interface FlashOptions {
    color?: [number, number, number];
    /** Peak alpha (0..255). Default 255. */
    alpha?: number;
    /** Seconds before the flash starts fading. Default 0.05. */
    hold?: number;
    /** Seconds to fade in from 0 to peak. Default 0. */
    fadeIn?: number;
    /** Seconds to fade out from peak to 0. Default 0.25. */
    fadeOut?: number;
    onComplete?: () => void;
}

export interface FadeOptions {
    color?: [number, number, number];
    /** Starting alpha (0..255). Default 0. */
    from?: number;
    /** Target alpha (0..255). Default 255. */
    to?: number;
    /** Seconds to transition. Default 0.5. */
    duration?: number;
    /** If true, the fade stays at `to` after the transition. Default true. */
    hold?: boolean;
    easing?: EasingFn;
    onComplete?: () => void;
}

export interface ZoomPunchOptions {
    /** Additive multiplier applied to the base zoom at the peak. */
    amount: number;
    /** Total seconds of the punch (goes out then back). Default 0.25. */
    duration?: number;
    easing?: EasingFn;
}

export interface CameraEvents {
    move:     (x: number, y: number) => void;
    zoom:     (zoom: number) => void;
    shake:    (trauma: number) => void;
    flash:    () => void;
    fade:     (alpha: number) => void;
    targetChanged: (target: Trackable | null) => void;
    boundsChanged: (bounds: Bounds | null) => void;
}

export type CameraEventName = keyof CameraEvents;

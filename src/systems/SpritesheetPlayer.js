/**
 * =============================================================================
 *  SpritesheetPlayer
 *  A maximal, highly-configurable spritesheet animation engine for p5.js.
 * =============================================================================
 *
 *  DESIGN GOALS
 *  ------------
 *   - Zero external dependencies beyond p5.js (loaded globally via <script>).
 *   - Drop-in module: exposes globals `SpritesheetPlayer`, `SpritesheetAnimation`,
 *     and a set of `SP_*` enum-like constants.
 *   - Covers the full animation pipeline: sheet parsing (grid or atlas),
 *     clip registry, timeline, transforms, visuals, events, hitboxes, debug.
 *   - Every behavior is overridable via configuration — nothing is hardcoded.
 *   - Frame-rate independent (uses deltaTime by default).
 *   - Safe to use for dozens of simultaneous instances (no global state).
 *
 *  QUICK START
 *  -----------
 *   // In preload():
 *   let sheetImg;
 *   function preload() { sheetImg = loadImage('assets/images/hero.png'); }
 *
 *   // In setup():
 *   const hero = new SpritesheetPlayer({
 *       image: sheetImg,
 *       grid:  { cols: 8, rows: 4 },
 *       position: { x: 200, y: 200 },
 *       anchor:   SP_Anchor.CENTER,
 *       defaultFps: 12
 *   });
 *
 *   hero.addAnimation('idle',   { frames: [0, 1, 2, 3],            loop: SP_LoopMode.LOOP });
 *   hero.addAnimation('walk',   { frames: [8, 9, 10, 11, 12, 13],  loop: SP_LoopMode.LOOP, fps: 16 });
 *   hero.addAnimation('attack', { frames: [16, 17, 18, 19],        loop: SP_LoopMode.NONE, onEnd: () => hero.play('idle') });
 *
 *   hero.play('idle');
 *
 *   // In draw():
 *   hero.update();  // advances the timeline using deltaTime
 *   hero.draw();    // renders the current frame with all transforms
 *
 *  SCOPE OF THIS FILE
 *  ------------------
 *   - SP_LoopMode, SP_PlayDirection, SP_Anchor, SP_FrameOrder,
 *     SP_PlaybackState, SP_BlendMode: enumerations.
 *   - SpritesheetAnimation: a single named clip (frames + timing + loop rules).
 *   - SpritesheetPlayer:    the main stateful player that owns a sheet,
 *                           a registry of animations, and a render state.
 *
 * =============================================================================
 */


/* ============================================================================
 *  ENUMERATIONS
 *  Frozen objects used as enum-like constants. Using strings (instead of
 *  numeric ids) keeps serialized states human-readable.
 * ========================================================================== */

/**
 * Loop behavior when an animation reaches its final frame.
 * @readonly
 * @enum {string}
 */
const SP_LoopMode = Object.freeze({
    /** Play once and stop on the last frame. Fires `end` and `complete` once. */
    NONE:      'none',
    /** Repeat forever, firing `loop` each time it wraps. */
    LOOP:      'loop',
    /** Play forward, then backward, then forward, forever. Fires `loop` on bounce. */
    PING_PONG: 'pingpong',
    /** Loop exactly `loopCount` times (see animation option `loopCount`). */
    LOOP_N:    'loopN',
    /** Play once and hold the last frame indefinitely. */
    HOLD:      'hold',
    /** Play once and hide the sprite (sets visible = false). */
    HIDE:      'hide',
    /** Play once and jump to a target frame specified via `goToFrame`. */
    GOTO:      'goto',
    /** Play once and automatically pop the next queued animation (or stop). */
    QUEUE_POP: 'queuePop'
});

/**
 * Direction of timeline advancement.
 * @readonly
 * @enum {number}
 */
const SP_PlayDirection = Object.freeze({
    FORWARD:  1,
    BACKWARD: -1
});

/**
 * Anchor / pivot presets. Each anchor is a normalized {x, y} pair where
 * (0, 0) is the top-left corner of the frame and (1, 1) is the bottom-right.
 * @readonly
 */
const SP_Anchor = Object.freeze({
    TOP_LEFT:      { x: 0.0, y: 0.0 },
    TOP_CENTER:    { x: 0.5, y: 0.0 },
    TOP_RIGHT:     { x: 1.0, y: 0.0 },
    CENTER_LEFT:   { x: 0.0, y: 0.5 },
    CENTER:        { x: 0.5, y: 0.5 },
    CENTER_RIGHT:  { x: 1.0, y: 0.5 },
    BOTTOM_LEFT:   { x: 0.0, y: 1.0 },
    BOTTOM_CENTER: { x: 0.5, y: 1.0 },
    BOTTOM_RIGHT:  { x: 1.0, y: 1.0 }
});

/**
 * Frame iteration order when parsing a grid-based sheet.
 * @readonly
 * @enum {string}
 */
const SP_FrameOrder = Object.freeze({
    /** Iterate columns within a row before moving to the next row (default). */
    ROW_MAJOR:    'row',
    /** Iterate rows within a column before moving to the next column. */
    COLUMN_MAJOR: 'col'
});

/**
 * Playback state machine values.
 * @readonly
 * @enum {string}
 */
const SP_PlaybackState = Object.freeze({
    IDLE:      'idle',       // created but never played
    PLAYING:   'playing',
    PAUSED:    'paused',
    STOPPED:   'stopped',    // explicitly stopped by the user
    COMPLETED: 'completed'   // animation finished under NONE/HOLD/HIDE/GOTO
});

/**
 * Convenience blend mode aliases. p5.js constants are forwarded when present.
 * Using these strings is safer than importing p5 globals directly, because
 * the p5 globals may not exist at module-load time.
 * @readonly
 * @enum {string}
 */
const SP_BlendMode = Object.freeze({
    BLEND:      'BLEND',
    ADD:        'ADD',
    DARKEST:    'DARKEST',
    LIGHTEST:   'LIGHTEST',
    DIFFERENCE: 'DIFFERENCE',
    EXCLUSION:  'EXCLUSION',
    MULTIPLY:   'MULTIPLY',
    SCREEN:     'SCREEN',
    REPLACE:    'REPLACE',
    REMOVE:     'REMOVE',
    OVERLAY:    'OVERLAY',
    HARD_LIGHT: 'HARD_LIGHT',
    SOFT_LIGHT: 'SOFT_LIGHT',
    DODGE:      'DODGE',
    BURN:       'BURN'
});


/* ============================================================================
 *  INTERNAL HELPERS
 * ========================================================================== */

/**
 * Resolve a p5 blend mode string into the actual p5 constant (if available).
 * Falls back to the string itself so `blendMode(mode)` still works on most
 * builds of p5.
 * @private
 */
function _sp_resolveBlendMode(mode) {
    if (mode == null) return null;
    if (typeof window !== 'undefined' && mode in window) {
        return window[mode];
    }
    return mode;
}

/**
 * Coerce a value into a normalized padding object {top, right, bottom, left}.
 * Accepts:
 *   - a number:                      shorthand for all sides.
 *   - {x, y}:                        x -> left/right, y -> top/bottom.
 *   - {top, right, bottom, left}:    direct assignment (missing = 0).
 * @private
 */
function _sp_normalizePadding(p) {
    if (p == null) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
    if ('x' in p || 'y' in p) {
        const x = p.x | 0, y = p.y | 0;
        return { top: y, right: x, bottom: y, left: x };
    }
    return {
        top:    (p.top    | 0) || 0,
        right:  (p.right  | 0) || 0,
        bottom: (p.bottom | 0) || 0,
        left:   (p.left   | 0) || 0
    };
}

/**
 * Normalize a margin/spacing input into {x, y}.
 * Accepts a number or {x, y}.
 * @private
 */
function _sp_normalizeXY(v, fallback) {
    if (v == null) return { x: fallback || 0, y: fallback || 0 };
    if (typeof v === 'number') return { x: v, y: v };
    return { x: (v.x | 0) || 0, y: (v.y | 0) || 0 };
}

/**
 * Normalize a color-ish input (array, p5.Color, or CSS-like) into an
 * {r, g, b, a} object. `a` is 0..255.
 * @private
 */
function _sp_normalizeColor(c) {
    if (c == null) return null;
    if (Array.isArray(c)) {
        return {
            r: c[0] | 0,
            g: (c[1] == null ? c[0] : c[1]) | 0,
            b: (c[2] == null ? c[0] : c[2]) | 0,
            a: (c[3] == null ? 255 : c[3]) | 0
        };
    }
    if (typeof c === 'object' && 'levels' in c && Array.isArray(c.levels)) {
        // p5.Color: levels is [r, g, b, a]
        return { r: c.levels[0] | 0, g: c.levels[1] | 0, b: c.levels[2] | 0, a: c.levels[3] | 0 };
    }
    if (typeof c === 'object' && 'r' in c) {
        return { r: c.r | 0, g: c.g | 0, b: c.b | 0, a: (c.a == null ? 255 : c.a) | 0 };
    }
    return null;
}

/** Shallow-clone a plain object. @private */
function _sp_shallow(o) { return Object.assign({}, o); }

/** Clamp helper. @private */
function _sp_clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }


/* ============================================================================
 *  SpritesheetAnimation
 *  Represents a single named clip. A clip is a list of frame indices into
 *  a sheet, plus timing and loop configuration. A SpritesheetPlayer can
 *  own many animations and switch between them by name.
 * ========================================================================== */

class SpritesheetAnimation {

    /**
     * @param {string} name - Unique identifier within a player's registry.
     * @param {object} [config={}]
     * @param {number[]} [config.frames]          - Sheet-frame indices to play, in order.
     *                                              If omitted, derived from `start`/`end`.
     * @param {number}   [config.start]           - Inclusive start sheet-frame index.
     *                                              Used when `frames` is absent.
     * @param {number}   [config.end]             - Inclusive end sheet-frame index.
     *                                              Used when `frames` is absent.
     * @param {number}   [config.fps=12]          - Playback rate in frames per second.
     *                                              Ignored if `frameDurations` is set.
     * @param {number[]} [config.frameDurations]  - Per-frame duration in milliseconds.
     *                                              When set, overrides `fps` and allows
     *                                              non-uniform timing.
     * @param {string}   [config.loop]            - One of SP_LoopMode. Default LOOP.
     * @param {number}   [config.loopCount=1]     - How many times to loop under LOOP_N.
     * @param {number}   [config.direction]       - SP_PlayDirection. Default FORWARD.
     * @param {number}   [config.goToFrame=0]     - Target frame for GOTO loop mode
     *                                              (within this clip, not the sheet).
     * @param {number}   [config.speed=1]         - Per-animation speed multiplier,
     *                                              multiplied on top of the player's speed.
     * @param {number[]} [config.pauseOnFrames]   - Clip-relative frame indices that
     *                                              auto-pause when entered (useful for
     *                                              dialogue beats, manual release, etc.).
     * @param {object}   [config.frameEvents]     - Map of clip-relative frame index to
     *                                              a callback or event name fired on entry.
     *                                              Example:
     *                                                { 3: (p) => spawnDust(p),
     *                                                  7: 'footstepRight' }
     * @param {object}   [config.hitboxes]        - Map of clip-relative frame index to
     *                                              an array of hitbox rects in local
     *                                              frame space. Rect = {x,y,w,h,[tag]}.
     * @param {Function} [config.onStart]         - Called when this clip starts playing.
     * @param {Function} [config.onEnd]           - Called when this clip ends (loop none).
     * @param {Function} [config.onLoop]          - Called each time the clip wraps.
     * @param {Function} [config.onFrameChange]   - Called on every frame change;
     *                                              receives (clipFrameIdx, sheetFrameIdx, player).
     * @param {boolean}  [config.pingPongIncludeEnds=false] - If true, the first and last
     *                                              frames are played twice during a bounce,
     *                                              matching Adobe Flash behavior. If false
     *                                              (default), each extremum plays once.
     * @param {boolean}  [config.reverseOnStart=false] - When true, a fresh `play()` on
     *                                              this clip begins at the last frame.
     */
    constructor(name, config = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('[SpritesheetAnimation] A non-empty string name is required.');
        }

        /** @type {string} */
        this.name = name;

        /**
         * Explicit frame list. Populated from `frames` if given, otherwise derived
         * from `start`/`end`. After construction, this is the authoritative list
         * of sheet-frame indices consumed by the player.
         * @type {number[]}
         */
        this.frames = Array.isArray(config.frames) && config.frames.length > 0
            ? config.frames.slice()
            : this._buildRange(config.start, config.end);

        /** @type {number}   */ this.fps             = (config.fps != null)   ? +config.fps   : 12;
        /** @type {?number[]} */ this.frameDurations = Array.isArray(config.frameDurations) ? config.frameDurations.slice() : null;
        /** @type {string}   */ this.loop            = config.loop           || SP_LoopMode.LOOP;
        /** @type {number}   */ this.loopCount       = (config.loopCount != null) ? (config.loopCount | 0) : 1;
        /** @type {number}   */ this.direction       = (config.direction != null) ? config.direction : SP_PlayDirection.FORWARD;
        /** @type {number}   */ this.goToFrame       = (config.goToFrame | 0) || 0;
        /** @type {number}   */ this.speed           = (config.speed != null) ? +config.speed : 1;
        /** @type {number[]} */ this.pauseOnFrames   = Array.isArray(config.pauseOnFrames) ? config.pauseOnFrames.slice() : [];
        /** @type {object}   */ this.frameEvents     = config.frameEvents    || {};
        /** @type {object}   */ this.hitboxes        = config.hitboxes       || {};
        /** @type {boolean}  */ this.pingPongIncludeEnds = !!config.pingPongIncludeEnds;
        /** @type {boolean}  */ this.reverseOnStart  = !!config.reverseOnStart;

        // Lifecycle callbacks (optional).
        /** @type {?Function} */ this.onStart        = config.onStart        || null;
        /** @type {?Function} */ this.onEnd          = config.onEnd          || null;
        /** @type {?Function} */ this.onLoop         = config.onLoop         || null;
        /** @type {?Function} */ this.onFrameChange  = config.onFrameChange  || null;

        if (this.frames.length === 0) {
            throw new Error(`[SpritesheetAnimation] "${name}" has no frames.`);
        }
    }

    /**
     * Build a consecutive [start..end] range inclusive on both ends.
     * Handles reverse ranges (end < start) by descending.
     * @private
     */
    _buildRange(start, end) {
        if (start == null) start = 0;
        if (end == null)   end = start;
        const out = [];
        if (start <= end) {
            for (let i = start; i <= end; i++) out.push(i);
        } else {
            for (let i = start; i >= end; i--) out.push(i);
        }
        return out;
    }

    /**
     * Duration (ms) of a specific clip-relative frame. Respects per-frame
     * durations when provided, otherwise derives from the clip's fps.
     */
    getFrameDuration(clipFrameIdx) {
        if (this.frameDurations && this.frameDurations[clipFrameIdx] != null) {
            return this.frameDurations[clipFrameIdx];
        }
        return 1000 / Math.max(0.0001, this.fps);
    }

    /** Total frame count in this clip. */
    get length() { return this.frames.length; }

    /**
     * Returns a deep-ish clone, safe to mutate independently of `this`.
     * @param {string} [newName]
     */
    clone(newName) {
        return new SpritesheetAnimation(newName || this.name, {
            frames:               this.frames.slice(),
            fps:                  this.fps,
            frameDurations:       this.frameDurations ? this.frameDurations.slice() : null,
            loop:                 this.loop,
            loopCount:            this.loopCount,
            direction:            this.direction,
            goToFrame:            this.goToFrame,
            speed:                this.speed,
            pauseOnFrames:        this.pauseOnFrames.slice(),
            frameEvents:          _sp_shallow(this.frameEvents),
            hitboxes:             _sp_shallow(this.hitboxes),
            pingPongIncludeEnds:  this.pingPongIncludeEnds,
            reverseOnStart:       this.reverseOnStart,
            onStart:              this.onStart,
            onEnd:                this.onEnd,
            onLoop:               this.onLoop,
            onFrameChange:        this.onFrameChange
        });
    }

    /** JSON snapshot for serialization. Functions are dropped. */
    toJSON() {
        return {
            name:                this.name,
            frames:              this.frames,
            fps:                 this.fps,
            frameDurations:      this.frameDurations,
            loop:                this.loop,
            loopCount:           this.loopCount,
            direction:           this.direction,
            goToFrame:           this.goToFrame,
            speed:               this.speed,
            pauseOnFrames:       this.pauseOnFrames,
            frameEvents:         this.frameEvents,
            hitboxes:            this.hitboxes,
            pingPongIncludeEnds: this.pingPongIncludeEnds,
            reverseOnStart:      this.reverseOnStart
        };
    }
}


/* ============================================================================
 *  SpritesheetPlayer
 *  Owns a sheet (p5.Image), a registry of animations, a playback state,
 *  and a rendering state (transforms + visuals). Update + draw each frame.
 * ========================================================================== */

class SpritesheetPlayer {

    /** Semver-ish version tag, useful for save compatibility checks. */
    static get VERSION() { return '1.0.0'; }

    /**
     * @param {object} [config={}]
     *
     * -- Sheet source --
     * @param {p5.Image} [config.image]       - The spritesheet image. Can be set later.
     * @param {object|number[]} [config.frameRects] - Explicit frame rects in pixel space:
     *                                          [{x,y,w,h}, ...]. If given, overrides
     *                                          the grid parser and `grid`/`frameSize`
     *                                          are ignored.
     *
     * -- Grid parser (only used when `frameRects` is absent) --
     * @param {object}  [config.grid]         - { cols, rows }: number of columns & rows.
     * @param {object}  [config.frameSize]    - { w, h }: explicit frame size in pixels.
     *                                          If omitted, computed from the image size
     *                                          minus padding, divided by cols/rows.
     * @param {number|object} [config.margin] - Gap between frames.
     *                                          number -> same on X and Y.
     *                                          { x, y } -> different axes.
     * @param {number|object} [config.padding]- Outer padding of the sheet.
     *                                          number, { x, y }, or { top, right, bottom, left }.
     * @param {string}  [config.order]        - SP_FrameOrder. Default ROW_MAJOR.
     * @param {number}  [config.frameCount]   - Optional explicit cap on parsed frames
     *                                          (useful for incomplete last rows).
     *
     * -- Defaults for playback --
     * @param {number}  [config.defaultFps=12] - FPS applied to animations that don't set one.
     * @param {number}  [config.speed=1]       - Global speed multiplier.
     * @param {number}  [config.timeScale=1]   - Secondary multiplier (e.g. bullet-time).
     * @param {boolean} [config.autoplay=false]- If true and `defaultAnimation` is set,
     *                                           starts playing immediately.
     * @param {string}  [config.defaultAnimation] - Name to play on autoplay/reset.
     *
     * -- Transform / render state --
     * @param {object}  [config.position]     - { x, y }. Default { 0, 0 }.
     * @param {object}  [config.scale]        - { x, y }. Default { 1, 1 }.
     * @param {number}  [config.rotation=0]   - Radians.
     * @param {boolean} [config.flipX=false]
     * @param {boolean} [config.flipY=false]
     * @param {object}  [config.anchor]       - Normalized pivot {x, y} (see SP_Anchor).
     *                                          Default TOP_LEFT.
     * @param {object}  [config.pivotOffset]  - { x, y } pixel offset added to anchor pivot.
     * @param {object}  [config.skew]         - { x, y } skew in radians.
     * @param {object|Array|p5.Color} [config.tint] - Color multiplier; null = no tint.
     * @param {number}  [config.alpha=255]    - Opacity override applied on top of tint alpha.
     * @param {string}  [config.blendMode]    - See SP_BlendMode.
     * @param {boolean} [config.visible=true]
     * @param {object}  [config.shadow]       - { offsetX, offsetY, color } — drops a tinted
     *                                          copy before the main draw.
     *
     * -- Debug --
     * @param {boolean} [config.debug=false]  - Toggles debug drawing during draw().
     * @param {object}  [config.debugColors]  - { bounds, pivot, hitbox } arrays (p5 color args).
     */
    constructor(config = {}) {

        /* -- SHEET STATE ------------------------------------------------ */

        /** @type {?p5.Image} */
        this.image = config.image || null;

        /** @type {number} */ this.cols        = config.grid ? (config.grid.cols | 0) : 1;
        /** @type {number} */ this.rows        = config.grid ? (config.grid.rows | 0) : 1;
        /** @type {number} */ this.frameWidth  = config.frameSize ? (config.frameSize.w | 0) : 0;
        /** @type {number} */ this.frameHeight = config.frameSize ? (config.frameSize.h | 0) : 0;
        /** @type {{x:number, y:number}} */ this.margin  = _sp_normalizeXY(config.margin,  0);
        /** @type {{top:number, right:number, bottom:number, left:number}} */
        this.padding = _sp_normalizePadding(config.padding);
        /** @type {string} */ this.order       = config.order || SP_FrameOrder.ROW_MAJOR;
        /** @type {?number} */ this.maxFrameCount = config.frameCount != null ? (config.frameCount | 0) : null;

        /**
         * Authoritative list of per-frame source rects in pixel space.
         * Either user-provided via `frameRects` or computed from the grid.
         * Each entry is { x, y, w, h }.
         * @type {{x:number,y:number,w:number,h:number}[]}
         */
        this.frameRects = [];

        if (Array.isArray(config.frameRects) && config.frameRects.length > 0) {
            this.setFrameRects(config.frameRects);
        } else if (this.image) {
            this.computeFrameRects();
        }

        /* -- ANIMATION REGISTRY ----------------------------------------- */

        /** @type {Map<string, SpritesheetAnimation>} */
        this.animations = new Map();

        /** @type {?SpritesheetAnimation} */
        this.currentAnimation = null;

        /** @type {?string} */
        this.defaultAnimationName = config.defaultAnimation || null;

        /* -- PLAYBACK STATE --------------------------------------------- */

        /** @type {string} */ this.state         = SP_PlaybackState.IDLE;
        /** @type {number} */ this.defaultFps    = (config.defaultFps != null) ? +config.defaultFps : 12;
        /** @type {number} */ this.speed         = (config.speed != null)      ? +config.speed      : 1;
        /** @type {number} */ this.timeScale     = (config.timeScale != null)  ? +config.timeScale  : 1;

        /** Clip-relative index of the current frame.              @type {number} */
        this.currentFrameIdx      = 0;
        /** Time accumulator (ms) for the current frame.           @type {number} */
        this.frameElapsedMs       = 0;
        /** Effective direction of travel (may flip in ping-pong). @type {number} */
        this.effectiveDirection   = SP_PlayDirection.FORWARD;
        /** Loop iteration counter, for LOOP_N.                    @type {number} */
        this.loopCounter          = 0;
        /** FIFO of queued animations awaiting playback.           @type {Array<{name:string,options:?object}>} */
        this.queue                = [];

        /* -- TRANSFORM & RENDER STATE ----------------------------------- */

        const pos    = config.position    || { x: 0, y: 0 };
        const scl    = config.scale       || { x: 1, y: 1 };
        const anc    = config.anchor      || SP_Anchor.TOP_LEFT;
        const pvo    = config.pivotOffset || { x: 0, y: 0 };
        const skw    = config.skew        || { x: 0, y: 0 };

        /** @type {number}  */ this.x          = +pos.x || 0;
        /** @type {number}  */ this.y          = +pos.y || 0;
        /** @type {number}  */ this.scaleX     = (scl.x != null) ? +scl.x : (typeof scl === 'number' ? +scl : 1);
        /** @type {number}  */ this.scaleY     = (scl.y != null) ? +scl.y : (typeof scl === 'number' ? +scl : 1);
        /** @type {number}  */ this.rotation   = +config.rotation || 0;
        /** @type {boolean} */ this.flipX      = !!config.flipX;
        /** @type {boolean} */ this.flipY      = !!config.flipY;
        /** @type {{x:number,y:number}} */ this.anchor      = { x: anc.x, y: anc.y };
        /** @type {{x:number,y:number}} */ this.pivotOffset = { x: +pvo.x || 0, y: +pvo.y || 0 };
        /** @type {{x:number,y:number}} */ this.skew        = { x: +skw.x || 0, y: +skw.y || 0 };

        /** @type {?{r:number,g:number,b:number,a:number}} */
        this.tint = _sp_normalizeColor(config.tint);
        /** @type {number}  */ this.alpha       = (config.alpha != null) ? (config.alpha | 0) : 255;
        /** @type {?string} */ this.blendMode   = config.blendMode || null;
        /** @type {boolean} */ this.visible     = config.visible !== false;
        /** @type {?object} */ this.shadow      = config.shadow ? {
            offsetX: +config.shadow.offsetX || 0,
            offsetY: +config.shadow.offsetY || 0,
            color:   _sp_normalizeColor(config.shadow.color) || { r: 0, g: 0, b: 0, a: 128 }
        } : null;

        /* -- CAMERA / PARALLAX ------------------------------------------ */

        /** Optional parallax multiplier applied during draw(). @type {{x:number,y:number}} */
        this.parallax = { x: 1, y: 1 };

        /* -- DEBUG ------------------------------------------------------ */

        /** @type {boolean} */ this.debug       = !!config.debug;
        /** @type {object}  */ this.debugColors = Object.assign({
            bounds:  [0, 255, 255],
            pivot:   [255, 0, 255],
            hitbox:  [255, 255, 0]
        }, config.debugColors || {});

        /* -- EVENTS ----------------------------------------------------- */

        /** @private */
        this._listeners = {};

        /* -- OPTIONAL AUTOPLAY ------------------------------------------ */

        if (config.autoplay && this.defaultAnimationName) {
            // Defer play() call so the caller may still register animations
            // after constructing. This is a microtask rather than raf/setTimeout
            // to keep determinism in p5 setup().
            Promise.resolve().then(() => {
                if (this.animations.has(this.defaultAnimationName)) {
                    this.play(this.defaultAnimationName);
                }
            });
        }
    }

    /* =======================================================================
     *  SHEET SETUP
     * ===================================================================== */

    /**
     * Replaces the underlying image. If no explicit `frameRects` have been
     * defined, frames are recomputed from the grid using the new image size.
     * @param {p5.Image} img
     * @returns {this}
     */
    setImage(img) {
        this.image = img || null;
        if (this.image && this.frameRects.length === 0) this.computeFrameRects();
        return this;
    }

    /**
     * Configure grid dimensions. Optionally set frame size explicitly.
     * @param {number} cols
     * @param {number} rows
     * @param {number} [frameW]
     * @param {number} [frameH]
     */
    setGrid(cols, rows, frameW, frameH) {
        this.cols = cols | 0;
        this.rows = rows | 0;
        if (frameW != null) this.frameWidth  = frameW | 0;
        if (frameH != null) this.frameHeight = frameH | 0;
        this.computeFrameRects();
        return this;
    }

    /**
     * Set explicit frame size in pixels. Triggers a frame-rect recompute.
     */
    setFrameSize(w, h) {
        this.frameWidth  = w | 0;
        this.frameHeight = h | 0;
        this.computeFrameRects();
        return this;
    }

    /** Update margin/spacing between grid cells. Recomputes frames. */
    setMargin(v) {
        this.margin = _sp_normalizeXY(v, 0);
        this.computeFrameRects();
        return this;
    }

    /** Alias for setMargin. Recomputes frames. */
    setSpacing(v) { return this.setMargin(v); }

    /** Update outer padding of the sheet. Recomputes frames. */
    setPadding(v) {
        this.padding = _sp_normalizePadding(v);
        this.computeFrameRects();
        return this;
    }

    /** Switch between ROW_MAJOR and COLUMN_MAJOR iteration order. */
    setOrder(order) {
        this.order = order;
        this.computeFrameRects();
        return this;
    }

    /**
     * Manually provide a custom list of frame rects, bypassing the grid parser.
     * This is how you support packed atlases or non-uniform frames.
     * @param {Array<{x:number,y:number,w:number,h:number}>} rects
     */
    setFrameRects(rects) {
        this.frameRects = rects.map(r => ({
            x: r.x | 0, y: r.y | 0, w: r.w | 0, h: r.h | 0
        }));
        return this;
    }

    /**
     * Recompute `this.frameRects` from the current grid configuration and
     * image size. Called automatically whenever grid parameters change.
     * Safe to call manually after swapping an image of a different size.
     */
    computeFrameRects() {
        if (!this.image) { this.frameRects = []; return this; }

        const padL = this.padding.left, padT = this.padding.top,
              padR = this.padding.right, padB = this.padding.bottom;
        const mx = this.margin.x, my = this.margin.y;
        const iw = this.image.width, ih = this.image.height;

        // Derive frame size when not explicitly set.
        let fw = this.frameWidth, fh = this.frameHeight;
        if (fw <= 0) fw = Math.floor((iw - padL - padR - mx * (this.cols - 1)) / Math.max(1, this.cols));
        if (fh <= 0) fh = Math.floor((ih - padT - padB - my * (this.rows - 1)) / Math.max(1, this.rows));
        this.frameWidth  = fw;
        this.frameHeight = fh;

        const rects = [];
        if (this.order === SP_FrameOrder.COLUMN_MAJOR) {
            for (let c = 0; c < this.cols; c++) {
                for (let r = 0; r < this.rows; r++) {
                    rects.push({
                        x: padL + c * (fw + mx),
                        y: padT + r * (fh + my),
                        w: fw, h: fh
                    });
                }
            }
        } else {
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    rects.push({
                        x: padL + c * (fw + mx),
                        y: padT + r * (fh + my),
                        w: fw, h: fh
                    });
                }
            }
        }

        this.frameRects = this.maxFrameCount != null
            ? rects.slice(0, this.maxFrameCount)
            : rects;
        return this;
    }

    /** Total number of frames available on the sheet. */
    get sheetFrameCount() { return this.frameRects.length; }

    /* =======================================================================
     *  ANIMATION REGISTRY
     * ===================================================================== */

    /**
     * Register (or replace) an animation. Accepts either an existing
     * SpritesheetAnimation instance or raw config.
     * @param {string|SpritesheetAnimation} nameOrInstance
     * @param {object} [config]
     * @returns {SpritesheetAnimation}
     */
    addAnimation(nameOrInstance, config) {
        let anim;
        if (nameOrInstance instanceof SpritesheetAnimation) {
            anim = nameOrInstance;
        } else {
            anim = new SpritesheetAnimation(nameOrInstance, config || {});
            if (anim.fps === 12 && config && config.fps == null) {
                // Inherit the player's defaultFps when the caller did not specify one.
                anim.fps = this.defaultFps;
            }
        }
        this.animations.set(anim.name, anim);
        if (!this.defaultAnimationName) this.defaultAnimationName = anim.name;
        return anim;
    }

    /** Remove an animation by name. Safe even if currently playing. */
    removeAnimation(name) {
        if (this.currentAnimation && this.currentAnimation.name === name) {
            this.stop();
        }
        return this.animations.delete(name);
    }

    hasAnimation(name)   { return this.animations.has(name); }
    getAnimation(name)   { return this.animations.get(name) || null; }
    listAnimations()     { return Array.from(this.animations.keys()); }
    clearAnimations()    { this.stop(); this.animations.clear(); this.defaultAnimationName = null; return this; }

    /** Sets the clip used by reset() and autoplay. */
    setDefaultAnimation(name) { this.defaultAnimationName = name; return this; }

    /* =======================================================================
     *  PLAYBACK CONTROL
     * ===================================================================== */

    /**
     * Play (or resume) an animation.
     * @param {string} [name]          - Name to play. If omitted, resumes the current
     *                                   animation (or plays the default one if none).
     * @param {object} [options]
     * @param {number} [options.startFrame=0] - Clip-relative frame to start at.
     * @param {boolean}[options.restart=false]- If true and `name` matches the current
     *                                          animation, restarts from the beginning.
     * @param {number} [options.speed]        - Override per-play speed multiplier
     *                                          (replaces the player's speed while active).
     * @returns {this}
     */
    play(name, options) {
        options = options || {};

        // No name -> resume or start default.
        if (!name) {
            if (this.state === SP_PlaybackState.PAUSED) return this.resume();
            if (!this.currentAnimation && this.defaultAnimationName) {
                return this.play(this.defaultAnimationName, options);
            }
            if (this.currentAnimation) {
                this.state = SP_PlaybackState.PLAYING;
                return this;
            }
            return this;
        }

        const anim = this.animations.get(name);
        if (!anim) {
            console.warn(`[SpritesheetPlayer] play(): unknown animation "${name}".`);
            return this;
        }

        // Same animation & no restart requested -> resume only.
        if (this.currentAnimation === anim && !options.restart && this.state !== SP_PlaybackState.STOPPED) {
            if (this.state === SP_PlaybackState.PAUSED) return this.resume();
            this.state = SP_PlaybackState.PLAYING;
            return this;
        }

        const previous = this.currentAnimation;
        if (previous) this._fire('animationEnd', previous);

        this.currentAnimation      = anim;
        this.currentFrameIdx       = options.startFrame != null
            ? _sp_clamp(options.startFrame | 0, 0, anim.length - 1)
            : (anim.reverseOnStart ? anim.length - 1 : 0);
        this.frameElapsedMs        = 0;
        this.effectiveDirection    = anim.direction;
        this.loopCounter           = 0;
        this.state                 = SP_PlaybackState.PLAYING;
        if (options.speed != null) this.speed = +options.speed;

        if (typeof anim.onStart === 'function') anim.onStart(this);
        this._fire('animationStart', anim);
        this._fire('start', anim);
        this._fireFrameChange(anim);

        return this;
    }

    /**
     * Play an animation exactly once (forces LOOP_N with count 1 for the
     * duration of this play() call — does not mutate the stored animation).
     */
    playOnce(name, options) {
        const anim = this.animations.get(name);
        if (!anim) { console.warn(`[SpritesheetPlayer] playOnce(): unknown "${name}"`); return this; }
        const prevLoop = anim.loop, prevCount = anim.loopCount;
        anim.loop = SP_LoopMode.NONE;
        const self = this;
        const originalEnd = anim.onEnd;
        anim.onEnd = function restore(p) {
            anim.loop = prevLoop;
            anim.loopCount = prevCount;
            anim.onEnd = originalEnd;
            if (typeof originalEnd === 'function') originalEnd(p);
        };
        return this.play(name, Object.assign({ restart: true }, options || {}));
    }

    /**
     * Play an animation and return a Promise that resolves when it completes
     * (finishes under NONE/HOLD/HIDE/GOTO/LOOP_N, or is stopped).
     * @returns {Promise<void>}
     */
    playAndWait(name, options) {
        return new Promise((resolve) => {
            const handler = (a) => {
                if (a && a.name === name) {
                    this.off('complete', handler);
                    this.off('stop', handler);
                    resolve();
                }
            };
            this.on('complete', handler);
            this.on('stop', handler);
            this.play(name, options);
        });
    }

    /** Stop playback and reset to the first frame of the current animation. */
    stop() {
        this.state = SP_PlaybackState.STOPPED;
        this.currentFrameIdx = 0;
        this.frameElapsedMs = 0;
        this._fire('stop', this.currentAnimation);
        return this;
    }

    /** Pause playback but keep the current frame visible. */
    pause() {
        if (this.state === SP_PlaybackState.PLAYING) {
            this.state = SP_PlaybackState.PAUSED;
            this._fire('pause', this.currentAnimation);
        }
        return this;
    }

    /** Resume from a paused state. No-op in other states. */
    resume() {
        if (this.state === SP_PlaybackState.PAUSED) {
            this.state = SP_PlaybackState.PLAYING;
            this._fire('resume', this.currentAnimation);
        }
        return this;
    }

    /** Convenience toggle between PLAYING and PAUSED. */
    toggle() {
        return this.state === SP_PlaybackState.PLAYING ? this.pause() : this.resume();
    }

    /** Restart the current animation from the first frame (or last if reversed). */
    restart() {
        if (this.currentAnimation) {
            return this.play(this.currentAnimation.name, { restart: true });
        }
        return this;
    }

    /**
     * Queue an animation to play after the current one completes. When the
     * current clip ends under any "completion" loop mode, the queue is popped
     * and the next entry is played automatically.
     * Multiple calls chain up.
     */
    queueAnimation(name, options) {
        this.queue.push({ name: name, options: options || null });
        return this;
    }

    /** Empty the queue without affecting the current animation. */
    clearQueue() { this.queue.length = 0; return this; }

    /** Force-advance to the next queued animation immediately. */
    skipToNext() {
        const next = this.queue.shift();
        if (next) return this.play(next.name, next.options || {});
        this._fire('queueEmpty');
        return this.stop();
    }

    /** Flip the effective direction of travel. Useful for mid-clip reversal. */
    reverseDirection() {
        this.effectiveDirection = -this.effectiveDirection;
        return this;
    }

    /* =======================================================================
     *  FRAME CONTROL
     * ===================================================================== */

    /** Jump to a clip-relative frame. Does not change the play state. */
    gotoFrame(clipFrameIdx) {
        if (!this.currentAnimation) return this;
        this.currentFrameIdx = _sp_clamp(clipFrameIdx | 0, 0, this.currentAnimation.length - 1);
        this.frameElapsedMs = 0;
        this._fireFrameChange(this.currentAnimation);
        return this;
    }

    /**
     * Jump to a sheet-absolute frame index. If the current animation does
     * not include that frame, falls back to `gotoSheetFrame` without changing
     * the clip-relative index (renders a raw sheet frame).
     */
    gotoSheetFrame(sheetFrameIdx) {
        if (!this.currentAnimation) { this._overrideSheetFrame = sheetFrameIdx | 0; return this; }
        const idx = this.currentAnimation.frames.indexOf(sheetFrameIdx | 0);
        if (idx >= 0) return this.gotoFrame(idx);
        this._overrideSheetFrame = sheetFrameIdx | 0;
        return this;
    }

    /** Advance one frame forward, respecting clip bounds but not loop rules. */
    nextFrame() {
        if (!this.currentAnimation) return this;
        return this.gotoFrame(Math.min(this.currentAnimation.length - 1, this.currentFrameIdx + 1));
    }

    /** Step one frame backward. */
    prevFrame() {
        if (!this.currentAnimation) return this;
        return this.gotoFrame(Math.max(0, this.currentFrameIdx - 1));
    }

    /** The current clip-relative frame index. */
    currentFrame() { return this.currentFrameIdx; }

    /** The current sheet-absolute frame index, or null if no animation. */
    currentSheetFrame() {
        if (this._overrideSheetFrame != null) return this._overrideSheetFrame;
        if (!this.currentAnimation) return null;
        return this.currentAnimation.frames[this.currentFrameIdx];
    }

    /** Total number of frames in the currently playing clip. */
    totalFrames() { return this.currentAnimation ? this.currentAnimation.length : 0; }

    /** Playback progress in [0, 1] within the current clip. */
    normalizedProgress() {
        const n = this.totalFrames();
        return n > 0 ? (this.currentFrameIdx / (n - 1 || 1)) : 0;
    }

    /* =======================================================================
     *  TIMING
     * ===================================================================== */

    /**
     * Set the playback FPS of the currently playing animation.
     * If `includeAll` is true, sets the fps of every registered animation.
     */
    setFps(fps, includeAll) {
        if (includeAll) for (const a of this.animations.values()) a.fps = +fps;
        else if (this.currentAnimation) this.currentAnimation.fps = +fps;
        return this;
    }

    /** Global speed multiplier (can be negative for reverse). */
    setSpeed(mult) { this.speed = +mult; return this; }
    /** Secondary multiplier, handy for bullet-time or pause-by-scale. */
    setTimeScale(scale) { this.timeScale = +scale; return this; }

    /** Forward or backward direction for the active animation. */
    setDirection(dir) { this.effectiveDirection = dir; return this; }

    /* =======================================================================
     *  TRANSFORMS
     * ===================================================================== */

    setPosition(x, y) { this.x = x; this.y = y; return this; }
    move(dx, dy)      { this.x += dx; this.y += dy; return this; }

    /**
     * Scale setter. If only one argument is provided, applies uniformly.
     * Accepts either (sx, sy) or an object { x, y } as a single argument.
     */
    setScale(sx, sy) {
        if (typeof sx === 'object' && sx !== null) { this.scaleX = +sx.x; this.scaleY = +sx.y; return this; }
        if (sy == null) { this.scaleX = this.scaleY = +sx; return this; }
        this.scaleX = +sx; this.scaleY = +sy;
        return this;
    }

    setRotation(rad)  { this.rotation = +rad; return this; }
    rotateBy(rad)     { this.rotation += +rad; return this; }

    setFlipX(b) { this.flipX = !!b; return this; }
    setFlipY(b) { this.flipY = !!b; return this; }
    setFlip(x, y) { this.flipX = !!x; this.flipY = !!y; return this; }

    /** Accepts an SP_Anchor preset or a custom { x, y } object. */
    setAnchor(anchor) {
        if (!anchor) return this;
        this.anchor.x = +anchor.x;
        this.anchor.y = +anchor.y;
        return this;
    }

    setPivotOffset(ox, oy) { this.pivotOffset.x = +ox; this.pivotOffset.y = +oy; return this; }
    setSkew(sx, sy)        { this.skew.x = +sx; this.skew.y = +sy; return this; }
    setParallax(px, py)    { this.parallax.x = +px; this.parallax.y = (py != null ? +py : +px); return this; }

    /* =======================================================================
     *  VISUALS
     * ===================================================================== */

    /** Accepts color arrays, p5.Color objects, or null to clear. */
    setTint(color) { this.tint = _sp_normalizeColor(color); return this; }
    clearTint()    { this.tint = null; return this; }

    /** Opacity in [0, 255]. */
    setAlpha(a) { this.alpha = _sp_clamp(a | 0, 0, 255); return this; }

    /** See SP_BlendMode. Pass null to clear. */
    setBlendMode(mode) { this.blendMode = mode || null; return this; }
    setVisible(v)      { this.visible = !!v; return this; }

    /** Drop-shadow config. Pass null to disable. */
    setShadow(cfg) {
        if (!cfg) { this.shadow = null; return this; }
        this.shadow = {
            offsetX: +cfg.offsetX || 0,
            offsetY: +cfg.offsetY || 0,
            color:   _sp_normalizeColor(cfg.color) || { r: 0, g: 0, b: 0, a: 128 }
        };
        return this;
    }

    /* =======================================================================
     *  EVENTS
     *  Built-in event names:
     *    'start'           — (animation)          on play() of a new clip
     *    'animationStart'  — (animation)          same as 'start'
     *    'end'             — (animation)          clip completed (NONE/HOLD/HIDE/GOTO)
     *    'animationEnd'    — (animation)          clip ended or was replaced
     *    'complete'        — (animation)          synonym of 'end', kept for convenience
     *    'loop'            — (animation, counter) clip wrapped
     *    'pause'           — (animation)
     *    'resume'          — (animation)
     *    'stop'            — (animation)
     *    'frameChange'     — (clipFrameIdx, sheetFrameIdx, animation)
     *    'frameEvent'      — (eventName, clipFrameIdx, animation) custom per-frame event
     *    'queueEmpty'      — ()                   no animations left in queue
     * ===================================================================== */

    /** Register a listener. Returns this. */
    on(event, fn) {
        if (typeof fn !== 'function') return this;
        (this._listeners[event] = this._listeners[event] || []).push(fn);
        return this;
    }

    /** Register a one-shot listener that auto-removes itself after firing. */
    once(event, fn) {
        const self = this;
        const wrap = function(...args) { self.off(event, wrap); fn.apply(null, args); };
        return this.on(event, wrap);
    }

    /** Remove a listener. If no `fn` is given, removes all listeners for event. */
    off(event, fn) {
        const arr = this._listeners[event];
        if (!arr) return this;
        if (!fn) { delete this._listeners[event]; return this; }
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
        return this;
    }

    /** Fire an event, invoking every listener with the remaining arguments. */
    emit(event, ...args) { return this._fire(event, ...args); }

    /** @private */
    _fire(event, ...args) {
        const arr = this._listeners[event];
        if (!arr) return this;
        for (let i = 0; i < arr.length; i++) {
            try { arr[i].apply(null, args); }
            catch (err) { console.error(`[SpritesheetPlayer] listener for "${event}" threw:`, err); }
        }
        return this;
    }

    /** @private */
    _fireFrameChange(anim) {
        const sheetIdx = anim.frames[this.currentFrameIdx];
        if (typeof anim.onFrameChange === 'function') {
            try { anim.onFrameChange(this.currentFrameIdx, sheetIdx, this); }
            catch (err) { console.error('[SpritesheetPlayer] onFrameChange threw:', err); }
        }
        this._fire('frameChange', this.currentFrameIdx, sheetIdx, anim);

        // Per-frame custom events defined on the animation config.
        const fe = anim.frameEvents && anim.frameEvents[this.currentFrameIdx];
        if (fe != null) {
            if (typeof fe === 'function') {
                try { fe(this); } catch (err) { console.error('[SpritesheetPlayer] frameEvent threw:', err); }
            } else {
                this._fire('frameEvent', fe, this.currentFrameIdx, anim);
            }
        }

        // Auto-pause on request.
        if (anim.pauseOnFrames && anim.pauseOnFrames.indexOf(this.currentFrameIdx) >= 0) {
            this.pause();
        }
    }

    /* =======================================================================
     *  HITBOXES
     * ===================================================================== */

    /**
     * Define hitboxes for a specific clip-relative frame.
     * @param {string} animationName
     * @param {number} clipFrameIdx
     * @param {Array<{x:number,y:number,w:number,h:number,tag?:string}>} rects
     */
    setFrameHitboxes(animationName, clipFrameIdx, rects) {
        const anim = this.animations.get(animationName);
        if (!anim) { console.warn(`[SpritesheetPlayer] unknown animation "${animationName}"`); return this; }
        anim.hitboxes[clipFrameIdx] = rects.map(r => _sp_shallow(r));
        return this;
    }

    /** Hitboxes for the current frame in local (unscaled, unrotated) space. */
    getCurrentHitboxes() {
        if (!this.currentAnimation) return [];
        return this.currentAnimation.hitboxes[this.currentFrameIdx] || [];
    }

    /**
     * Hitboxes for the current frame transformed into world space using the
     * current position/scale/flip. Rotation/skew are *not* applied (fast AABB).
     * For rotated hitboxes compute them manually from getCurrentHitboxes().
     */
    getWorldHitboxes() {
        const local = this.getCurrentHitboxes();
        if (local.length === 0) return [];
        const fw = this.frameWidth, fh = this.frameHeight;
        const ax = this.anchor.x * fw, ay = this.anchor.y * fh;
        const sx = this.scaleX * (this.flipX ? -1 : 1);
        const sy = this.scaleY * (this.flipY ? -1 : 1);
        const px = this.x + this.pivotOffset.x;
        const py = this.y + this.pivotOffset.y;
        return local.map(r => {
            const x0 = (r.x - ax) * sx;
            const y0 = (r.y - ay) * sy;
            const w  = r.w * Math.abs(sx);
            const h  = r.h * Math.abs(sy);
            return {
                x: px + (sx < 0 ? x0 - w : x0),
                y: py + (sy < 0 ? y0 - h : y0),
                w: w, h: h,
                tag: r.tag || null
            };
        });
    }

    /** Axis-aligned world bounds of the current frame (ignores rotation). */
    getWorldBounds() {
        const fw = this.frameWidth, fh = this.frameHeight;
        const ax = this.anchor.x * fw, ay = this.anchor.y * fh;
        const sx = Math.abs(this.scaleX), sy = Math.abs(this.scaleY);
        return {
            x: this.x - ax * sx + this.pivotOffset.x,
            y: this.y - ay * sy + this.pivotOffset.y,
            w: fw * sx,
            h: fh * sy
        };
    }

    /* =======================================================================
     *  UPDATE LOOP
     * ===================================================================== */

    /**
     * Advance the timeline by `dtMs` milliseconds. If `dtMs` is omitted,
     * p5's global `deltaTime` is used (recommended).
     */
    update(dtMs) {
        if (this.state !== SP_PlaybackState.PLAYING) return this;
        const anim = this.currentAnimation;
        if (!anim || anim.length === 0) return this;

        if (dtMs == null) {
            dtMs = (typeof deltaTime === 'number') ? deltaTime : 16.666;
        }

        // Apply the global multipliers. A negative product reverses travel
        // without mutating the stored direction.
        const multiplier = this.speed * this.timeScale * anim.speed;
        if (multiplier === 0) return this;

        let remaining = dtMs * Math.abs(multiplier);
        const travelSign = (multiplier < 0 ? -1 : 1) * this.effectiveDirection;

        // A single dt tick may cross multiple frame boundaries.
        // We subtract the current frame's remaining time until dt is consumed.
        let guard = 1024; // failsafe against pathological fps=Infinity
        while (remaining > 0 && guard-- > 0) {
            const dur = anim.getFrameDuration(this.currentFrameIdx);
            const left = dur - this.frameElapsedMs;

            if (remaining < left) {
                this.frameElapsedMs += remaining;
                remaining = 0;
                break;
            }

            // Finish the current frame.
            remaining -= left;
            this.frameElapsedMs = 0;

            // Advance by one tick in the effective direction.
            const nextIdx = this.currentFrameIdx + travelSign;
            if (nextIdx < 0 || nextIdx >= anim.length) {
                // Hit an end — apply loop rules.
                const wrapped = this._applyLoopRules(anim, nextIdx, travelSign);
                if (!wrapped) return this; // ended (stopped, completed, or hidden)
            } else {
                this.currentFrameIdx = nextIdx;
                this._fireFrameChange(anim);
            }
        }
        return this;
    }

    /**
     * React to a frame index falling outside [0, length-1]. Returns true when
     * playback should continue, false when playback effectively ended.
     * @private
     */
    _applyLoopRules(anim, candidateIdx, travelSign) {
        const lastIdx = anim.length - 1;

        switch (anim.loop) {
            case SP_LoopMode.LOOP:
                this.currentFrameIdx = (travelSign > 0) ? 0 : lastIdx;
                if (typeof anim.onLoop === 'function') anim.onLoop(this);
                this._fire('loop', anim, ++this.loopCounter);
                this._fireFrameChange(anim);
                return true;

            case SP_LoopMode.PING_PONG: {
                this.effectiveDirection = -this.effectiveDirection;
                // Include vs exclude endpoints: when excluding, we skip the clamp tick.
                const offset = anim.pingPongIncludeEnds ? 0 : 1;
                this.currentFrameIdx = (travelSign > 0) ? (lastIdx - offset) : (0 + offset);
                this.currentFrameIdx = _sp_clamp(this.currentFrameIdx, 0, lastIdx);
                if (typeof anim.onLoop === 'function') anim.onLoop(this);
                this._fire('loop', anim, ++this.loopCounter);
                this._fireFrameChange(anim);
                return true;
            }

            case SP_LoopMode.LOOP_N:
                this.loopCounter++;
                if (this.loopCounter < anim.loopCount) {
                    this.currentFrameIdx = (travelSign > 0) ? 0 : lastIdx;
                    if (typeof anim.onLoop === 'function') anim.onLoop(this);
                    this._fire('loop', anim, this.loopCounter);
                    this._fireFrameChange(anim);
                    return true;
                }
                return this._completeAnimation(anim, /*holdLast*/ true);

            case SP_LoopMode.HOLD:
                return this._completeAnimation(anim, /*holdLast*/ true);

            case SP_LoopMode.HIDE:
                this.visible = false;
                return this._completeAnimation(anim, /*holdLast*/ true);

            case SP_LoopMode.GOTO:
                this.currentFrameIdx = _sp_clamp(anim.goToFrame | 0, 0, lastIdx);
                this._fireFrameChange(anim);
                return this._completeAnimation(anim, /*holdLast*/ false);

            case SP_LoopMode.QUEUE_POP:
                this._completeAnimation(anim, /*holdLast*/ true);
                if (this.queue.length > 0) this.skipToNext();
                else this._fire('queueEmpty');
                return false;

            case SP_LoopMode.NONE:
            default:
                return this._completeAnimation(anim, /*holdLast*/ true);
        }
    }

    /**
     * Shared completion logic: transitions to COMPLETED, fires callbacks,
     * and optionally drains the queue.
     * @private
     * @returns {boolean} always false, indicating update loop should exit.
     */
    _completeAnimation(anim, holdLast) {
        if (holdLast) {
            this.currentFrameIdx = (this.effectiveDirection > 0) ? anim.length - 1 : 0;
        }
        this.state = SP_PlaybackState.COMPLETED;

        if (typeof anim.onEnd === 'function') {
            try { anim.onEnd(this); }
            catch (err) { console.error('[SpritesheetPlayer] onEnd threw:', err); }
        }
        this._fire('end', anim);
        this._fire('complete', anim);
        this._fire('animationEnd', anim);

        // Auto-pop the queue: if the user has queued another animation, start it.
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.play(next.name, next.options || {});
            return true;
        }
        return false;
    }

    /* =======================================================================
     *  RENDER
     * ===================================================================== */

    /**
     * Render the current frame using all configured transforms and visuals.
     * Safe to call even when the player has no image/animation — no-ops.
     * @param {number} [xOverride] - Optional world-x override (keeps state intact).
     * @param {number} [yOverride]
     */
    draw(xOverride, yOverride) {
        if (!this.visible) return this;
        if (!this.image || this.frameRects.length === 0) return this;

        const sheetIdx = this.currentSheetFrame();
        if (sheetIdx == null || sheetIdx < 0 || sheetIdx >= this.frameRects.length) {
            if (this.debug) this._drawDebugMissing(xOverride, yOverride);
            return this;
        }

        const rect = this.frameRects[sheetIdx];
        const fw = rect.w, fh = rect.h;
        const ax = this.anchor.x * fw + this.pivotOffset.x;
        const ay = this.anchor.y * fh + this.pivotOffset.y;

        const drawX = (xOverride != null ? xOverride : this.x) * this.parallax.x;
        const drawY = (yOverride != null ? yOverride : this.y) * this.parallax.y;

        push();

        // Blend mode (if any).
        if (this.blendMode) {
            const bm = _sp_resolveBlendMode(this.blendMode);
            if (bm != null) blendMode(bm);
        }

        // Transform stack.
        translate(drawX, drawY);
        if (this.rotation) rotate(this.rotation);
        if (this.skew.x || this.skew.y) {
            // p5 has no shear() primitive; approximate with applyMatrix.
            applyMatrix(1, Math.tan(this.skew.y), Math.tan(this.skew.x), 1, 0, 0);
        }
        if (this.flipX || this.flipY || this.scaleX !== 1 || this.scaleY !== 1) {
            scale(
                this.scaleX * (this.flipX ? -1 : 1),
                this.scaleY * (this.flipY ? -1 : 1)
            );
        }
        translate(-ax, -ay);

        // Optional drop-shadow pass.
        if (this.shadow) {
            const s = this.shadow;
            push();
            translate(s.offsetX, s.offsetY);
            tint(s.color.r, s.color.g, s.color.b, s.color.a);
            image(this.image, 0, 0, fw, fh, rect.x, rect.y, rect.w, rect.h);
            pop();
        }

        // Primary tint / alpha.
        if (this.tint) {
            const a = Math.min(this.tint.a, this.alpha);
            tint(this.tint.r, this.tint.g, this.tint.b, a);
        } else if (this.alpha < 255) {
            tint(255, 255, 255, this.alpha);
        } else {
            noTint();
        }

        image(this.image, 0, 0, fw, fh, rect.x, rect.y, rect.w, rect.h);

        if (this.debug) this._drawDebug(fw, fh);

        pop();
        return this;
    }

    /** Convenience wrapper to draw at an arbitrary position without mutating x/y. */
    drawAt(x, y) { return this.draw(x, y); }

    /**
     * Draw a raw sheet frame at (x, y) without engaging the timeline. Useful
     * for HUD icons, tile renderings, or debug utilities.
     * @param {number} sheetIdx
     * @param {number} x
     * @param {number} y
     * @param {object} [opts] - Optional { scale, rotation, tint, alpha, anchor }.
     */
    drawFrame(sheetIdx, x, y, opts) {
        if (!this.image) return this;
        const rect = this.frameRects[sheetIdx];
        if (!rect) return this;
        opts = opts || {};
        const sc  = opts.scale  != null ? opts.scale  : 1;
        const rot = opts.rotation != null ? opts.rotation : 0;
        const anc = opts.anchor || SP_Anchor.TOP_LEFT;
        const t   = _sp_normalizeColor(opts.tint);
        const al  = opts.alpha != null ? opts.alpha : 255;
        const fw  = rect.w, fh = rect.h;

        push();
        translate(x, y);
        if (rot) rotate(rot);
        if (sc !== 1) scale(sc);
        translate(-anc.x * fw, -anc.y * fh);
        if (t) tint(t.r, t.g, t.b, Math.min(t.a, al));
        else if (al < 255) tint(255, 255, 255, al);
        else noTint();
        image(this.image, 0, 0, fw, fh, rect.x, rect.y, rect.w, rect.h);
        pop();
        return this;
    }

    /** Debug overlay drawn after the sprite (within the same transform). @private */
    _drawDebug(fw, fh) {
        const b = this.debugColors.bounds;
        noFill(); strokeWeight(1);
        stroke(b[0], b[1], b[2]);
        rect(0, 0, fw, fh);

        const p = this.debugColors.pivot;
        stroke(p[0], p[1], p[2]);
        line(this.anchor.x * fw - 4, this.anchor.y * fh, this.anchor.x * fw + 4, this.anchor.y * fh);
        line(this.anchor.x * fw, this.anchor.y * fh - 4, this.anchor.x * fw, this.anchor.y * fh + 4);

        const boxes = this.getCurrentHitboxes();
        if (boxes.length) {
            const h = this.debugColors.hitbox;
            stroke(h[0], h[1], h[2]);
            for (let i = 0; i < boxes.length; i++) {
                const r = boxes[i];
                rect(r.x, r.y, r.w, r.h);
            }
        }
    }

    /** @private */
    _drawDebugMissing(xo, yo) {
        push();
        translate(xo != null ? xo : this.x, yo != null ? yo : this.y);
        noFill(); stroke(255, 0, 0); strokeWeight(2);
        rect(0, 0, this.frameWidth || 16, this.frameHeight || 16);
        line(0, 0, this.frameWidth || 16, this.frameHeight || 16);
        line(this.frameWidth || 16, 0, 0, this.frameHeight || 16);
        pop();
    }

    /** Enable/disable debug overlays. Fluent. */
    setDebug(b) { this.debug = !!b; return this; }

    /* =======================================================================
     *  STATE UTILITIES
     * ===================================================================== */

    isPlaying()   { return this.state === SP_PlaybackState.PLAYING; }
    isPaused()    { return this.state === SP_PlaybackState.PAUSED; }
    isStopped()   { return this.state === SP_PlaybackState.STOPPED; }
    isComplete()  { return this.state === SP_PlaybackState.COMPLETED; }

    /** Full snapshot of the current state (useful for save/load). */
    getState() {
        return {
            state:              this.state,
            animation:          this.currentAnimation ? this.currentAnimation.name : null,
            currentFrameIdx:    this.currentFrameIdx,
            frameElapsedMs:     this.frameElapsedMs,
            effectiveDirection: this.effectiveDirection,
            loopCounter:        this.loopCounter,
            queue:              this.queue.map(q => _sp_shallow(q)),
            x: this.x, y: this.y,
            scaleX: this.scaleX, scaleY: this.scaleY,
            rotation: this.rotation,
            flipX: this.flipX, flipY: this.flipY,
            anchor: _sp_shallow(this.anchor),
            pivotOffset: _sp_shallow(this.pivotOffset),
            skew: _sp_shallow(this.skew),
            tint: this.tint ? _sp_shallow(this.tint) : null,
            alpha: this.alpha,
            blendMode: this.blendMode,
            visible: this.visible,
            speed: this.speed,
            timeScale: this.timeScale
        };
    }

    /** Restore a snapshot produced by getState(). */
    loadState(snapshot) {
        if (!snapshot) return this;
        Object.assign(this, {
            state:              snapshot.state,
            currentFrameIdx:    snapshot.currentFrameIdx | 0,
            frameElapsedMs:     +snapshot.frameElapsedMs || 0,
            effectiveDirection: snapshot.effectiveDirection,
            loopCounter:        snapshot.loopCounter | 0,
            queue:              Array.isArray(snapshot.queue) ? snapshot.queue.slice() : [],
            x: +snapshot.x || 0, y: +snapshot.y || 0,
            scaleX: +snapshot.scaleX, scaleY: +snapshot.scaleY,
            rotation: +snapshot.rotation || 0,
            flipX: !!snapshot.flipX, flipY: !!snapshot.flipY,
            anchor: _sp_shallow(snapshot.anchor || { x: 0, y: 0 }),
            pivotOffset: _sp_shallow(snapshot.pivotOffset || { x: 0, y: 0 }),
            skew: _sp_shallow(snapshot.skew || { x: 0, y: 0 }),
            tint: snapshot.tint ? _sp_shallow(snapshot.tint) : null,
            alpha: snapshot.alpha | 0,
            blendMode: snapshot.blendMode || null,
            visible: snapshot.visible !== false,
            speed: +snapshot.speed || 1,
            timeScale: +snapshot.timeScale || 1
        });
        if (snapshot.animation && this.animations.has(snapshot.animation)) {
            this.currentAnimation = this.animations.get(snapshot.animation);
        }
        return this;
    }

    /** Rewind to the default animation's first frame. Keeps transforms. */
    reset() {
        this.state = SP_PlaybackState.IDLE;
        this.currentFrameIdx = 0;
        this.frameElapsedMs = 0;
        this.loopCounter = 0;
        this.queue.length = 0;
        this.visible = true;
        if (this.defaultAnimationName && this.animations.has(this.defaultAnimationName)) {
            this.currentAnimation = this.animations.get(this.defaultAnimationName);
            this.effectiveDirection = this.currentAnimation.direction;
        }
        return this;
    }

    /**
     * Return a new SpritesheetPlayer that shares the same image reference
     * but has independent timelines, transforms, and event listeners. All
     * registered animations are deep-cloned so the new player can mutate
     * them without affecting the original.
     */
    clone() {
        const copy = new SpritesheetPlayer({
            image:       this.image,
            grid:        { cols: this.cols, rows: this.rows },
            frameSize:   { w: this.frameWidth, h: this.frameHeight },
            margin:      this.margin,
            padding:     this.padding,
            order:       this.order,
            frameCount:  this.maxFrameCount == null ? undefined : this.maxFrameCount,
            defaultFps:  this.defaultFps,
            speed:       this.speed,
            timeScale:   this.timeScale,
            position:    { x: this.x, y: this.y },
            scale:       { x: this.scaleX, y: this.scaleY },
            rotation:    this.rotation,
            flipX:       this.flipX,
            flipY:       this.flipY,
            anchor:      _sp_shallow(this.anchor),
            pivotOffset: _sp_shallow(this.pivotOffset),
            skew:        _sp_shallow(this.skew),
            tint:        this.tint ? [this.tint.r, this.tint.g, this.tint.b, this.tint.a] : null,
            alpha:       this.alpha,
            blendMode:   this.blendMode,
            visible:     this.visible,
            shadow:      this.shadow ? {
                offsetX: this.shadow.offsetX,
                offsetY: this.shadow.offsetY,
                color:   [this.shadow.color.r, this.shadow.color.g, this.shadow.color.b, this.shadow.color.a]
            } : null,
            debug:       this.debug,
            debugColors: _sp_shallow(this.debugColors),
            defaultAnimation: this.defaultAnimationName,
            frameRects:  this.frameRects.slice()
        });
        for (const [name, anim] of this.animations) copy.animations.set(name, anim.clone());
        return copy;
    }

    /**
     * Serialize to a JSON-safe object. Event callbacks and the image itself
     * are *not* serialized — you must re-attach them after deserialization.
     */
    toJSON() {
        const out = {
            _version:    SpritesheetPlayer.VERSION,
            grid:        { cols: this.cols, rows: this.rows },
            frameSize:   { w: this.frameWidth, h: this.frameHeight },
            margin:      _sp_shallow(this.margin),
            padding:     _sp_shallow(this.padding),
            order:       this.order,
            frameRects:  this.frameRects.slice(),
            defaultFps:  this.defaultFps,
            speed:       this.speed,
            timeScale:   this.timeScale,
            defaultAnimation: this.defaultAnimationName,
            animations:  {},
            state:       this.getState()
        };
        for (const [name, anim] of this.animations) out.animations[name] = anim.toJSON();
        return out;
    }

    /**
     * Rebuild a SpritesheetPlayer from JSON data. The image must be provided
     * separately because p5.Image objects aren't JSON-serializable.
     */
    static fromJSON(data, image) {
        const p = new SpritesheetPlayer({
            image:     image,
            grid:      data.grid,
            frameSize: data.frameSize,
            margin:    data.margin,
            padding:   data.padding,
            order:     data.order,
            frameRects: data.frameRects,
            defaultFps: data.defaultFps,
            speed:     data.speed,
            timeScale: data.timeScale,
            defaultAnimation: data.defaultAnimation
        });
        if (data.animations) {
            for (const name of Object.keys(data.animations)) {
                p.addAnimation(name, data.animations[name]);
            }
        }
        if (data.state) p.loadState(data.state);
        return p;
    }

    /**
     * Factory: build a player from a simple "atlas" object. The atlas format
     * is:
     *   {
     *     frames: [ { x, y, w, h }, ... ],        // optional explicit rects
     *     grid:   { cols, rows, frameW?, frameH? }, // or a grid description
     *     animations: {
     *        name1: { frames: [...], fps, loop, ... },
     *        ...
     *     },
     *     defaultAnimation: 'name1'
     *   }
     */
    static fromAtlas(image, atlas, extraConfig) {
        const cfg = Object.assign({
            image: image,
            grid: atlas.grid,
            frameSize: atlas.grid ? { w: atlas.grid.frameW || 0, h: atlas.grid.frameH || 0 } : undefined,
            frameRects: atlas.frames,
            defaultAnimation: atlas.defaultAnimation
        }, extraConfig || {});
        const p = new SpritesheetPlayer(cfg);
        if (atlas.animations) {
            for (const name of Object.keys(atlas.animations)) {
                p.addAnimation(name, atlas.animations[name]);
            }
        }
        return p;
    }

    /**
     * Convenience preload helper. Takes an object where values are image
     * paths and returns an object of the same shape with loaded p5.Image's.
     * Must be called from p5's preload() to guarantee loading completion.
     *
     *   images = SpritesheetPlayer.preloadImages({
     *       hero:   'assets/images/hero.png',
     *       enemy:  'assets/images/slime.png'
     *   });
     */
    static preloadImages(paths) {
        const out = {};
        for (const key of Object.keys(paths)) {
            out[key] = loadImage(paths[key]);
        }
        return out;
    }

    /** Remove every listener and abandon the current animation reference. */
    destroy() {
        this._listeners = {};
        this.stop();
        this.currentAnimation = null;
        this._fire('destroy');
        return this;
    }
}


/* ============================================================================
 *  EXPORTS
 *  Expose symbols globally so they are usable from any script tag loaded
 *  after this file.
 * ========================================================================== */
if (typeof window !== 'undefined') {
    window.SpritesheetPlayer    = SpritesheetPlayer;
    window.SpritesheetAnimation = SpritesheetAnimation;
    window.SP_LoopMode          = SP_LoopMode;
    window.SP_PlayDirection     = SP_PlayDirection;
    window.SP_Anchor            = SP_Anchor;
    window.SP_FrameOrder        = SP_FrameOrder;
    window.SP_PlaybackState     = SP_PlaybackState;
    window.SP_BlendMode         = SP_BlendMode;
}

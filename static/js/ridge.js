/* Seasonal ridge.
 *
 * A view over the Green Mountains, drawn the way Return of the Obra Dinn
 * draws one: a low-resolution buffer, a tone value per pixel, and an ordered
 * Bayer threshold deciding which step of a small palette that tone lands on.
 * Gradients break into stipple, the skyline breaks into pixels, and the whole
 * thing moves.
 *
 * The ridge, the tree bands and the dissolve into the page are one engine.
 * A season supplies everything that changes with the calendar: the palette,
 * what covers the ground, what kind of trees stand on it, what falls out of
 * the sky, and where the picture dissolves to. Each season lives in its own
 * theme file (winter-theme.js, autumn-theme.js, spring-theme.js), which
 * registers raw RGB data before this engine runs. The calendar mapping lives
 * in the inline script in layouts/_default/baseof.html.
 */
(function () {
    var canvas = document.getElementById("scene");
    var host = document.getElementById("hero");
    if (!canvas || !host || !canvas.getContext) return;

    var ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------------------------------------------------------------- *
     * Palette plumbing
     * ---------------------------------------------------------------- */

    var LE = (function () {
        var b = new ArrayBuffer(4);
        new Uint32Array(b)[0] = 0x01020304;
        return new Uint8Array(b)[0] === 0x04;
    })();

    function pack(r, g, b) {
        return LE
            ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
            : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
    }

    function ramp(rgb) {
        var out = new Uint32Array(rgb.length);
        for (var i = 0; i < rgb.length; i++) {
            out[i] = pack(rgb[i][0], rgb[i][1], rgb[i][2]);
        }
        return out;
    }

    /* One step of a ramp, chosen by a fractional index and the dither
     * threshold. Shared by the tone-driven shades and by the dissolve,
     * which walks its own ramp by index rather than by tone. */
    function pick(ramp, index, thr) {
        var i = (index + thr) | 0;
        return ramp[i > ramp.length - 1 ? ramp.length - 1 : i < 0 ? 0 : i];
    }

    /* Tone plus threshold, clamped into a ramp. Works for ramps of any
     * length, which matters because the trees use four steps and the
     * landscape uses eight. */
    function shade(ramp, tone, thr) {
        return pick(ramp, tone * ramp.length, thr);
    }

    /* ---------------------------------------------------------------- *
     * Ordered dithering
     * ---------------------------------------------------------------- */

    var BAYER = [
        0, 32, 8, 40, 2, 34, 10, 42,
        48, 16, 56, 24, 50, 18, 58, 26,
        12, 44, 4, 36, 14, 46, 6, 38,
        60, 28, 52, 20, 62, 30, 54, 22,
        3, 35, 11, 43, 1, 33, 9, 41,
        51, 19, 59, 27, 49, 17, 57, 25,
        15, 47, 7, 39, 13, 45, 5, 37,
        63, 31, 55, 23, 61, 29, 53, 21
    ];
    var THRESH = new Float32Array(64);
    for (var b = 0; b < 64; b++) THRESH[b] = (BAYER[b] + 0.5) / 64;

    /* ---------------------------------------------------------------- *
     * Sine table, and the odds and ends built on it
     * ---------------------------------------------------------------- */

    var LUT_N = 4096;
    var SIN = new Float32Array(LUT_N);
    for (var s = 0; s < LUT_N; s++) SIN[s] = Math.sin((s / LUT_N) * Math.PI * 2);

    /* sin() of an angle given in turns, where 1.0 is a full revolution. */
    function sn(turns) {
        return SIN[(turns * LUT_N | 0) & (LUT_N - 1)];
    }

    /* Rational stand-in for exp(-k): on a dithered field the difference is
     * invisible and it costs a multiply. */
    function falloff(v, k) {
        var u = v * k;
        return 1 / (1 + u * u);
    }

    function clamp01(v) {
        return v < 0 ? 0 : v > 1 ? 1 : v;
    }

    /* Deterministic hash, so nothing shimmers between frames. The final
     * avalanche matters: the plain xor-shift below it leaves the top bit
     * unset, which caps the result at 0.5 and confines every value derived
     * from it to the left half of the picture. */
    function hash(x, y) {
        var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 15), 2246822519);
        h = Math.imul(h ^ (h >>> 13), 3266489917);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    /* Small seeded generator, for deciding where the trees go. */
    function rng(seed) {
        return function () {
            seed = (seed + 0x6d2b79f5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ---------------------------------------------------------------- *
     * The seasons
     *
     * Every palette runs dark to light and its first or last step is the
     * page colour, depending on whether the picture dissolves to a dark
     * page or a light one. That way the foot of the canvas always lands on
     * the exact colour of the page behind it. A season may also supply its
     * own `fade` ramp, which keeps the dissolve in ground tones instead of
     * walking the main palette up to the page, and a `fog` height, which
     * lets that veil climb into the treeline instead of staying below every
     * trunk. Theme files register raw RGB triples; the ramps are packed
     * here, where the palette byte order and dither helpers live.
     * ---------------------------------------------------------------- */

    var THEMES = {};

    function compileTheme(source) {
        var compiled = {};
        for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) compiled[key] = source[key];
        }
        compiled.palette = ramp(source.palette);
        compiled.shadow = ramp(source.shadow);
        if (source.fade) compiled.fade = ramp(source.fade);
        if (source.particles) {
            compiled.particles = {};
            for (var particleKey in source.particles) {
                if (Object.prototype.hasOwnProperty.call(source.particles, particleKey)) {
                    compiled.particles[particleKey] = source.particles[particleKey];
                }
            }
            if (source.particles.tint) compiled.particles.tint = ramp(source.particles.tint);
        }
        return compiled;
    }

    /* Theme scripts load before this engine (defer preserves order) and
     * register themselves on window.SeasonalRidgeThemes. */
    (function registerThemes() {
        var seasonalThemes = window.SeasonalRidgeThemes;
        if (!seasonalThemes) return;
        for (var name in seasonalThemes) {
            if (Object.prototype.hasOwnProperty.call(seasonalThemes, name)) {
                THEMES[name] = compileTheme(seasonalThemes[name]);
            }
        }
    })();

    /* The inline script in baseof.html has already resolved the date to one
     * of these names, so the page never paints one palette and then swaps to
     * another. Fall back gracefully if it is missing. */
    var theme = THEMES[document.documentElement.getAttribute("data-season")] || THEMES.winter || THEMES.autumn || THEMES.spring;
    if (!theme) return;
    var PAL = theme.palette;
    /* The page colour is whatever the foot of the picture lands on: the end
     * of the season's own fade ramp if it has one, otherwise the end of the
     * main palette that `fadeTo` points at. Trees and particles stipple to
     * this same value, so reading it from the fade ramp keeps them in step
     * with the ground. */
    var pageColor = theme.fade
        ? theme.fade[theme.fade.length - 1]
        : PAL[theme.fadeTo > 0 ? PAL.length - 1 : 0];

    /* ---------------------------------------------------------------- *
     * Trees. Two silhouettes, drawn once into tiny buffers so each one
     * keeps hard pixel edges: 0 = sky, 1 = body, 2 = lit foliage, and
     * 3 = bark for hardwoods.
     *
     * The shape is laid out in fractions of the buffer rather than in
     * pixels of one fixed size, and every size gets its own rasterisation.
     * Shrinking a finished tree by sampling every other pixel does not
     * work: the boughs are mostly thin, so a sampled-down spruce loses
     * everything but the trunk and comes out as a bare post.
     * ---------------------------------------------------------------- */

    var SW = 26;
    var SH = 36;
    var BROADLEAF_VARIANTS = 6;
    var SPRUCE_VARIANTS = 3;
    var SPRITES = {};

    function treeSprite(kind, div, variant) {
        var key = kind + ":" + div + ":" + variant;
        if (SPRITES[key]) return SPRITES[key];
        var spr = kind === "broadleaf" ? broadleaf(div, variant) : spruce(div, variant);
        SPRITES[key] = spr;
        return spr;
    }

    function spruce(div, variant) {
        var w = Math.max(5, Math.round(SW / div));
        var h = Math.max(8, Math.round(SH / div));
        var r = rng(variant * 7919 + Math.round(div * 1000) + 13);
        var cx = w / 2;

        /* Body and lit foliage are collected as separate lists of polygons
         * and filled one material at a time, because a single pass cannot
         * tell them apart where they meet: every pixel on that seam is a
         * blend of the two, and a tree is mostly seam at the smaller sizes.
         * Filling them separately gives each its own coverage to be tested
         * against, so the join costs a hard edge instead of a row of holes. */
        var timber = [];
        var light = [];

        /* The trunk only runs up to where the boughs are already wider than
         * it is. Any higher and it stands out above the foliage as a bare
         * post. */
        var trunkW = Math.max(1, Math.round(w * 0.07));
        var trunkX = Math.round(cx - trunkW / 2);
        var trunkY = Math.round(h * 0.05);
        timber.push([trunkX, trunkY, trunkX, h, trunkX + trunkW, h, trunkX + trunkW, trunkY, 1]);

        /* Tiers, widest at the bottom, each with a lit edge. A bough every
         * three rows or so: any fewer and the ones that are left sit too far
         * apart to read as tiers rather than as blobs on a stick. */
        var tiers = Math.max(4, Math.round(h / 3));
        var top0 = h * 0.94;
        var top1 = h * 0.05;
        var halfMax = w / 2 - 0.6;
        var drop = (top0 - top1) / tiers * 1.1;
        var band = Math.max(0.7, h * 0.024);

        for (var i = 0; i < tiers; i++) {
            var t = i / (tiers - 1);
            var top = top0 - t * (top0 - top1);
            var half = halfMax * (0.16 + 0.84 * (1 - t)) * (0.82 + r() * 0.36);
            var d = drop + t * h * 0.03;

            timber.push([cx, top, cx - half, top + d, cx + half, top + d, cx, top, 0]);

            var a = top + band * 0.8;
            var b = top + band * 1.1;
            var e = top + d - band * 1.4;
            light.push([cx, a, cx - half * 0.9, top + d, cx - half * 0.45, e, cx, b, 0]);
            light.push([cx, a, cx + half * 0.9, top + d, cx + half * 0.45, e, cx, b, 0]);
        }

        return rasterise(w, h, timber, light);
    }

    /* A hardwood built from stepped masses, not ellipses. The canopy is an
     * uneven stack of leaf clumps, each a rectangle with its corners cut,
     * with a different silhouette on each side. A dark trunk forks through
     * its lower half and flares into roots at the ground; drawing the bark
     * last keeps those branches visible against the foliage. At this
     * resolution, round crowns and one-colour trunks read as lollipops no
     * matter how they are shaded. */
    function broadleaf(div, variant) {
        var w = Math.max(5, Math.round(SW / div));
        var h = Math.max(8, Math.round(SH / div));
        var r = rng(variant * 4241 + Math.round(div * 1000) + 29);
        var body = [];
        var bark = [];

        function block(x, y, bw, bh) {
            x = Math.round(x);
            y = Math.round(y);
            bw = Math.max(1, Math.round(bw));
            bh = Math.max(1, Math.round(bh));
            return [x, y, x + bw, y, x + bw, y + bh, x, y + bh, 0];
        }

        /* A leaf mass: the same rectangle as block(), with its corners cut.
         * A bare rectangle reads as a Lego brick at this size and a stack of
         * them as a building, which is exactly what a pale crown exposes.
         * A bevel of one or two pixels is enough for the union of several
         * masses to read as foliage again, and it keeps the stepped look the
         * hardwood is built on. */
        function clump(x, y, bw, bh) {
            var x0 = Math.round(x);
            var y0 = Math.round(y);
            var x1 = x0 + Math.max(2, Math.round(bw));
            var y1 = y0 + Math.max(2, Math.round(bh));
            var c = Math.min(2, (x1 - x0) * 0.28, (y1 - y0) * 0.35);
            return [
                x0 + c, y0, x1 - c, y0,
                x1, y0 + c, x1, y1 - c,
                x1 - c, y1, x0 + c, y1,
                x0, y1 - c, x0, y0 + c, 0
            ];
        }

        /* A tapered limb, narrowing towards its tip. */
        function limb(x0, y0, x1, y1, width) {
            var dx = x1 - x0;
            var dy = y1 - y0;
            var len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            var nx = -dy / len * width * 0.5;
            var ny = dx / len * width * 0.5;
            return [
                x0 + nx, y0 + ny,
                x1 + nx * 0.55, y1 + ny * 0.55,
                x1 - nx * 0.55, y1 - ny * 0.55,
                x0 - nx, y0 - ny, 0];
        }

        /* At the distance bands the detailed construction breaks apart
         * into blocks only a pixel or two across. A distant tree here is a
         * silhouette, not a portrait: one solid chestnut-shaped mass and a
         * thick trunk. */
        if (h < 20) {
            var leanS = (r() - 0.5) * w * 0.1;
            var cxS = w * 0.5 + leanS;
            var crownWS = w * (0.7 + r() * 0.1);
            var leftS = cxS - crownWS * 0.5;
            var topS = h * 0.04;
            var midS = h * 0.26;

            body.push(clump(cxS - crownWS * 0.25, topS, crownWS * 0.52, h * 0.2));
            body.push(clump(leftS + crownWS * 0.06, topS + h * 0.13,
                crownWS * 0.72, h * 0.2));
            body.push(clump(leftS, midS + h * 0.02, crownWS, h * 0.22));
            body.push(clump(leftS + crownWS * 0.13, midS + h * 0.21,
                crownWS * 0.7, h * 0.15));

            var forkS = h * 0.6;
            bark.push([
                cxS - 1, h,
                cxS - 1, forkS,
                cxS + 1, forkS,
                cxS + 1, h, 0]);
            bark.push(limb(cxS, forkS, cxS - w * 0.14, h * 0.32, 1));
            bark.push(limb(cxS, forkS, cxS + w * 0.14, h * 0.32, 1));
            bark.push(block(cxS - 1.5, h - 1, 3, 1));

            return rasterise(w, h, body, null, bark);
        }

        /* Six small variations on the same tree, rather than a second
         * species: narrow and tall, broad and low, left- or right-leaning,
         * and two asymmetric crowns. The rasterised details still vary with
         * the seeded generator, but these are the silhouettes the eye reads. */
        var shapes = [
            { width: 0.74, top: 0.025, mid: 0.19, low: 0.41, lean: 0, fork: 0.57 },
            { width: 0.66, top: 0.01, mid: 0.16, low: 0.37, lean: 0.04, fork: 0.55 },
            { width: 0.8, top: 0.05, mid: 0.22, low: 0.44, lean: -0.03, fork: 0.6 },
            { width: 0.72, top: 0.025, mid: 0.18, low: 0.4, lean: -0.07, fork: 0.56 },
            { width: 0.76, top: 0.015, mid: 0.2, low: 0.39, lean: 0.06, fork: 0.58 },
            { width: 0.79, top: 0.055, mid: 0.21, low: 0.42, lean: -0.01, fork: 0.59 }
        ];
        var shape = shapes[variant % shapes.length];
        var lean = shape.lean * w + (r() - 0.5) * w * 0.03;
        var cx = w * 0.5 + lean;
        var crownW = w * (shape.width + (r() - 0.5) * 0.04);
        var left = cx - crownW * 0.5;
        var top = h * (shape.top + r() * 0.012);
        var mid = h * (shape.mid + (r() - 0.5) * 0.018);
        var low = h * (shape.low + (r() - 0.5) * 0.018);
        /* Broken, overlapping leaf masses. The exposed corners and unequal
         * lower lobes are intentional: the canopy should have places where
         * a branch could plausibly carry it. */
        body.push(clump(left + crownW * 0.17, top, crownW * 0.5, h * 0.15));
        body.push(clump(left + crownW * 0.52, top + h * 0.035, crownW * 0.3, h * 0.18));
        body.push(clump(left + crownW * 0.04, mid - h * 0.045, crownW * 0.55, h * 0.2));
        body.push(clump(left + crownW * 0.46, mid, crownW * 0.48, h * 0.21));
        body.push(clump(left, mid + h * 0.07, crownW * 0.36, h * 0.16));
        body.push(clump(left + crownW * 0.67, mid + h * 0.08, crownW * 0.31, h * 0.15));
        body.push(clump(left + crownW * 0.12, low, crownW * 0.34, h * 0.14));
        body.push(clump(left + crownW * 0.43, low + h * 0.015, crownW * 0.36, h * 0.15));
        if (variant % 2) {
            body.push(clump(left + crownW * 0.72, low + h * 0.03, crownW * 0.2, h * 0.1));
        } else {
            body.push(clump(left + crownW * 0.03, low + h * 0.025, crownW * 0.2, h * 0.1));
        }

        /* A thick trunk, two main forks, and a pair of smaller side limbs.
         * These reach into the canopy instead of stopping underneath it. */
        var forkY = h * shape.fork;
        var footW = Math.max(2, w * 0.17);
        bark.push([
            cx - footW * 0.65, h,
            cx - w * 0.045, forkY,
            cx + w * 0.045, forkY,
            cx + footW * 0.65, h, 0]);
        bark.push(block(cx - footW * 0.85, h - 1, footW * 1.7, 1));
        bark.push(limb(cx, forkY + h * 0.04,
            cx - w * 0.2, h * 0.31, Math.max(1.5, w * 0.1)));
        bark.push(limb(cx - w * 0.15, h * 0.39,
            cx - w * 0.29, h * 0.22, Math.max(1, w * 0.055)));
        bark.push(limb(cx, forkY,
            cx + w * 0.19, h * 0.3, Math.max(1.5, w * 0.09)));
        bark.push(limb(cx + w * 0.14, h * 0.38,
            cx + w * 0.3, h * 0.24, Math.max(1, w * 0.05)));
        bark.push(limb(cx, h * 0.72,
            cx - w * 0.19, h * 0.58, Math.max(1, w * 0.065)));

        return rasterise(w, h, body, null, bark);
    }

    function rasterise(w, h, body, lit, bark) {
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        var g = c.getContext("2d");
        var buf = new Uint8Array(w * h);

        function paint(target, list) {
            target.clearRect(0, 0, w, h);
            target.fillStyle = "#000";
            for (var p = 0; p < list.length; p++) {
                var q = list[p];
                if (q[q.length - 1] === 1) {
                    target.fillRect(q[0], q[1], q[2] - q[0], q[5] - q[1]);
                    continue;
                }
                /* The last slot is the flag, so the polygon itself can be
                 * any number of points: the canopy masses are beveled
                 * octagons and the boughs are quads. */
                var n = (q.length - 1) >> 1;
                target.beginPath();
                target.moveTo(q[0], q[1]);
                for (var v = 1; v < n; v++) target.lineTo(q[v * 2], q[v * 2 + 1]);
                target.closePath();
                target.fill();
            }
        }

        /* Untouched pixels are transparent, so alpha decides what is sky
         * and what is tree. */
        paint(g, body);
        var d = g.getImageData(0, 0, w, h).data;
        for (var k = 0; k < buf.length; k++) {
            if (d[k * 4 + 3] >= 128) buf[k] = 1;
        }

        if (lit && lit.length) {
            var lc = document.createElement("canvas");
            lc.width = w;
            lc.height = h;
            var lg = lc.getContext("2d");
            paint(lg, lit);
            var dl = lg.getImageData(0, 0, w, h).data;
            for (var k2 = 0; k2 < buf.length; k2++) {
                if (dl[k2 * 4 + 3] >= 128) buf[k2] = 2;
            }
        }

        if (bark && bark.length) {
            /* Bark is a separate material, painted last so the trunk and
             * the main forks remain visible through the lower canopy. */
            paint(g, bark);
            var db = g.getImageData(0, 0, w, h).data;
            for (var k3 = 0; k3 < buf.length; k3++) {
                if (db[k3 * 4 + 3] >= 128) buf[k3] = 3;
            }
        }

        return { buf: buf, w: w, h: h };
    }

    /* ---------------------------------------------------------------- *
     * Buffer and layout
     * ---------------------------------------------------------------- */

    var img = null;
    var px32 = null;
    var iw = 0;
    var ih = 0;

    var mx = 0;      /* sun or moon centre        */
    var my = 0;
    var mr = 0;      /* sun or moon radius        */
    var ridge = [];  /* the skyline, per column   */
    var fieldRows = null; /* the near field edge, per column */
    var fadeRows = null;  /* the dissolve edge, per column   */
    var litCol = null;    /* the sheet light, per column     */
    var fadeRow = 0; /* first row of the dissolve */
    var trees = [];
    var flakes = [];

    /* Where the near field is cut off by the slope in front of it. It
     * drifts, rather than ruling a dead straight line across the picture.
     * Both the field itself and the treeline are read off this, so the two
     * cannot disagree about where the ground is. */
    function fieldLineAt(u) {
        return ih * 0.72 +
            (sn(u * 2.7 + 0.2) * 0.6 + sn(u * 6.1 + 1.1) * 0.4) * ih * 0.05;
    }

    /* The ground the trees stand on: the same contour, a little way down
     * its face, with a slower swell and some finer wobble on top so no two
     * neighbouring trunks end up at quite the same height. */
    function treeGroundAt(u) {
        return fieldLineAt(u) + ih * 0.03 +
            ih * 0.015 * sn(u * 1.9 + 0.5) + ih * 0.008 * sn(u * 8.7 + 2.1);
    }

    /* A tree's body ramp, washed towards the haze by however far back it
     * stands. The far bands should look like they are behind air, not like
     * they were painted a paler green. */
    function treeRamp(rgb, wash, haze) {
        var out = new Uint32Array(rgb.length);
        for (var k = 0; k < rgb.length; k++) {
            var c = rgb[k];
            out[k] = pack(
                c[0] + (haze[0] - c[0]) * wash,
                c[1] + (haze[1] - c[1]) * wash,
                c[2] + (haze[2] - c[2]) * wash);
        }
        return out;
    }

    function layout() {
        var w = host.clientWidth;
        var h = host.clientHeight;
        var scale = w < 720 ? 2 : 3;

        iw = Math.max(32, Math.ceil(w / scale));
        ih = Math.max(32, Math.ceil(h / scale));
        canvas.width = iw;
        canvas.height = ih;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";

        img = ctx.createImageData(iw, ih);
        px32 = new Uint32Array(img.data.buffer);

        /* Sun or moon, up in the sky where the palette can do the most. */
        mr = Math.max(4, ih * theme.disc.r);
        mx = Math.round(iw * theme.disc.x);
        my = Math.round(ih * theme.disc.y);

        /* The skyline: a broad dome just right of centre, a lower shoulder
         * on the left where the valley runs out, and enough fine noise to
         * stop the edge reading as a dune. The composition is shared by
         * every season; only the light on it changes. */
        ridge = new Float32Array(iw);
        for (var x = 0; x < iw; x++) {
            var u = x / iw;
            var dome = Math.exp(-Math.pow((u - 0.63) / 0.34, 2));
            var shoulder = Math.exp(-Math.pow((u - 0.04) / 0.3, 2));
            ridge[x] = ih * 0.63 - ih * 0.2 * dome - ih * 0.075 * shoulder +
                ih * 0.012 * sn(u * 7.3) + ih * 0.008 * sn(u * 19.1 + 0.3);
        }

        /* Two more per-column curves read by the frame. The near-field edge
         * is where the ground begins; the sheet light is one value per
         * column, shared by the mountain and the field, which is what keeps
         * the join between them from showing as a line. Both are fixed
         * between resizes, so build them here instead of recomputing them
         * for every pixel of every frame. */
        fieldRows = new Float64Array(iw);
        litCol = new Float32Array(iw);
        for (var x = 0; x < iw; x++) {
            fieldRows[x] = fieldLineAt(x / iw);
            litCol[x] = theme.light.base +
                theme.light.gain * falloff(x - mx, 1 / (iw * theme.light.width));
        }

        /* Trees in three depth bands, every one of them standing on that
         * ground: the treeline runs along the top of the field and then
         * steps down the slope towards the viewer, and each band sits on the
         * same contour as the one behind it rather than on a flat row of its
         * own. All of it stays above the dissolve, so the lightening at the
         * foot of the picture has nothing to cut through. Small and hazy at
         * the back, dark and full size in front. */
        var r = rng(theme.seed);
        trees = [];
        var bands = [
            { drop: 0, div: 3, per: 0.094, dim: 0.26 },
            { drop: 0.024, div: 2, per: 0.056, dim: 0.14 },
            { drop: 0.05, div: 1.45, per: 0.035, dim: 0 }
        ];
        for (var bi = 0; bi < bands.length; bi++) {
            var band = bands[bi];
            /* Per column, not a fixed count: a treeline that thins out with
             * the window is the wrong way round. */
            var count = Math.max(5, Math.round(iw * band.per));
            for (var i = 0; i < count; i++) {
                var kind = theme.trees.kinds[(r() * theme.trees.kinds.length) | 0];
                var spr = treeSprite(kind, band.div,
                    (r() * (kind === "broadleaf" ? BROADLEAF_VARIANTS : SPRUCE_VARIANTS)) | 0);
                /* Jitter first, so the ground is read at the trunk's own
                 * column and the scatter follows the contour with it. */
                var tu = r();
                var foot = treeGroundAt(tu) + ih * band.drop + (r() - 0.5) * ih * 0.022;

                /* Bleed off either edge, but never so far that the tree is a
                 * single column of pixels against the margin. */
                var tx = Math.round(r() * (iw + spr.w - 3) - (spr.w - 3) * 0.5);

                var ramps = theme.trees.ramps[kind];
                var base = ramps[(r() * ramps.length) | 0];
                var wash = Math.min(
                    theme.trees.hazeWash[0], band.dim * theme.trees.hazeWash[1]);
                var tone = theme.trees.tone[kind];
                var cap = theme.trees.cap && theme.trees.cap[kind];

                trees.push({
                    buf: spr.buf,
                    w: spr.w,
                    h: spr.h,
                    x: tx,
                    y: Math.round(foot - spr.h),
                    foot: foot,
                    dim: band.dim,
                    ramp: treeRamp(base, wash, theme.trees.haze),
                    /* Haze softens foliage, but bark must keep its contrast
                     * or the forks vanish and the tree becomes a mushroom. */
                    bark: theme.trees.bark
                        ? treeRamp(theme.trees.bark, wash * 0.2, theme.trees.haze)
                        : null,
                    toneBase: tone[0],
                    toneDim: tone[1],
                    capBase: cap ? cap[0] : 0,
                    capDim: cap ? cap[1] : 0,
                    capFloor: (theme.trees.capFloor && theme.trees.capFloor[kind]) || 0
                });
            }
        }
        /* Back to front, so the near trunks overlap the far ones. */
        trees.sort(function (a, b) { return a.foot - b.foot; });

        /* Where the picture falls away into the page, normally kept below
         * every trunk so the dissolve never has a tree to cut through. A
         * season with `fog` sets the edge itself instead, letting the veil
         * climb into the treeline: the trunks then fade at the foot the
         * same way everything else does, which is what fog looks like. */
        fadeRow = Math.round(ih * (theme.fog || 0.875));
        if (!theme.fog) {
            for (var ti = 0; ti < trees.length; ti++) {
                var low = Math.round(trees[ti].foot) + 2;
                if (low > fadeRow) fadeRow = low;
            }
        }
        if (fadeRow > ih - 6) fadeRow = ih - 6;

        /* The dissolve edge drifts rather than ruling a line, so bake its
         * per-column height once the row it hangs from is settled. */
        fadeRows = new Float64Array(iw);
        for (var x = 0; x < iw; x++) {
            var u = x / iw;
            fadeRows[x] = fadeRow +
                (sn(u * 3.1 + 0.4) * 0.6 + sn(u * 7.3 + 2.2) * 0.4) * ih * 0.03;
        }

        /* Snow where the season calls for it. Sparse on purpose: a dense
         * sheet stops reading as weather and starts reading as noise over
         * the sky, and the ridge is the subject, not the fall. */
        flakes = [];
        var p = theme.particles;
        var n = p ? Math.round(iw * ih / p.density) : 0;
        for (var f = 0; f < n; f++) {
            flakes.push({
                x: r() * iw,
                y: r() * ih,
                /* Slow. A flake should take its time getting down, so the
                 * fall reads as drifting rather than as scrolling. */
                v: p.vMin + r() * (p.vMax - p.vMin),
                d: 0.4 + r() * 1.5,
                /* A steady wind off the ridge, so the fall runs the width
                 * of the picture and wraps at whichever edge it reaches
                 * instead of dropping straight down in place. */
                w: p.windMin + r() * (p.windMax - p.windMin),
                near: r()
            });
        }
    }

    /* ---------------------------------------------------------------- *
     * Frame
     * ---------------------------------------------------------------- */

    /* How far the picture has fallen into the page at this pixel, zero to
     * one. Eased, so the dissolve does not begin with a step of its own.
     * The edge is the drifting per-column height built in layout(), which
     * is what keeps the boundary from reading as a ruled line. */
    function fadeAt(x, y) {
        var edge = fadeRows[x];
        if (y < edge) return 0;
        var f = (y - edge) / Math.max(1, ih - 1 - fadeRow);
        if (f > 1) f = 1;
        return f * f * (3 - 2 * f);
    }

    /* Move a tone towards the page: dark in winter, light in autumn. */
    function dissolve(tone, f) {
        return tone + (theme.fadeTo - tone) * f;
    }

    function render(t, dt) {
        var data = px32;
        var thr = THRESH;
        var row = 0;
        var invHalo = 1 / (mr * theme.disc.spread);
        var parts = theme.particles;

        function flakeColor(px, py, thrVal) {
            var tone = 1 - fadeAt(px, py);
            if (tone <= 0) return 0;
            /* A tinted season keeps its particles on a fixed band of their
             * own ramp. Walking the main palette would make a petal as
             * bright as the sky it falls across, which is why blossom gets
             * its own blush ramp instead. */
            if (parts.tint) return pick(parts.tint, 1.5 + tone, thrVal);
            return shade(PAL, tone, thrVal);
        }

        for (var y = 0; y < ih; y++) {
            var v = y / ih;
            var dithRow = (y & 7) << 3;

            for (var x = 0; x < iw; x++, row++) {
                var u = x / iw;
                var dx = x - mx;
                var dy = y - my;
                var dr = Math.sqrt(dx * dx + dy * dy);
                var halo = theme.disc.halo * falloff(dr, invHalo);
                var fieldLine = fieldRows[x];
                var onField = y > fieldLine;
                var L;
                /* Below half tone the picture uses the shadow ramp, which
                 * in winter is pine and in autumn is umber and olive. */
                var useDeep = false;
                /* A little noise under the threshold. Any smooth ramp long
                 * enough to cross a palette step does it along contours, and
                 * those contours come out as ruled lines once the dither has
                 * only two colours to work with; the noise breaks them into
                 * the same stipple as everything else. */
                var grain = (hash(x, y) - 0.5) * 0.05;

                if (onField) {
                    /* --- the near field -------------------------------- */
                    /* The same sheet the mountain is made of, carried on
                     * downhill: it takes the lit column where the ridge left
                     * it, so the two meet without a seam, and gives up more
                     * light with every row towards the viewer. That falloff
                     * is what puts the treeline against something brighter
                     * than itself; the season's field settings decide
                     * whether that sheet is snow or ground. */
                    var depth = (y - fieldLine) / Math.max(1, ih - fieldLine);
                    L = litCol[x] * theme.field.lit * (1 - theme.field.depth * depth) +
                        theme.field.lift * clamp01((y - fieldLine) / (ih * 0.16)) +
                        /* Drifting across the slope, not ruling it: the waves
                         * carry a term in v as well as u. */
                        0.05 * sn(u * 2.6 + v * 1.1 + t * 0.004) +
                        0.035 * sn(u * 5.3 - v * 1.7 + 1.3) +
                        grain + halo * theme.field.halo;
                    useDeep = theme.field.deep || L < 0.5;
                } else if (y < ridge[x]) {
                    /* --- sky ------------------------------------------- */
                    /* Deep overhead, opening out towards the ridge. */
                    L = theme.sky.base + theme.sky.range * Math.pow(v, theme.sky.power) +
                        halo * theme.sky.halo;

                    /* A thin scatter of stars, only up where it is darkest,
                     * and only in seasons that have a night. */
                    if (theme.sky.stars && L < 0.16 && hash(x, y) > 0.9986) {
                        L = Math.max(L, 0.4 + 0.35 * sn(t * 0.02 + hash(x + 7, y) * 30));
                    }

                    /* Cloud banks: two slow lit wisps and a heavier band
                     * drifting across the top of the ridge. */
                    for (var c = 0; c < 3; c++) {
                        var cy = ih * (0.14 + c * 0.2);
                        var drift = t * (0.006 + c * 0.004);
                        var thick = ih * (0.05 - c * 0.008);
                        var cyy = y - (cy + (sn(u * (1.1 + c * 0.5) + drift) * 0.6 +
                            sn(u * (2.9 - c * 0.6) - drift * 1.6) * 0.3) * ih * 0.06);
                        if (cyy > -thick && cyy < thick) {
                            var soft = 1 - Math.abs(cyy) / thick;
                            L += soft * soft * (0.15 + c * 0.05) *
                                clamp01(1.3 - Math.abs((u + drift) % 1 - 0.5) * 2 * 1.15);
                        }
                    }

                    /* The sky meets the ridge in the ridge's shadow tone.
                     * This runs last on purpose: the halo and the drifting
                     * banks come down low enough to touch the treeline, and
                     * if they brightened it, a moving bank would show as a
                     * pale patch sliding between the trees, in a different
                     * place every few seconds. Blending after everything
                     * keeps the whole coastline peaty twilight; only the
                     * sun's own disc stays bright. */
                    if (theme.sky.bridge) {
                        var gap = clamp01((ridge[x] - y) / Math.max(1, ih * 0.45));
                        L = L * (1 - gap) + theme.sky.bridge * gap;
                    }

                    /* The disc. */
                    if (dr < mr) L = dr > mr * 0.9 ? theme.disc.rim : 1;
                } else {
                    /* --- the mountain ---------------------------------- */
                    var below = (y - ridge[x]) / Math.max(1, ih - ridge[x]);
                    L = litCol[x] * theme.mountain.lit * (1 - theme.mountain.depth * below) +
                        halo * theme.mountain.halo;
                    L += 0.045 * sn(u * 13 + v * 8 + t * 0.01) * (1 - below) * theme.mountain.wave;
                    /* Cloud shadow crawling across the slope. */
                    L -= 0.08 * falloff(below, 3) * (0.5 + 0.5 * sn(u * 2.2 + t * 0.008));
                    L += grain;
                    useDeep = theme.mountain.deep || L < 0.5;
                }

                /* The foot of the picture dissolves into the page. Doing it
                 * here, through the same ordered dither as everything else,
                 * is what keeps it from reading as a stack of ruled bands
                 * laid over the landscape. */
                var f = fadeAt(x, y);
                var dith = thr[(x & 7) | dithRow];
                if (theme.fade && f > 0) {
                    /* Walk the ground's own ramp up into the page. The
                     * first steps match the shadow ramp, so the slope
                     * enters the dissolve without a seam; the rest climb
                     * through sage and bone to the page colour, keeping
                     * the foot of the picture in ground tones instead of
                     * handing it to the sky. */
                    var lo = L * theme.shadow.length;
                    var hi = theme.fade.length;
                    data[row] = pick(theme.fade, lo + (hi - lo) * f, dith);
                } else {
                    L = dissolve(L, f);
                    /* Once the dissolve takes over, the picture is heading
                     * for the page colour, which lives at one end of the
                     * main ramp; the shadow ramp would stop short of it. */
                    if (f > 0.02) useDeep = false;

                    data[row] = useDeep
                        ? shade(theme.shadow, L, dith)
                        : shade(PAL, L, dith);
                }
            }
        }

        /* Trees, painted over the slope. */
        for (var k = 0; k < trees.length; k++) {
            var tr = trees[k];
            var buf = tr.buf;
            var bodyTone = tr.toneBase + tr.dim * tr.toneDim;
            var capTone = tr.capBase - tr.dim * tr.capDim;
            /* Lit foliage catches the sky, but never reaches horizon
             * brightness: cap it differently by depth band. Near trees stay
             * bright for sunlit texture; distant trees stay below horizon
             * tone so their crowns cannot bridge into the sky behind them. */
            if (tr.capFloor && capTone < tr.capFloor) capTone = tr.capFloor;
            var capLimit = tr.dim > 0.2 ? 0.52 + tr.dim * 0.2 : 1;
            if (capTone > capLimit) capTone = capLimit;
            for (var ty = 0; ty < tr.h; ty++) {
                var py = tr.y + ty;
                if (py < 0 || py >= ih) continue;
                var src = ty * tr.w;
                var dithY = (py & 7) << 3;
                for (var tx = 0; tx < tr.w; tx++) {
                    var px = tr.x + tx;
                    if (px < 0 || px >= iw) continue;
                    var s = buf[src + tx];
                    if (!s) continue;
                    var idx = py * iw + px;
                    var tThr = thr[(px & 7) | dithY];
                    var tFade = fadeAt(px, py);
                    if (s === 2) {
                        data[idx] = tFade > tThr
                            ? pageColor
                            : shade(PAL, capTone, tThr);
                    } else if (s === 3) {
                        /* Bark stays dark brown regardless of the crown's
                         * colour or how strongly the foliage is hazed. */
                        data[idx] = tFade > tThr
                            ? pageColor
                            : shade(tr.bark, 0.36 + tr.dim * 0.25, tThr);
                    } else {
                        data[idx] = tFade > tThr
                            ? pageColor
                            : shade(tr.ramp, bodyTone, tThr);
                    }
                }
            }
        }

        /* Snowfall, in seasons that have it. */
        for (var n = 0; n < flakes.length; n++) {
            var fl = flakes[n];
            fl.y += fl.v * dt;
            fl.x += (fl.w + Math.sin(t * parts.rate + fl.d * 9) * fl.d * parts.sway) * dt;
            if (fl.y >= ih) {
                fl.y %= ih;
                fl.x = hash(n, (t * 37) | 0) * iw;
            }
            /* Both axes wrap with a modulo rather than a single step, so a
             * flake that travels more than the width of the buffer in one
             * go — wind, or a long frame after the tab was put to sleep —
             * comes back in at the far edge instead of dropping out of the
             * picture for good. */
            if (fl.x < 0) fl.x = (fl.x % iw + iw) % iw;
            else if (fl.x >= iw) fl.x %= iw;
            var fx = fl.x | 0;
            var fy = fl.y | 0;
            var fyDith = (fy & 7) << 3;

            var main = flakeColor(fx, fy, thr[(fx & 7) | fyDith]);
            if (!main) continue;

            if (fl.near > 0.84) {
                if (fx + 1 < iw) {
                    data[fy * iw + fx + 1] =
                        flakeColor(fx + 1, fy, thr[((fx + 1) & 7) | fyDith]);
                }
                if (fy + 1 < ih) {
                    data[(fy + 1) * iw + fx] =
                        flakeColor(fx, fy + 1, thr[(fx & 7) | (((fy + 1) & 7) << 3)]);
                }
            }
            data[fy * iw + fx] = main;
        }

        ctx.putImageData(img, 0, 0);
    }

    /* ---------------------------------------------------------------- *
     * Loop
     * ---------------------------------------------------------------- */

    layout();

    if (still) {
        render(9, 0);
    } else {
        var start = null;
        var last = 0;
        function frame(now) {
            if (start === null) { start = now; last = now; }
            var dt = (now - last) / 1000;
            last = now;
            if (dt > 0.05) dt = 0.05;
            render((now - start) / 1000, dt);
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    var pending = null;
    window.addEventListener("resize", function () {
        if (pending) clearTimeout(pending);
        pending = setTimeout(function () {
            pending = null;
            layout();
            if (still) render(9, 0);
        }, 150);
    });
})();

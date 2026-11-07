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
 * the sky, and where the picture dissolves to. Add a season by adding an
 * entry to SEASONS; the calendar mapping lives in the inline script in
 * layouts/_default/baseof.html.
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

    /* Tone plus threshold, clamped into a ramp. Works for ramps of any
     * length, which matters because the trees use four steps and the
     * landscape uses eight. */
    function shade(ramp, tone, thr) {
        var i = (tone * ramp.length + thr) | 0;
        return ramp[i > ramp.length - 1 ? ramp.length - 1 : i < 0 ? 0 : i];
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
     * page (winter) or a light one (autumn). That way the foot of the
     * canvas always lands on the exact colour of the page behind it.
     * ---------------------------------------------------------------- */

    /* Blue hour. Eight steps from near-black navy to snow white, spaced
     * roughly evenly in luminance so the dither has even work to do. */
    var WINTER_RGB = [
        [7, 11, 22],
        [15, 25, 48],
        [27, 43, 77],
        [44, 70, 112],
        [71, 106, 155],
        [114, 151, 194],
        [168, 194, 222],
        [238, 244, 251]
    ];

    /* Golden hour. Deep indigo overhead, plum and rose through the middle,
     * and a warm paper at the foot, which is also the page colour. */
    var AUTUMN_RGB = [
        [24, 25, 43],
        [44, 43, 71],
        [77, 58, 90],
        [122, 76, 88],
        [171, 98, 77],
        [207, 134, 82],
        [232, 177, 111],
        [245, 237, 218]
    ];

    /* Spruce timber, the one place the winter picture is properly green. */
    var WINTER_TIMBER = [
        [11, 24, 17],
        [18, 39, 27],
        [27, 57, 39],
        [40, 80, 55]
    ];

    /* Autumn foliage, one ramp per tree. A tree picks one when it is
     * planted, so the hillside is mixed rather than uniform. */
    var AUTUMN_FOLIAGE = [
        [[42, 24, 16], [78, 40, 18], [124, 64, 22], [174, 96, 36]],
        [[38, 20, 20], [76, 30, 24], [126, 48, 30], [178, 76, 42]],
        [[46, 38, 18], [86, 72, 24], [134, 108, 34], [184, 150, 56]]
    ];

    /* Bark has its own ramp: trunk and branches must not take their colour
     * from whichever foliage ramp the crown happened to draw. */
    var AUTUMN_BARK = [
        [22, 15, 13],
        [42, 24, 17],
        [70, 37, 21],
        [104, 55, 27]
    ];

    var THEMES = {
        winter: {
            palette: ramp(WINTER_RGB),
            shadow: ramp([
                WINTER_RGB[0],
                [15, 28, 24],
                [24, 44, 36],
                [38, 64, 54],
                WINTER_RGB[4]
            ]),
            seed: 20240211,
            /* The foot of the picture goes dark, into the dark page. */
            fadeTo: 0,
            light: { base: 0.7, gain: 0.14, width: 0.55 },
            disc: { x: 0.84, y: 0.2, r: 0.085, halo: 0.3, spread: 2.8, rim: 0.7 },
            sky: { base: 0.05, range: 0.48, power: 1.5, halo: 0.7, stars: true },
            mountain: { lit: 1, depth: 0.42, halo: 0.4, wave: 1 },
            field: { lit: 1, depth: 0.34, lift: 0.03, halo: 0.3, litter: 0 },
            trees: {
                kinds: ["spruce"],
                ramps: { spruce: [WINTER_TIMBER] },
                tone: { spruce: [0.34, 0.5] },
                cap: { spruce: [0.94, 0.7] },
                capFloor: { spruce: 0.4 },
                haze: [66, 98, 136]
            },
            particles: {
                density: 460,
                vMin: 7, vMax: 22,
                windMin: 3, windMax: 12,
                sway: 5, rate: 0.8,
                near: 0.84,
                colors: null
            }
        },

        autumn: {
            palette: ramp(AUTUMN_RGB),
            /* The dark half in autumn is ground, not pine: dark green
             * through olive and ochre to the russet the main ramp shares
             * at mid-tone. The field lives here, patchy with leaf litter. */
            shadow: ramp([
                AUTUMN_RGB[0],
                [30, 38, 30],
                [52, 52, 28],
                [84, 68, 30],
                AUTUMN_RGB[4]
            ]),
            seed: 20260922,
            /* Daylight fades up into the paper-coloured page. */
            fadeTo: 1,
            light: { base: 0.7, gain: 0.16, width: 0.5 },
            /* A low sun in the left shoulder, almost touching the ridge. */
            disc: { x: 0.2, y: 0.47, r: 0.07, halo: 0.55, spread: 4.2, rim: 0.88 },
            sky: { base: 0.1, range: 0.95, power: 1.15, halo: 0.7, stars: false },
            /* Backlit ridge: darker than the sky behind it. The sun column
             * would push it over half tone into sky colours if the light
             * and halo were left high, so both stay low: the ridge keeps
             * its olive and russet silhouette and the sun sits behind it. */
            mountain: { lit: 0.46, depth: 0.5, halo: 0.18, wave: 1.1 },
            /* Ground under leaf litter, not snow: dimmed so it lands in
             * the shadow ramp's greens and browns, with sparse fallen
             * leaves as single pixels on top. The sun's share is kept
             * small so the lit field does not detach from the dark ridge
             * as a pale wedge; it should read as the same ground, shading
             * off down the slope before the dissolve takes it up to the
             * paper page. The litter thins toward the sun, where lit
             * ground makes it read as dust. */
            field: { lit: 0.5, depth: 0.45, lift: 0.02, halo: 0.12, litter: 0.09 },
            trees: {
                kinds: ["broadleaf"],
                ramps: {
                    broadleaf: AUTUMN_FOLIAGE
                },
                tone: {
                    broadleaf: [0.3, 0.6]
                },
                cap: {
                    broadleaf: [0.8, 0.3]
                },
                capFloor: { broadleaf: 0 },
                haze: [236, 190, 130],
                bark: AUTUMN_BARK
            },
            /* Nothing falls from the autumn sky; the leaves stay on the
             * ground, where the field's litter already puts them. */
            particles: null
        }
    };

    /* The inline script in baseof.html has already resolved the date to one
     * of these names, so the page never paints one palette and then swaps to
     * another. Fall back gracefully if it is missing. */
    var theme = THEMES[document.documentElement.getAttribute("data-season")] || THEMES.winter;
    var PAL = theme.palette;
    var pageColor = PAL[theme.fadeTo > 0 ? PAL.length - 1 : 0];

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

        return rasterise(w, h, timber, light, null);
    }

    /* A hardwood built from stepped blocks, not ellipses. The canopy is an
     * uneven stack of rectangular leaf masses, with a different silhouette
     * on each side. A dark trunk forks through its lower half and flares
     * into roots at the ground; drawing the bark last keeps those branches
     * visible against the foliage. Small rectangular highlights supply the
     * leaf texture. At this resolution, round crowns and one-colour trunks
     * read as lollipops no matter how they are shaded. */
    function broadleaf(div, variant) {
        var w = Math.max(5, Math.round(SW / div));
        var h = Math.max(8, Math.round(SH / div));
        var r = rng(variant * 4241 + Math.round(div * 1000) + 29);
        var body = [];
        var lit = [];
        var bark = [];

        function block(x, y, bw, bh) {
            x = Math.round(x);
            y = Math.round(y);
            bw = Math.max(1, Math.round(bw));
            bh = Math.max(1, Math.round(bh));
            return [x, y, x + bw, y, x + bw, y + bh, x, y + bh, 0];
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

        /* Six small variations on the same tree, rather than a second
         * species: narrow and tall, broad and low, left- or right-leaning,
         * and two asymmetric crowns. The rasterised details still vary with
         * the seeded generator, but these are the silhouettes the eye reads. */
        var shapes = [
            { width: 0.82, top: 0.025, mid: 0.19, low: 0.36, lean: 0, fork: 0.57 },
            { width: 0.72, top: 0.01, mid: 0.16, low: 0.32, lean: 0.04, fork: 0.55 },
            { width: 0.9, top: 0.05, mid: 0.22, low: 0.39, lean: -0.03, fork: 0.6 },
            { width: 0.8, top: 0.025, mid: 0.18, low: 0.35, lean: -0.07, fork: 0.56 },
            { width: 0.84, top: 0.015, mid: 0.2, low: 0.34, lean: 0.06, fork: 0.58 },
            { width: 0.88, top: 0.055, mid: 0.21, low: 0.37, lean: -0.01, fork: 0.59 }
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
        body.push(block(left + crownW * 0.17, top, crownW * 0.5, h * 0.15));
        body.push(block(left + crownW * 0.52, top + h * 0.035, crownW * 0.3, h * 0.18));
        body.push(block(left + crownW * 0.04, mid - h * 0.045, crownW * 0.55, h * 0.2));
        body.push(block(left + crownW * 0.46, mid, crownW * 0.48, h * 0.21));
        body.push(block(left, mid + h * 0.07, crownW * 0.36, h * 0.16));
        body.push(block(left + crownW * 0.67, mid + h * 0.08, crownW * 0.31, h * 0.15));
        body.push(block(left + crownW * 0.12, low, crownW * 0.34, h * 0.14));
        body.push(block(left + crownW * 0.43, low + h * 0.015, crownW * 0.36, h * 0.15));
        if (variant % 2) {
            body.push(block(left + crownW * 0.72, low + h * 0.03, crownW * 0.2, h * 0.1));
        } else {
            body.push(block(left + crownW * 0.03, low + h * 0.025, crownW * 0.2, h * 0.1));
        }

        /* Small square glints, rather than the round spots that made the
         * old crowns look like bubbles. Clipping keeps them on leaves. */
        for (var j = 0; j < 9; j++) {
            lit.push(block(
                left + r() * crownW * 0.86,
                top + r() * h * 0.4,
                0.6 + r() * w * 0.09,
                0.6 + r() * h * 0.035));
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

        return rasterise(w, h, body, lit, "clip", bark);
    }

    function rasterise(w, h, body, lit, mode, bark) {
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
                if (q[8] === 1) {
                    target.fillRect(q[0], q[1], q[2] - q[0], q[5] - q[1]);
                    continue;
                }
                target.beginPath();
                target.moveTo(q[0], q[1]);
                target.lineTo(q[2], q[3]);
                target.lineTo(q[4], q[5]);
                target.lineTo(q[6], q[7]);
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

        if (lit.length) {
            var lc = document.createElement("canvas");
            lc.width = w;
            lc.height = h;
            var lg = lc.getContext("2d");
            paint(lg, lit);
            /* Keep the lit pixels on the crown. For the hardwood the lobes
             * may stray past the silhouette; clipping them to the body keeps
             * the crown from growing a stray speck. */
            if (mode === "clip") {
                lg.globalCompositeOperation = "destination-in";
                lg.drawImage(c, 0, 0);
            }
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
    var scale = 3;

    var mx = 0;      /* sun or moon centre        */
    var my = 0;
    var mr = 0;      /* sun or moon radius        */
    var ridge = [];  /* the skyline, per column   */
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
        scale = w < 720 ? 2 : 3;

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
                    (r() * (kind === "broadleaf" ? BROADLEAF_VARIANTS : 3)) | 0);
                /* Jitter first, so the ground is read at the trunk's own
                 * column and the scatter follows the contour with it. */
                var tu = r();
                var foot = treeGroundAt(tu) + ih * band.drop + (r() - 0.5) * ih * 0.022;

                /* Bleed off either edge, but never so far that the tree is a
                 * single column of pixels against the margin. */
                var tx = Math.round(r() * (iw + spr.w - 3) - (spr.w - 3) * 0.5);

                var ramps = theme.trees.ramps[kind];
                var base = ramps[(r() * ramps.length) | 0];
                var wash = Math.min(0.55, band.dim * 1.6);
                var tone = theme.trees.tone[kind];
                var cap = theme.trees.cap[kind];

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
                    capBase: cap[0],
                    capDim: cap[1],
                    capFloor: theme.trees.capFloor[kind]
                });
            }
        }
        /* Back to front, so the near trunks overlap the far ones. */
        trees.sort(function (a, b) { return a.foot - b.foot; });

        /* Where the picture falls away into the page, kept below every trunk
         * so the dissolve never has a tree to cut through. */
        fadeRow = Math.round(ih * 0.875);
        for (var ti = 0; ti < trees.length; ti++) {
            var low = Math.round(trees[ti].foot) + 2;
            if (low > fadeRow) fadeRow = low;
        }
        if (fadeRow > ih - 6) fadeRow = ih - 6;

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
                near: r(),
                color: p.colors ? p.colors[(r() * p.colors.length) | 0] : null
            });
        }
    }

    /* ---------------------------------------------------------------- *
     * Frame
     * ---------------------------------------------------------------- */

    var litCol = null;

    /* How far the picture has fallen into the page at this pixel, zero to
     * one. Eased, so the dissolve does not begin with a step of its own, and
     * with a drifting edge for the same reason the field and the skyline
     * have one: a boundary between two tones that runs dead straight across
     * the frame is the one thing in a picture like this that reads as a
     * ruled line rather than as a dither. */
    function fadeAt(x, y) {
        var u = x / iw;
        var edge = fadeRow +
            (sn(u * 3.1 + 0.4) * 0.6 + sn(u * 7.3 + 2.2) * 0.4) * ih * 0.03;
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

        function flakeColor(fl, px, py, thrVal) {
            var f = fadeAt(px, py);
            if (fl.color !== null) return f > thrVal ? pageColor : fl.color;
            var tone = 1 - f;
            return tone <= 0 ? 0 : shade(PAL, tone, thrVal);
        }

        /* The field holds the light along the top of the ridge and falls
         * away below; the sun or moon only nudges the brightness either
         * side of that, so the whole sheet reads as one piece right across
         * the frame. One value per column, shared by the mountain and the
         * field, is also what keeps the join between the two from showing as
         * a line. */
        if (!litCol || litCol.length !== iw) litCol = new Float32Array(iw);
        for (var lx = 0; lx < iw; lx++) {
            litCol[lx] = theme.light.base +
                theme.light.gain * falloff(lx - mx, 1 / (iw * theme.light.width));
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
                var fieldLine = fieldLineAt(u);
                var onField = y > fieldLine;
                var depth = onField ? (y - fieldLine) / Math.max(1, ih - fieldLine) : 0;
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
                    L = litCol[x] * theme.field.lit * (1 - theme.field.depth * depth) +
                        theme.field.lift * clamp01((y - fieldLine) / (ih * 0.16)) +
                        /* Drifting across the slope, not ruling it: the waves
                         * carry a term in v as well as u. */
                        0.05 * sn(u * 2.6 + v * 1.1 + t * 0.004) +
                        0.035 * sn(u * 5.3 - v * 1.7 + 1.3) +
                        grain + halo * theme.field.halo;
                    /* Fallen leaves: only an occasional single pixel lifts
                     * towards russet and gold, scattered at full resolution
                     * rather than in patches. The chance thins toward the
                     * sun, where sunlit ground makes the same speckle read
                     * far heavier. The lift varies with the hash, so the
                     * same speckle lands on ochre, russet or peach depending
                     * on the draw. Winter keeps this at zero to stay a clean
                     * snow sheet. */
                    if (theme.field.litter) {
                        var leaf = hash(x, y);
                        var density = theme.field.litter *
                            (1 - 0.7 * falloff(dr, invHalo));
                        var cut = 1 - density;
                        if (leaf > cut) {
                            L += 0.1 + ((leaf - cut) / density) * 0.1;
                        }
                    }
                    useDeep = L < 0.5;
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
                    useDeep = L < 0.5;
                }

                /* The foot of the picture dissolves into the page. Doing it
                 * here, through the same ordered dither as everything else,
                 * is what keeps it from reading as a stack of ruled bands
                 * laid over the landscape. */
                var f = fadeAt(x, y);
                L = dissolve(L, f);
                /* Once the dissolve takes over, the picture is heading for
                 * the page colour, which lives at one end of the main ramp;
                 * the shadow ramp would stop short of it. */
                if (f > 0.02) useDeep = false;

                data[row] = useDeep
                    ? shade(theme.shadow, L, thr[(x & 7) | dithRow])
                    : shade(PAL, L, thr[(x & 7) | dithRow]);
            }
        }

        /* Trees, painted over the slope. */
        for (var k = 0; k < trees.length; k++) {
            var tr = trees[k];
            var buf = tr.buf;
            var bodyTone = tr.toneBase + tr.dim * tr.toneDim;
            var capTone = tr.capBase - tr.dim * tr.capDim;
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
                        /* Lit foliage still catches the sky. */
                        var cap = capTone;
                        if (tr.capFloor && cap < tr.capFloor) cap = tr.capFloor;
                        data[idx] = tFade > tThr
                            ? pageColor
                            : shade(PAL, cap, tThr);
                    } else if (s === 3) {
                        /* Bark stays dark brown regardless of the crown's
                         * colour or how strongly the foliage is hazed. */
                        data[idx] = tFade > tThr
                            ? pageColor
                            : shade(tr.bark, 0.36 + tr.dim * 0.25, tThr);
                    } else {
                        var ci = (bodyTone * tr.ramp.length + tThr) | 0;
                        if (ci > tr.ramp.length - 1) ci = tr.ramp.length - 1;
                        data[idx] = tFade > tThr ? pageColor : tr.ramp[ci];
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

            var main = flakeColor(fl, fx, fy, thr[(fx & 7) | fyDith]);
            if (!main) continue;

            /* A flake falls into the dissolve along with everything else,
             * rather than staying a bright speck on top of it. */
            var toneHere = 1 - fadeAt(fx, fy);
            if (fl.color === null && toneHere <= 0) continue;

            if (fl.near > 0.84) {
                if (fx + 1 < iw) {
                    data[fy * iw + fx + 1] =
                        flakeColor(fl, fx + 1, fy, thr[((fx + 1) & 7) | fyDith]);
                }
                if (fy + 1 < ih) {
                    data[(fy + 1) * iw + fx] =
                        flakeColor(fl, fx, fy + 1, thr[(fx & 7) | (((fy + 1) & 7) << 3)]);
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

/* Moonlit ridge.
 *
 * A blue-hour view over the Green Mountains, drawn the way Return of the
 * Obra Dinn draws one: a low-resolution buffer, a tone value per pixel, and
 * an ordered Bayer threshold deciding which of a handful of cold blues and
 * snow-whites that tone lands on. Gradients break into stipple, the skyline
 * breaks into pixels, and the whole thing moves.
 */
(function () {
    var canvas = document.getElementById("scene");
    var host = document.getElementById("hero");
    if (!canvas || !host || !canvas.getContext) return;

    var ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------------------------------------------------------------- *
     * Palette: eight steps from a near-black navy to snow white, spaced
     * roughly evenly in luminance so the dither has even work to do.
     * ---------------------------------------------------------------- */

    var RGB = [
        [7, 11, 22],
        [15, 25, 48],
        [27, 43, 77],
        [44, 70, 112],
        [71, 106, 155],
        [114, 151, 194],
        [168, 194, 222],
        [238, 244, 251]
    ];
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

    var PAL = new Uint32Array(RGB.length);
    for (var p = 0; p < RGB.length; p++) PAL[p] = pack(RGB[p][0], RGB[p][1], RGB[p][2]);
    var LAST = PAL.length - 1;
    var N = PAL.length;

    /* The dark end of the picture is not blue but pine: this ramp takes
     * over from the main one below half tone, and its top step is the same
     * colour the main ramp reaches there, so the handover is invisible. */
    var SHADE_RGB = [
        /* The bottom step is the page colour, so the dissolve at the foot of
         * the picture bottoms out on it exactly and leaves no seam. */
        RGB[0],
        [15, 28, 24],
        [24, 44, 36],
        [38, 64, 54],
        RGB[4]
    ];
    var SHADE = new Uint32Array(SHADE_RGB.length);
    for (var s2 = 0; s2 < SHADE_RGB.length; s2++) {
        SHADE[s2] = pack(SHADE_RGB[s2][0], SHADE_RGB[s2][1], SHADE_RGB[s2][2]);
    }
    var SHADE_LAST = SHADE.length - 1;

    /* Spruce timber, the one place the picture is properly green. */
    var TIMBER_RGB = [
        [11, 24, 17],
        [18, 39, 27],
        [27, 57, 39],
        [40, 80, 55]
    ];

    /* Tone plus threshold, clamped into the palette. */
    function shade(tone, thr) {
        var i = (tone * N + thr) | 0;
        return PAL[i > LAST ? LAST : i < 0 ? 0 : i];
    }

    function shadeDeep(tone, thr) {
        var i = (tone * N + thr) | 0;
        return SHADE[i > SHADE_LAST ? SHADE_LAST : i < 0 ? 0 : i];
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
     * Spruces. Three variants at each of the sizes the depth bands use,
     * drawn once into tiny buffers so each one keeps hard pixel edges:
     * 0 = sky, 1 = timber, 2 = snow.
     *
     * The shape is laid out in fractions of the buffer rather than in
     * pixels of one fixed size, and every size gets its own rasterisation.
     * Shrinking a finished tree by sampling every other pixel does not
     * work: the boughs are mostly thin, so a sampled-down spruce loses
     * everything but the trunk and comes out as a bare post.
     * ---------------------------------------------------------------- */

    var SW = 26;
    var SH = 36;
    var SPRUCES = {};

    function spruce(div, variant) {
        var key = div + ":" + variant;
        if (SPRUCES[key]) return SPRUCES[key];

        var w = Math.max(5, Math.round(SW / div));
        var h = Math.max(8, Math.round(SH / div));
        var r = rng(variant * 7919 + Math.round(div * 1000) + 13);
        var cx = w / 2;

        /* Timber and snow are collected as separate lists of polygons and
         * filled one material at a time, because a single pass cannot tell
         * them apart where they meet: every pixel on that seam is a blend of
         * the two, and a tree is mostly seam at the smaller sizes. Filling
         * them separately gives each its own coverage to be tested against,
         * so the join costs a hard edge instead of a row of holes. */
        var timber = [];
        var snow = [];

        /* The trunk only runs up to where the boughs are already wider than
         * it is. Any higher and it stands out above the foliage as a bare
         * post, which is exactly what a spruce does not look like. */
        var trunkW = Math.max(1, Math.round(w * 0.07));
        var trunkX = Math.round(cx - trunkW / 2);
        /* The trunk starts level with the leader, not above it: any higher
         * and it stands out above the foliage as a bare post. */
        var trunkY = Math.round(h * 0.05);
        timber.push([trunkX, trunkY, trunkX, h, trunkX + trunkW, h, trunkX + trunkW, trunkY, 1]);

        /* Tiers, widest at the bottom, each with snow lying along it. A bough
         * every three rows or so: any fewer and the ones that are left sit
         * too far apart to read as tiers rather than as blobs on a stick. */
        var tiers = Math.max(4, Math.round(h / 3));
        var top0 = h * 0.94;
        var top1 = h * 0.05;
        var halfMax = w / 2 - 0.6;
        /* Only just deep enough to reach the tier below. A deeper bough
         * spreads the same width over too many rows and the tree goes back
         * to being a spike with a spike on it. */
        var drop = (top0 - top1) / tiers * 1.1;
        /* The sliver of snow along a bough has to be a whole pixel at the
         * smaller sizes or it rounds away to nothing. */
        var band = Math.max(0.7, h * 0.024);

        for (var i = 0; i < tiers; i++) {
            var t = i / (tiers - 1);
            var top = top0 - t * (top0 - top1);
            /* Linear, but never down to nothing: the leader is a bough like
             * any other, a pixel or two across, not a needle. */
            var half = halfMax * (0.16 + 0.84 * (1 - t)) * (0.82 + r() * 0.36);
            var d = drop + t * h * 0.03;

            timber.push([cx, top, cx - half, top + d, cx + half, top + d, cx, top, 0]);

            /* Snow lies along the top of each bough, so the white runs back
             * from the tip towards the trunk and leaves the timber showing
             * underneath. */
            var a = top + band * 0.8;
            var b = top + band * 1.1;
            var e = top + d - band * 1.4;
            snow.push([cx, a, cx - half * 0.9, top + d, cx - half * 0.45, e, cx, b, 0]);
            snow.push([cx, a, cx + half * 0.9, top + d, cx + half * 0.45, e, cx, b, 0]);
        }

        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        var g = c.getContext("2d");
        var buf = new Uint8Array(w * h);

        for (var pass = 0; pass < 2; pass++) {
            var list = pass ? snow : timber;
            g.clearRect(0, 0, w, h);
            g.fillStyle = "#000";
            for (var p = 0; p < list.length; p++) {
                var q = list[p];
                if (q[8]) {
                    g.fillRect(q[0], q[1], q[2] - q[0], q[5] - q[1]);
                    continue;
                }
                g.beginPath();
                g.moveTo(q[0], q[1]);
                g.lineTo(q[2], q[3]);
                g.lineTo(q[4], q[5]);
                g.lineTo(q[6], q[7]);
                g.closePath();
                g.fill();
            }
            /* Untouched pixels are transparent, so alpha decides what is sky
             * and what is tree. Snow goes down last and wins the overlap. */
            var d2 = g.getImageData(0, 0, w, h).data;
            for (var k = 0; k < buf.length; k++) {
                if (d2[k * 4 + 3] < 128) continue;
                buf[k] = pass ? 2 : 1;
            }
        }

        var spr = { buf: buf, w: w, h: h };
        SPRUCES[key] = spr;
        return spr;
    }

    /* ---------------------------------------------------------------- *
     * Buffer and layout
     * ---------------------------------------------------------------- */

    var img = null;
    var px32 = null;
    var iw = 0;
    var ih = 0;
    var scale = 3;

    var mx = 0;      /* moon centre                          */
    var my = 0;
    var mr = 0;      /* moon radius                          */
    var ridge = [];  /* the skyline, one entry per column    */
    var fadeRow = 0; /* first row of the dissolve            */
    var trees = [];
    var flakes = [];

    /* Where the snow field is cut off by the slope in front of it. It
     * drifts, rather than ruling a dead straight line across the picture.
     * Both the field itself and the treeline are read off this, so the two
     * cannot disagree about where the ground is. */
    function snowLineAt(u) {
        return ih * 0.72 +
            (sn(u * 2.7 + 0.2) * 0.6 + sn(u * 6.1 + 1.1) * 0.4) * ih * 0.05;
    }

    /* The ground the spruces stand on: the same contour, a little way down
     * its face, with a slower swell and some finer wobble on top so no two
     * neighbouring trunks end up at quite the same height. */
    function treeGroundAt(u) {
        return snowLineAt(u) + ih * 0.03 +
            ih * 0.015 * sn(u * 1.9 + 0.5) + ih * 0.008 * sn(u * 8.7 + 2.1);
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

        /* Moon, up in the top right where the sky is darkest. */
        mr = Math.max(5, ih * 0.085);
        mx = Math.round(iw * 0.84);
        my = Math.round(ih * 0.2);

        /* The skyline: a broad dome just right of centre, a lower shoulder
         * on the left where the valley runs out, and enough fine noise to
         * stop the edge reading as a dune. */
        ridge = new Float32Array(iw);
        for (var x = 0; x < iw; x++) {
            var u = x / iw;
            var dome = Math.exp(-Math.pow((u - 0.63) / 0.34, 2));
            var shoulder = Math.exp(-Math.pow((u - 0.04) / 0.3, 2));
            ridge[x] = ih * 0.63 - ih * 0.2 * dome - ih * 0.075 * shoulder +
                ih * 0.012 * sn(u * 7.3) + ih * 0.008 * sn(u * 19.1 + 0.3);
        }

        /* Spruces in three depth bands, every one of them standing on that
         * ground: the treeline runs along the top of the field and then
         * steps down the slope towards the viewer, and each band sits on the
         * same contour as the one behind it rather than on a flat row of its
         * own. All of it stays above the dissolve, so the darkening at the
         * foot of the picture has nothing to cut through. Small and hazy at
         * the back, dark and full size in front. */
        var r = rng(20240211);
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
                var spr = spruce(band.div, (r() * 3) | 0);
                /* Jitter first, so the ground is read at the trunk's own
                 * column and the scatter follows the contour with it. */
                var tu = r();
                var foot = treeGroundAt(tu) + ih * band.drop + (r() - 0.5) * ih * 0.022;


                /* Bleed off either edge, but never so far that the tree is a
                 * single column of pixels against the margin. */
                var tx = Math.round(r() * (iw + spr.w - 3) - (spr.w - 3) * 0.5);
                /* Each tree carries its own four-step green, washed towards
                 * the haze by however far back it stands. */
                var wash = Math.min(0.55, band.dim * 1.6);
                var ramp = new Uint32Array(TIMBER_RGB.length);
                for (var k = 0; k < TIMBER_RGB.length; k++) {
                    var c3 = TIMBER_RGB[k];
                    ramp[k] = pack(
                        c3[0] + (66 - c3[0]) * wash,
                        c3[1] + (98 - c3[1]) * wash,
                        c3[2] + (136 - c3[2]) * wash);
                }
                trees.push({
                    buf: spr.buf,
                    w: spr.w,
                    h: spr.h,
                    x: tx,
                    y: Math.round(foot - spr.h),
                    foot: foot,
                    dim: band.dim,
                    ramp: ramp
                });
            }
        }
        /* Back to front, so the near trunks overlap the far ones. */
        trees.sort(function (a, b) { return a.foot - b.foot; });

        /* Where the picture falls away into the page, kept below every trunk
         * so the darkening never has a tree to cut through. */
        fadeRow = Math.round(ih * 0.875);
        for (var ti = 0; ti < trees.length; ti++) {
            var low = Math.round(trees[ti].foot) + 2;
            if (low > fadeRow) fadeRow = low;
        }
        if (fadeRow > ih - 6) fadeRow = ih - 6;

        /* Snow, falling through the band. Sparse on purpose: a dense sheet
         * stops reading as weather and starts reading as noise over the
         * stars, and the ridge is the subject, not the fall. */
        flakes = [];
        var n = Math.round(iw * ih / 460);
        for (var f = 0; f < n; f++) {
            flakes.push({
                x: r() * iw,
                y: r() * ih,
                /* Slow. A flake should take its time getting down, so the
                 * fall reads as drifting rather than as scrolling. */
                v: 7 + r() * 15,
                d: 0.4 + r() * 1.5,
                /* A steady wind off the ridge, so the snow runs the width
                 * of the picture and wraps at whichever edge it reaches
                 * instead of dropping straight down in place. */
                w: 3 + r() * 9,
                near: r()
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

    function render(t, dt) {
        var data = px32;
        var thr = THRESH;
        var row = 0;
        var invHalo = 1 / (mr * 2.8);

        /* Snow holds the light along the top of the ridge and falls away
         * below; the moon only nudges the brightness either side of that, so
         * the whole sheet reads as one piece of snow right across the frame.
         * One value per column, shared by the mountain and the field, is
         * also what keeps the join between the two from showing as a line. */
        if (!litCol || litCol.length !== iw) litCol = new Float32Array(iw);
        for (var lx = 0; lx < iw; lx++) {
            litCol[lx] = 0.7 + 0.14 * falloff(lx - mx, 1 / (iw * 0.55));
        }

        for (var y = 0; y < ih; y++) {
            var v = y / ih;
            var dithRow = (y & 7) << 3;

            for (var x = 0; x < iw; x++, row++) {
                var u = x / iw;
                var dx = x - mx;
                var dy = y - my;
                var dr = Math.sqrt(dx * dx + dy * dy);
                var halo = 0.3 * falloff(dr, invHalo);
                /* The top of the snow field drifts, rather than ruling a
                 * dead straight line across the picture. */
                var snowLine = snowLineAt(u);
                var onSlope = y > snowLine;
                var depth = onSlope ? (y - snowLine) / Math.max(1, ih - snowLine) : 0;
                var L;
                /* The lower slopes fall into pine shadow; above half tone
                 * the picture is snow and sky again. */
                var useDeep = false;
                /* A little noise under the threshold. Any smooth ramp long
                 * enough to cross a palette step does it along contours, and
                 * those contours come out as ruled lines once the dither has
                 * only two colours to work with; the noise breaks them into
                 * the same stipple as everything else. */
                var grain = (hash(x, y) - 0.5) * 0.05;

                if (onSlope) {
                    /* --- the snow field in front ------------------------ */
                    /* The same sheet the mountain is made of, carried on
                     * downhill: it takes the lit column where the ridge left
                     * it, so the two meet without a seam, and gives up more
                     * light with every row towards the viewer. That falloff
                     * is what puts the treeline against something brighter
                     * than itself, and it carries the front of the field far
                     * enough down the pine ramp to pick up the shadow the
                     * wood casts across it. */
                    L = litCol[x] * (1 - 0.34 * depth) +
                        0.03 * clamp01((y - snowLine) / (ih * 0.16)) +
                        /* Drifting across the slope, not ruling it: the waves
                         * carry a term in v as well as u. */
                        0.05 * sn(u * 2.6 + v * 1.1 + t * 0.004) +
                        0.035 * sn(u * 5.3 - v * 1.7 + 1.3) +
                        grain + halo * 0.3;
                    useDeep = L < 0.5;
                } else if (y < ridge[x]) {
                    /* --- sky ------------------------------------------- */
                    /* Deep overhead, opening out towards the ridge. */
                    L = 0.05 + 0.48 * Math.pow(v, 1.5) + halo * 0.7;

                    /* A thin scatter of stars, only up where it is darkest. */
                    if (L < 0.16 && hash(x, y) > 0.9986) {
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
                    if (dr < mr) L = dr > mr * 0.9 ? 0.7 : 1;
                } else {
                    /* --- the mountain ---------------------------------- */
                    var below = (y - ridge[x]) / Math.max(1, ih - ridge[x]);
                    L = litCol[x] * (1 - 0.42 * below) + halo * 0.4;
                    L += 0.045 * sn(u * 13 + v * 8 + t * 0.01) * (1 - below);
                    /* Cloud shadow crawling across the slope. */
                    L -= 0.08 * falloff(below, 3) * (0.5 + 0.5 * sn(u * 2.2 + t * 0.008));
                    L += grain;
                    useDeep = L < 0.5;
                }

                /* The foot of the picture dissolves into the page. Doing it
                 * here, through the same ordered dither as everything else,
                 * is what keeps it from reading as a stack of ruled bands
                 * laid over the snow. */
                L *= 1 - fadeAt(x, y);

                data[row] = useDeep ? shadeDeep(L, thr[(x & 7) | dithRow])
                    : shade(L, thr[(x & 7) | dithRow]);
            }
        }

        /* Trees, painted over the slope. */
        for (var k = 0; k < trees.length; k++) {
            var tr = trees[k];
            var buf = tr.buf;
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
                    /* Should a trunk reach the dissolve — the drifting edge
                     * can climb a little past the lowest foot — its base goes
                     * into the page with the snow. */
                    var tFade = fadeAt(px, py);
                    if (s === 2) {
                        /* Snow on the boughs still reflects the sky. */
                        var snowTone = (0.94 - tr.dim * 0.7) * (1 - tFade);
                        if (snowTone < 0.4 && tFade < 0.55) snowTone = 0.4;
                        data[py * iw + px] = shade(snowTone, thr[(px & 7) | dithY]);
                    } else {
                        var tone = (0.34 + tr.dim * 0.5) * (1 - tFade);
                        var ti = (tone * tr.ramp.length + thr[(px & 7) | dithY]) | 0;
                        if (ti > tr.ramp.length - 1) ti = tr.ramp.length - 1;
                        data[py * iw + px] = tr.ramp[ti];
                    }
                }
            }
        }

        /* Snowfall. */
        for (var n = 0; n < flakes.length; n++) {
            var fl = flakes[n];
            fl.y += fl.v * dt;
            fl.x += (fl.w + Math.sin(t * 0.8 + fl.d * 9) * fl.d * 5) * dt;
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
            /* A flake falls into the dissolve along with everything else,
             * rather than staying a bright speck on top of it. */
            var fTone = 1 - fadeAt(fx, fy);
            if (fTone <= 0) continue;
            var fyDith = (fy & 7) << 3;
            if (fl.near > 0.84) {
                if (fx + 1 < iw) {
                    data[fy * iw + fx + 1] = shade(fTone, thr[((fx + 1) & 7) | fyDith]);
                }
                if (fy + 1 < ih) {
                    data[(fy + 1) * iw + fx] =
                        shade(1 - fadeAt(fx, fy + 1), thr[(fx & 7) | (((fy + 1) & 7) << 3)]);
                }
            }
            data[fy * iw + fx] = shade(fTone, thr[(fx & 7) | fyDith]);
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

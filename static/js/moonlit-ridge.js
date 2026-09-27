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
        [8, 16, 15],
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
     * Spruces. Three variants, drawn once into tiny buffers so each one
     * keeps hard pixel edges: 0 = sky, 1 = timber, 2 = snow.
     * ---------------------------------------------------------------- */

    var SW = 26;
    var SH = 36;
    var SPRUCE = [];

    function drawSpruce(variant) {
        var c = document.createElement("canvas");
        c.width = SW;
        c.height = SH;
        var g = c.getContext("2d");
        var r = rng(variant * 7919 + 13);
        var cx = (SW / 2) | 0;

        g.fillStyle = "#000";
        g.beginPath();
        g.moveTo(cx - 1, SH);
        g.lineTo(cx - 1, 5);
        g.lineTo(cx + 1, 5);
        g.lineTo(cx + 1, SH);
        g.closePath();
        g.fill();

        /* Tiers, widest at the bottom, each with snow lying along it. */
        var tiers = 7;
        for (var i = 0; i < tiers; i++) {
            var t = i / (tiers - 1);
            var top = SH - 5 - t * (SH - 11);
            var half = (SW / 2 - 1.5) * (1 - t * 0.84) * (0.92 + r() * 0.16);
            var drop = 6.5 + t * 1.5;

            g.fillStyle = "#000";
            g.beginPath();
            g.moveTo(cx, top);
            g.lineTo(cx - half, top + drop);
            g.lineTo(cx + half, top + drop);
            g.closePath();
            g.fill();

            /* Snow lies along the top of each bough, so the white runs back
             * from the tip towards the trunk and leaves the timber showing
             * underneath. */
            g.fillStyle = "#fff";
            g.beginPath();
            g.moveTo(cx, top + 0.5);
            g.lineTo(cx - half * 0.98, top + drop);
            g.lineTo(cx - half * 0.55, top + drop - 0.5);
            g.lineTo(cx, top + 1.6);
            g.closePath();
            g.fill();
            g.beginPath();
            g.moveTo(cx, top + 0.5);
            g.lineTo(cx + half * 0.98, top + drop);
            g.lineTo(cx + half * 0.55, top + drop - 0.5);
            g.lineTo(cx, top + 1.6);
            g.closePath();
            g.fill();
        }

        var d = g.getImageData(0, 0, SW, SH).data;
        var buf = new Uint8Array(SW * SH);
        for (var k = 0; k < buf.length; k++) {
            /* Untouched pixels are transparent black, so alpha decides
             * what is sky and what is tree. */
            if (d[k * 4 + 3] < 128) continue;
            var l = d[k * 4];
            if (l < 96) buf[k] = 1;
            else if (l > 160) buf[k] = 2;
        }
        return buf;
    }

    for (var v = 0; v < 3; v++) SPRUCE.push(drawSpruce(v));

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
    var trees = [];
    var flakes = [];

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

        /* Spruces in three depth bands: small and hazy at the back of the
         * slope, dark and full size in front. */
        var r = rng(20240211);
        trees = [];
        var bands = [
            { y: 0.8, step: 3, n: 44, dim: 0.24 },
            { y: 0.9, step: 2, n: 26, dim: 0.13 },
            { y: 1.04, step: 1, n: 16, dim: 0 }
        ];
        for (var bi = 0; bi < bands.length; bi++) {
            var band = bands[bi];
            for (var i = 0; i < band.n; i++) {
                var foot = Math.min(ih - 1, ih * band.y + (r() - 0.5) * ih * 0.04);
                var tx = Math.round(r() * (iw + 24) - 12 - (SW / band.step) * 0.5);
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
                    buf: SPRUCE[(r() * 3) | 0],
                    step: band.step,
                    x: tx,
                    y: Math.round(foot - SH / band.step),
                    foot: foot,
                    dim: band.dim,
                    ramp: ramp
                });
            }
        }
        /* Back to front, so the near trunks overlap the far ones. */
        trees.sort(function (a, b) { return a.foot - b.foot; });

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

    function render(t, dt) {
        var data = px32;
        var thr = THRESH;
        var row = 0;
        var invHalo = 1 / (mr * 2.8);
        var slopeTop = Math.round(ih * 0.75);

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
                var snowLine = slopeTop +
                    (sn(u * 2.7 + 0.2) * 0.6 + sn(u * 6.1 + 1.1) * 0.4) * ih * 0.055;
                var onSlope = y > snowLine;
                var depth = onSlope ? (y - snowLine) / Math.max(1, ih - snowLine) : 0;
                var L;
                /* The lower slopes fall into pine shadow; above half tone
                 * the picture is snow and sky again. */
                var useDeep = false;

                if (onSlope) {
                    /* --- the snow field in front ------------------------ */
                    /* Picks up out of the shadow the ridge leaves behind
                     * instead of starting at full brightness. */
                    var open = 0.66 + 0.24 * clamp01((y - snowLine) / (ih * 0.11));
                    L = open - 0.06 * depth +
                        0.05 * sn(u * 3.1 + t * 0.004) +
                        0.035 * sn(u * 9.4 + 1.3) + halo * 0.3;
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
                    /* Snow holds the light along the top and falls away
                     * below. The moon only nudges the brightness either
                     * side of that, so the field still reads as one sheet
                     * of snow right across the frame. */
                    var lit = 0.7 + 0.14 * falloff(x - mx, 1 / (iw * 0.55));
                    L = lit * (1 - 0.42 * below) + halo * 0.4;
                    L += 0.045 * sn(u * 22 + t * 0.01) * (1 - below);
                    /* Cloud shadow crawling across the slope. */
                    L -= 0.08 * falloff(below, 3) * (0.5 + 0.5 * sn(u * 2.2 + t * 0.008));
                    useDeep = L < 0.5;
                }

                data[row] = useDeep ? shadeDeep(L, thr[(x & 7) | dithRow])
                    : shade(L, thr[(x & 7) | dithRow]);
            }
        }

        /* Trees, painted over the slope. */
        for (var k = 0; k < trees.length; k++) {
            var tr = trees[k];
            var buf = tr.buf;
            var step = tr.step;
            var th = (SH / step) | 0;
            var tw = (SW / step) | 0;
            for (var ty = 0; ty < th; ty++) {
                var py = tr.y + ty;
                if (py < 0 || py >= ih) continue;
                var src = (ty * step) * SW;
                var dithY = (py & 7) << 3;
                for (var tx = 0; tx < tw; tx++) {
                    var px = tr.x + tx;
                    if (px < 0 || px >= iw) continue;
                    var s = buf[src + tx * step];
                    if (!s) continue;
                    if (s === 2) {
                        /* Snow on the boughs still reflects the sky. */
                        var snowTone = 0.94 - tr.dim * 0.7;
                        if (snowTone < 0.4) snowTone = 0.4;
                        data[py * iw + px] = shade(snowTone, thr[(px & 7) | dithY]);
                    } else {
                        var tone = 0.34 + tr.dim * 0.5;
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
            if (fl.near > 0.84) {
                if (fx + 1 < iw) data[fy * iw + fx + 1] = PAL[LAST];
                if (fy + 1 < ih) data[(fy + 1) * iw + fx] = PAL[LAST];
            }
            data[fy * iw + fx] = PAL[LAST];
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

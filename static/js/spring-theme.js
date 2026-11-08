/* Spring dawn theme for the shared ridge renderer.
 *
 * Keep the seasonal data here, separate from the scene engine. Colours are
 * ordinary RGB triples; ridge.js packs the ramps when it registers
 * this theme. Load this file before the renderer.
 */
(function (root) {
    var SPRING_RGB = [
        [22, 30, 44],
        [40, 56, 82],
        [66, 88, 120],
        [104, 124, 150],
        [150, 158, 152],
        [192, 182, 160],
        [226, 206, 180],
        [233, 240, 222]
    ];

    /* Spruce in leaf: blue-green timber keeps the pale dawn grounded. */
    var SPRING_TIMBER = [
        [18, 28, 26],
        [28, 44, 40],
        [40, 62, 52],
        [56, 82, 66]
    ];

    /* New hardwood leaf, in several restrained bud/leaf shades. */
    var SPRING_FOLIAGE = [
        [[50, 62, 36], [88, 108, 54], [128, 150, 80], [170, 188, 116]],
        [[34, 54, 48], [62, 96, 78], [98, 136, 108], [146, 178, 146]],
        [[46, 56, 44], [86, 98, 70], [128, 138, 102], [172, 180, 146]]
    ];

    var SPRING_BARK = [
        [20, 20, 22],
        [38, 36, 34],
        [66, 58, 48],
        [98, 86, 68]
    ];

    var SPRING_SHADOW = [
        SPRING_RGB[0],
        [36, 52, 46],
        [58, 82, 64],
        [92, 112, 78],
        SPRING_RGB[4]
    ];

    root.SeasonalRidgeThemes = root.SeasonalRidgeThemes || {};
    root.SeasonalRidgeThemes.spring = {
        palette: SPRING_RGB,
        shadow: SPRING_SHADOW,
        seed: 20260320,
        fadeTo: 1,
        /* The ground ramp carries the dissolve into the page as valley fog. */
        fade: SPRING_SHADOW.slice(0, 4).concat([
            [126, 142, 118],
            [170, 184, 160],
            [206, 220, 196],
            SPRING_RGB[7]
        ]),
        /* Let the veil climb into the treeline and soften trunk bases. */
        fog: 0.82,
        light: { base: 0.6, gain: 0.22, width: 0.55 },
        /* A small sun rising behind the right-hand dome. */
        disc: { x: 0.68, y: 0.442, r: 0.065, halo: 0.35, spread: 5, rim: 0.9 },
        sky: { base: 0.13, range: 0.98, power: 1.6, halo: 0.8, stars: true, bridge: 0 },
        mountain: { lit: 0.44, depth: 0.46, halo: 0.1, wave: 1, deep: true },
        field: { lit: 0.55, depth: 0.5, lift: 0.02, halo: 0.06, deep: true },
        trees: {
            kinds: ["spruce", "broadleaf"],
            ramps: { spruce: [SPRING_TIMBER], broadleaf: SPRING_FOLIAGE },
            tone: { spruce: [0.34, 0.5], broadleaf: [0.46, 0.72] },
            /* No pale lit cap on the spruce: these are backlit silhouettes. */
            haze: [196, 206, 204],
            hazeWash: [0.3, 0.85],
            bark: SPRING_BARK
        },
        particles: {
            density: 2200,
            vMin: 2.5, vMax: 7,
            windMin: 2, windMax: 6,
            sway: 4, rate: 0.45,
            /* Blush petals stay distinct from both the pale sky and foliage. */
            tint: [
                [120, 74, 80],
                [164, 108, 110],
                [202, 150, 146],
                [230, 192, 184]
            ]
        }
    };
})(window);

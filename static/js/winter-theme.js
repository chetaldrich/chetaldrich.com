/* Winter night theme for the shared ridge renderer.
 *
 * Keep the seasonal data here, separate from the scene engine. Colours are
 * ordinary RGB triples; ridge.js packs the ramps when it registers this
 * theme. Load this file before the renderer.
 */
(function (root) {
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

    /* Spruce timber, the one place the winter picture is properly green. */
    var WINTER_TIMBER = [
        [11, 24, 17],
        [18, 39, 27],
        [27, 57, 39],
        [40, 80, 55]
    ];

    root.SeasonalRidgeThemes = root.SeasonalRidgeThemes || {};
    root.SeasonalRidgeThemes.winter = {
        palette: WINTER_RGB,
        shadow: [
            [7, 11, 22],
            [15, 28, 24],
            [24, 44, 36],
            [38, 64, 54],
            [71, 106, 155]
        ],
        seed: 20240211,
        /* The foot of the picture goes dark, into the dark page. */
        fadeTo: 0,
        light: { base: 0.7, gain: 0.14, width: 0.55 },
        disc: { x: 0.84, y: 0.2, r: 0.085, halo: 0.3, spread: 2.8, rim: 0.7 },
        sky: { base: 0.05, range: 0.48, power: 1.5, halo: 0.7, stars: true, bridge: 0 },
        mountain: { lit: 1, depth: 0.42, halo: 0.4, wave: 1 },
        field: { lit: 1, depth: 0.34, lift: 0.03, halo: 0.3 },
        trees: {
            kinds: ["spruce"],
            ramps: { spruce: [WINTER_TIMBER] },
            tone: { spruce: [0.34, 0.5] },
            cap: { spruce: [0.94, 0.7] },
            capFloor: { spruce: 0.4 },
            haze: [66, 98, 136],
            hazeWash: [0.55, 1.6]
        },
        particles: {
            density: 460,
            vMin: 7, vMax: 22,
            windMin: 3, windMax: 12,
            sway: 5, rate: 0.8,
            near: 0.84
        }
    };
})(window);

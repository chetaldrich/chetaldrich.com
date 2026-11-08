/* Summer noon theme for the shared ridge renderer.
 *
 * Keep the seasonal data here, separate from the scene engine. Colours are
 * ordinary RGB triples; ridge.js packs the ramps when it registers
 * this theme. Load this file before the renderer.
 */
(function (root) {
    /* High noon. Bright blue overhead, pale horizon haze, and a sunlit
     * meadow at the foot that is also the page colour. The sky stays blue
     * all the way up: this is the only season with no dark overhead and no
     * stars, which is what makes noon read as noon. Warmth lives at the
     * bright end of the ramp with the sunlight, not in the sky itself. */
    var SUMMER_RGB = [
        [20, 58, 105],
        [40, 90, 140],
        [75, 130, 170],
        [120, 165, 180],
        [140, 185, 150],
        [185, 210, 170],
        [220, 235, 200],
        [243, 247, 230]
    ];

    /* Full-leaf spruce: deep green, darker than spring so the evergreens
     * anchor a much brighter picture. */
    var SUMMER_TIMBER = [
        [12, 35, 25],
        [22, 60, 40],
        [35, 90, 55],
        [55, 120, 75]
    ];

    /* High-summer leaf, one ramp per tree. Saturated on purpose: spring
     * already owns the pale bud greens, so summer takes the deep
     * chlorophyll. */
    var SUMMER_FOLIAGE = [
        [[35, 75, 35], [70, 125, 55], [110, 165, 80], [160, 205, 120]],
        [[28, 70, 45], [60, 120, 70], [100, 160, 95], [150, 200, 140]],
        [[45, 80, 30], [85, 130, 50], [130, 170, 75], [175, 210, 125]]
    ];

    /* Sun-baked bark: warmer and lighter than the spring wood. */
    var SUMMER_BARK = [
        [25, 20, 15],
        [50, 35, 22],
        [85, 60, 35],
        [120, 90, 55]
    ];

    /* The noon meadow: deep green through to the sunlit mid green the main
     * ramp shares at mid-tone. The fade ramp starts from the first four of
     * these, so the slope enters the dissolve without a seam. */
    var SUMMER_SHADOW = [
        [20, 58, 105],
        [25, 68, 50],
        [45, 105, 60],
        [80, 140, 80],
        [140, 185, 150]
    ];

    root.SeasonalRidgeThemes = root.SeasonalRidgeThemes || {};
    root.SeasonalRidgeThemes.summer = {
        palette: SUMMER_RGB,
        shadow: SUMMER_SHADOW,
        seed: 20260621,
        /* Daylight into the bright page. */
        fadeTo: 1,
        /* The dissolve stays in meadow tones: the ground's own greens climb
         * through sunlit sage into the page. */
        fade: SUMMER_SHADOW.slice(0, 4).concat([
            [150, 185, 140],
            [190, 215, 170],
            [220, 235, 200],
            SUMMER_RGB[7]
        ]),
        /* Even overhead light: bright everywhere, with barely any lean
         * toward the sun column. */
        light: { base: 0.8, gain: 0.1, width: 0.8 },
        /* The noon sun, high and near the middle of the frame. Large and
         * near-white, with a tight halo: at noon the light is hard. */
        disc: { x: 0.5, y: 0.14, r: 0.085, halo: 0.25, spread: 3.2, rim: 0.95 },
        /* Blue from zenith to ridge, darker up top so noon still has a sky
         * rather than a white sheet. No stars, no bridge. */
        sky: { base: 0.18, range: 0.75, power: 1.3, halo: 0.5, stars: false, bridge: 0 },
        /* Sunlit ridge in full green. Pinned to the shadow ramp so the
         * bright light reads as meadow, not as sky colour. */
        mountain: { lit: 0.55, depth: 0.45, halo: 0.2, wave: 0.9, deep: true },
        /* Bright field falling away toward the viewer, same sheet as the
         * mountain so the two meet without a seam. */
        field: { lit: 0.6, depth: 0.4, lift: 0.03, halo: 0.08, deep: true },
        trees: {
            /* Full summer wood: hardwoods in leaf with spruce among them. */
            kinds: ["spruce", "broadleaf"],
            ramps: { spruce: [SUMMER_TIMBER], broadleaf: SUMMER_FOLIAGE },
            tone: { spruce: [0.3, 0.5], broadleaf: [0.32, 0.6] },
            /* No lit cap: the cap material walks the main palette, which
             * at these tones is near-white sky. On a bright blue sky that
             * turns every sunlit bough into a sky-coloured bar. */
            /* Heat haze is pale blue-white, not amber or silver. */
            haze: [205, 228, 222],
            hazeWash: [0.3, 0.9],
            bark: SUMMER_BARK
        },
        /* Nothing falls from the summer sky: noon air is still. */
        particles: null
    };
})(window);

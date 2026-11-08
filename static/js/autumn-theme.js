/* Autumn dusk theme for the shared ridge renderer.
 *
 * Keep the seasonal data here, separate from the scene engine. Colours are
 * ordinary RGB triples; ridge.js packs the ramps when it registers this
 * theme. Load this file before the renderer.
 */
(function (root) {
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

    /* The autumn ground. The fade ramp starts from the first four of these,
     * so the dissolve enters the slope's own colours rather than jumping to
     * a separate palette at the boundary. */
    var AUTUMN_SHADOW = [
        [24, 25, 43],
        [30, 38, 30],
        [52, 52, 28],
        [84, 68, 30],
        [171, 98, 77]
    ];

    root.SeasonalRidgeThemes = root.SeasonalRidgeThemes || {};
    root.SeasonalRidgeThemes.autumn = {
        palette: AUTUMN_RGB,
        /* The dark half in autumn is ground, not pine: dark green
         * through olive and ochre to the russet the main ramp shares
         * at mid-tone. The field lives here. */
        shadow: AUTUMN_SHADOW,
        seed: 20260922,
        /* Daylight fades up into the paper-coloured page. The fade
         * walks a ground-only ramp, not the main palette: the main
         * ramp would pass through the sky's plums and sands and lay
         * a band of weather across the foot of the picture. Its first
         * steps are the shadow ramp's own, so the slope enters the
         * dissolve without a seam, and the extra steps climb through
         * sage and bone to the page. */
        fadeTo: 1,
        fade: [
            [24, 25, 43],
            [30, 38, 30],
            [52, 52, 28],
            [84, 68, 30],
            [118, 108, 70],
            [156, 144, 106],
            [200, 186, 152],
            [245, 237, 218]
        ],
        light: { base: 0.7, gain: 0.16, width: 0.5 },
        /* A low sun in the left shoulder, almost touching the ridge. */
        disc: { x: 0.2, y: 0.47, r: 0.07, halo: 0.55, spread: 4.2, rim: 0.88 },
        /* Twilight continuum: the ridge itself never leaves the shadow
         * ramp, so the sky right above it would stand bright and make
         * every gap between crowns a sky hole. The lower half of the
         * sky is pulled toward the shadow tone the ridge carries, and
         * only the upper sky keeps full palette brightness. */
        sky: { base: 0.1, range: 0.78, power: 1.35, halo: 0.7, stars: false, bridge: 0.42 },
        /* Backlit ridge: darker than the sky behind it. The sun column
         * would push it over half tone into sky colours if the light
         * and halo were left high, so both stay low: the ridge keeps
         * its olive and russet silhouette and the sun sits behind it.
         * `deep` pins the whole slope to the shadow ramp regardless of
         * the halo and the drifting waves, which otherwise crest half
         * tone under the disc and flash a patch of sky colour onto the
         * ground. */
        mountain: { lit: 0.46, depth: 0.5, halo: 0.18, wave: 1.1, deep: true },
        /* Plain green ground, not snow: dimmed so it lands in the
         * shadow ramp's greens and browns. The sun's share is kept
         * small so the lit field does not detach from the dark ridge
         * as a pale wedge; it should read as the same ground, shading
         * off down the slope before the dissolve takes it up to the
         * paper page. `deep` keeps that sheet on the shadow ramp the
         * same way the mountain does. */
        field: { lit: 0.5, depth: 0.45, lift: 0.02, halo: 0.12, deep: true },
        trees: {
            kinds: ["broadleaf"],
            ramps: {
                broadleaf: AUTUMN_FOLIAGE
            },
            tone: {
                broadleaf: [0.3, 0.6]
            },
            /* No lit material for the hardwood: at this size the glints
             * read as stray sky pixels in the crowns, so foliage and
             * bark are the whole tree. */
            /* Atmosphere is amber, not cream: deep enough that washed
             * distant crowns read as russet against the ridge instead
             * of matching the horizon sky. */
            haze: [196, 138, 78],
            hazeWash: [0.26, 0.9],
            bark: AUTUMN_BARK
        },
        /* Nothing falls from the autumn sky. */
        particles: null
    };
})(window);

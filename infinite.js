Mod.afterLoad(function () {
    console.log("[Infinite World] Loading...");

    if (window.__infiniteWorldInstalled) {
        console.log("[Infinite World] Already installed.");
        return;
    }

    window.__infiniteWorldInstalled = true;

    let initialized = false;

    window.camX = 0;
    window.camY = 0;
    window.camZoom = 1;

    /*
     * ============================================================
     * CONFIG
     * ============================================================
     */

    const MIN_ZOOM = 0.20;
    const MAX_ZOOM = 16;

    /*
     * How many extra chunks to render around the visible area.
     * This prevents tiny gaps when panning.
     */
    const CHUNK_PADDING = 2;

    /*
     * ============================================================
     * HELPERS
     * ============================================================
     */

    function getCanvasSize() {
        return {
            width:
                mapCanvas.clientWidth ||
                mapCanvas.width ||
                1,

            height:
                mapCanvas.clientHeight ||
                mapCanvas.height ||
                1
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /*
     * Correct floor division for negative coordinates.
     *
     * Example:
     *
     * -1 / 32 -> chunk -1
     * -32 / 32 -> chunk -1
     * -33 / 32 -> chunk -2
     */
    function worldToChunk(value, chunkSize) {
        return Math.floor(value / chunkSize);
    }

    function worldToPixel(value, chunkSize) {
        let result = value % chunkSize;

        if (result < 0) {
            result += chunkSize;
        }

        return result;
    }

    function worldToScreenX(x) {
        return (x - window.camX) / window.camZoom;
    }

    function worldToScreenY(y) {
        return (y - window.camY) / window.camZoom;
    }

    function screenToWorldX(x) {
        return window.camX + x * window.camZoom;
    }

    function screenToWorldY(y) {
        return window.camY + y * window.camZoom;
    }

    /*
     * ============================================================
     * CHUNK GENERATION
     * ============================================================
     */

    function generateChunk(cx, cy) {

        if (!planet || !planet.config) {
            return null;
        }

        const key = cx + "," + cy;

        /*
         * IMPORTANT:
         *
         * Re-use GenTown's existing chunks.
         * This is what keeps existing towns and terrain from
         * randomly getting replaced.
         */
        if (planet.chunks[key]) {
            return planet.chunks[key];
        }

        const config = planet.config;

        const chunkSize = config.chunkSize;
        const waterLevel = config.waterLevel;

        const biomeSize = config.biomeSize ?? 20;
        const configTemp = config.temp ?? 0;
        const configMoisture = config.moisture ?? 0;
        const configElevation = config.elevation ?? 0;

        const detail = config.detail ?? 5;
        const smooth = 1 - (config.smooth ?? 0.5);

        const landmassSize =
            config.landmassSize ?? 40;

        const tuneX =
            -(config.tuneX ?? 0);

        const tuneY =
            -(config.tuneY ?? 0);

        /*
         * Keep the exact same noise coordinates across the
         * infinite world.
         */

        const tuneXChunk =
            tuneX / chunkSize;

        const tuneYChunk =
            tuneY / chunkSize;

        const chunk = {
            v: {},
            x: cx,
            y: cy
        };

        /*
         * -------------------------
         * TEMPERATURE
         * -------------------------
         */

        chunk.t = noise.perlin2(
            (cx + tuneXChunk) / biomeSize,
            (cy + tuneYChunk) / biomeSize
        );

        chunk.t =
            (chunk.t + 0.5) / 0.8 +
            configTemp;

        chunk.t =
            clamp(chunk.t, 0, 1);

        chunk.t =
            Math.ceil(chunk.t * 10) / 10;

        /*
         * -------------------------
         * MOISTURE
         * -------------------------
         */

        chunk.m = noise.perlin2(
            (cx + 1000 + tuneXChunk) / biomeSize,
            (cy + 1000 + tuneYChunk) / biomeSize
        );

        chunk.m =
            (chunk.m + 0.5) / 0.8 +
            configMoisture;

        chunk.m =
            clamp(chunk.m, 0, 1);

        chunk.m =
            Math.ceil(chunk.m * 10) / 10;

        /*
         * -------------------------
         * TERRAIN
         * -------------------------
         */

        let elevations = 0;
        let isLand = false;

        const pixels = [];

        for (let x0 = 0; x0 < chunkSize; x0++) {

            pixels[x0] = [];

            for (let y0 = 0; y0 < chunkSize; y0++) {

                const worldX =
                    cx * chunkSize + x0;

                const worldY =
                    cy * chunkSize + y0;

                let value =
                    generatePerlinNoise(
                        (worldX + tuneX) /
                            landmassSize,

                        (worldY + tuneY) /
                            landmassSize,

                        detail,
                        smooth
                    );

                value =
                    (value + 0.3) / 0.72;

                value += configElevation;

                value =
                    clamp(value, 0, 1);

                value =
                    Math.ceil(value * 10) / 10;

                pixels[x0][y0] = value;

                elevations += value;

                if (value > waterLevel) {
                    isLand = true;
                }
            }
        }

        chunk.p = pixels;

        /*
         * Average elevation.
         */

        chunk.e =
            elevations /
            (chunkSize * chunkSize);

        chunk.e =
            Math.ceil(chunk.e * 10) / 10;

        /*
         * -------------------------
         * BIOME
         * -------------------------
         */

        if (
            !isLand ||
            chunk.e <= waterLevel
        ) {

            chunk.b = "water";

        } else if (chunk.e === 1) {

            chunk.b = "mountain";

        } else {

            let closestBiome = "grass";
            let closestDiff = Infinity;

            for (let biomeKey in biomes) {

                const biome =
                    biomes[biomeKey];

                if (
                    !biome ||
                    biome.noAuto
                ) {
                    continue;
                }

                let diff = 0;

                if (
                    biome.elevation !==
                    undefined
                ) {
                    diff += Math.pow(
                        biome.elevation -
                            chunk.e,
                        2
                    );
                }

                if (
                    biome.temp !==
                    undefined
                ) {
                    diff += Math.pow(
                        biome.temp -
                            chunk.t,
                        2
                    );
                }

                if (
                    biome.moisture !==
                    undefined
                ) {
                    diff += Math.pow(
                        biome.moisture -
                            chunk.m,
                        2
                    );
                }

                if (
                    diff <
                    closestDiff
                ) {
                    closestDiff = diff;
                    closestBiome = biomeKey;
                }
            }

            chunk.b =
                closestBiome;
        }

        /*
         * Deep water.
         */

        if (
            chunk.e <=
            waterLevel + 0.05
        ) {
            chunk.m = 1;
        }

        planet.chunks[key] = chunk;

        return chunk;
    }

    /*
     * Public chunk API.
     */

    window.getOrGenChunk =
        function (cx, cy) {
            return generateChunk(cx, cy);
        };

    window.chunkAt =
        function (cx, cy) {
            return generateChunk(cx, cy);
        };

    window.coordsToChunk =
        function (x, y) {

            const size =
                planet.config.chunkSize;

            return (
                worldToChunk(x, size) +
                "," +
                worldToChunk(y, size)
            );
        };

    window.pixelAt =
        function (x, y) {

            const size =
                planet.config.chunkSize;

            const cx =
                worldToChunk(x, size);

            const cy =
                worldToChunk(y, size);

            const chunk =
                generateChunk(cx, cy);

            if (!chunk) {
                return 0;
            }

            const px =
                worldToPixel(x, size);

            const py =
                worldToPixel(y, size);

            return chunk.p[px][py];
        };

    /*
     * ============================================================
     * TERRAIN COLOR
     * ============================================================
     */

    function getTerrainColor(
        chunk,
        value
    ) {

        const waterLevel =
            planet.config.waterLevel;

        const biome =
            biomes[chunk.b] ||
            biomes.water;

        let biomeColor =
            biome &&
            (
                biome.colorOverride ||
                biome.color
            );

        if (!biomeColor) {
            biomeColor =
                [100, 100, 100];
        }

        let color;

        /*
         * WATER
         */

        if (value <= waterLevel) {

            let waterValue =
                value +
                1 -
                waterLevel -
                0.1;

            waterValue =
                Math.max(
                    waterValue,
                    0
                );

            if (
                typeof waterColors !==
                    "undefined" &&
                waterColors &&
                waterColors.length
            ) {

                const index =
                    Math.min(
                        waterColors.length - 1,

                        Math.floor(
                            waterValue *
                            waterColors.length
                        )
                    );

                color =
                    waterColors[index];

            } else {

                color =
                    [50, 100, 180];
            }

        } else {

            let defaultWater =
                waterLevel;

            if (
                typeof $c !==
                    "undefined" &&
                $c &&
                $c.defaultWaterLevel !==
                    undefined
            ) {
                defaultWater =
                    $c.defaultWaterLevel;
            }

            let percent =
                value -
                (
                    waterLevel -
                    defaultWater
                );

            color = [
                biomeColor[0] * percent + 50,
                biomeColor[1] * percent + 50,
                biomeColor[2] * percent + 50
            ];
        }

        /*
         * Desaturation setting.
         */

        if (
            typeof userSettings !==
                "undefined" &&
            userSettings &&
            userSettings.desaturate &&
            typeof RGBtoHSL ===
                "function" &&
            typeof HSLtoRGB ===
                "function"
        ) {

            const hsl =
                RGBtoHSL(color);

            hsl[1] *= 0.7;

            color =
                HSLtoRGB(hsl);
        }

        return color;
    }

    /*
     * ============================================================
     * INFINITE TERRAIN RENDERER
     * ============================================================
     */

    function renderInfiniteMap() {

        if (
            !planet ||
            !planet.config ||
            !canvasLayersCtx ||
            !canvasLayersCtx.terrain
        ) {
            return;
        }

        const ctx =
            canvasLayersCtx.terrain;

        const canvas =
            canvasLayers.terrain;

        const size =
            getCanvasSize();

        /*
         * Make sure the canvas corresponds to the visible
         * map area.
         */

        if (
            canvas.width !==
            Math.floor(size.width)
        ) {
            canvas.width =
                Math.floor(size.width);
        }

        if (
            canvas.height !==
            Math.floor(size.height)
        ) {
            canvas.height =
                Math.floor(size.height);
        }

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        const chunkSize =
            planet.config.chunkSize;

        /*
         * World rectangle visible on screen.
         */

        const left =
            window.camX;

        const top =
            window.camY;

        const right =
            left +
            canvas.width *
            window.camZoom;

        const bottom =
            top +
            canvas.height *
            window.camZoom;

        /*
         * Convert visible world rectangle to chunks.
         */

        const minCX =
            Math.floor(
                left / chunkSize
            ) -
            CHUNK_PADDING;

        const maxCX =
            Math.floor(
                right / chunkSize
            ) +
            CHUNK_PADDING;

        const minCY =
            Math.floor(
                top / chunkSize
            ) -
            CHUNK_PADDING;

        const maxCY =
            Math.floor(
                bottom / chunkSize
            ) +
            CHUNK_PADDING;

        /*
         * Render only visible chunks.
         */

        for (
            let cx = minCX;
            cx <= maxCX;
            cx++
        ) {

            for (
                let cy = minCY;
                cy <= maxCY;
                cy++
            ) {

                const chunk =
                    generateChunk(
                        cx,
                        cy
                    );

                if (!chunk) {
                    continue;
                }

                /*
                 * Chunk world rectangle.
                 */

                const chunkWorldX =
                    cx * chunkSize;

                const chunkWorldY =
                    cy * chunkSize;

                /*
                 * Screen rectangle of the chunk.
                 */

                const chunkScreenX =
                    worldToScreenX(
                        chunkWorldX
                    );

                const chunkScreenY =
                    worldToScreenY(
                        chunkWorldY
                    );

                const chunkScreenW =
                    chunkSize /
                    window.camZoom;

                const chunkScreenH =
                    chunkSize /
                    window.camZoom;

                /*
                 * Completely outside screen?
                 */

                if (
                    chunkScreenX +
                        chunkScreenW <
                        0 ||
                    chunkScreenY +
                        chunkScreenH <
                        0 ||
                    chunkScreenX >
                        canvas.width ||
                    chunkScreenY >
                        canvas.height
                ) {
                    continue;
                }

                /*
                 * Render pixels.
                 */

                for (
                    let x0 = 0;
                    x0 < chunkSize;
                    x0++
                ) {

                    for (
                        let y0 = 0;
                        y0 < chunkSize;
                        y0++
                    ) {

                        const value =
                            chunk.p[x0][y0];

                        const worldX =
                            chunkWorldX +
                            x0;

                        const worldY =
                            chunkWorldY +
                            y0;

                        const sx =
                            worldToScreenX(
                                worldX
                            );

                        const sy =
                            worldToScreenY(
                                worldY
                            );

                        const sx2 =
                            worldToScreenX(
                                worldX + 1
                            );

                        const sy2 =
                            worldToScreenY(
                                worldY + 1
                            );

                        /*
                         * Don't waste time drawing pixels that
                         * are completely outside the canvas.
                         */

                        if (
                            sx2 < 0 ||
                            sy2 < 0 ||
                            sx > canvas.width ||
                            sy > canvas.height
                        ) {
                            continue;
                        }

                        const color =
                            getTerrainColor(
                                chunk,
                                value
                            );

                        ctx.fillStyle =
                            "rgb(" +
                            color
                                .map(Math.round)
                                .join(",") +
                            ")";

                        ctx.fillRect(
                            Math.floor(sx),
                            Math.floor(sy),

                            Math.max(
                                1,
                                Math.ceil(
                                    sx2 - sx
                                )
                            ),

                            Math.max(
                                1,
                                Math.ceil(
                                    sy2 - sy
                                )
                            )
                        );
                    }
                }
            }
        }
    }

    /*
     * ============================================================
     * CURSOR
     * ============================================================
     */

    function renderInfiniteCursor() {

        if (
            !canvasLayersCtx ||
            !canvasLayersCtx.cursor
        ) {
            return;
        }

        const ctx =
            canvasLayersCtx.cursor;

        const canvas =
            canvasLayers.cursor;

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        if (
            !mousePos ||
            !planet ||
            !planet.config
        ) {
            return;
        }

        const size =
            planet.config.chunkSize;

        const chunkX =
            mousePos.chunkX;

        const chunkY =
            mousePos.chunkY;

        const worldX =
            chunkX * size;

        const worldY =
            chunkY * size;

        const sx =
            worldToScreenX(
                worldX
            );

        const sy =
            worldToScreenY(
                worldY
            );

        const sx2 =
            worldToScreenX(
                worldX + size
            );

        const sy2 =
            worldToScreenY(
                worldY + size
            );

        ctx.fillStyle =
            "rgba(240,240,240,0.35)";

        ctx.fillRect(
            sx,
            sy,
            Math.max(
                1,
                sx2 - sx
            ),
            Math.max(
                1,
                sy2 - sy
            )
        );
    }

    /*
     * ============================================================
     * VIEW UPDATE
     * ============================================================
     */

    let rendering = false;

    function updateInfiniteView() {

        /*
         * Don't render multiple times simultaneously.
         */

        if (rendering) {
            return;
        }

        rendering = true;

        try {

            renderInfiniteMap();

            renderInfiniteCursor();

        } catch (err) {

            console.error(
                "[Infinite World] Render error:",
                err
            );

        }

        rendering = false;
    }

    /*
     * ============================================================
     * CAMERA CONTROLS
     * ============================================================
     */

    function installCameraControls() {

        let panning = false;

        let startMouseX = 0;
        let startMouseY = 0;

        let startCamX = 0;
        let startCamY = 0;

        /*
         * -------------------------
         * ZOOM
         * -------------------------
         */

        mapCanvas.addEventListener(
            "wheel",
            function (e) {

                e.preventDefault();
                e.stopPropagation();

                const rect =
                    mapCanvas.getBoundingClientRect();

                const mouseX =
                    e.clientX -
                    rect.left;

                const mouseY =
                    e.clientY -
                    rect.top;

                const oldZoom =
                    window.camZoom;

                /*
                 * Smooth-ish exponential zoom.
                 */

                const factor =
                    e.deltaY < 0
                        ? 0.82
                        : 1.22;

                const newZoom =
                    clamp(
                        oldZoom * factor,
                        MIN_ZOOM,
                        MAX_ZOOM
                    );

                if (
                    newZoom ===
                    oldZoom
                ) {
                    return;
                }

                /*
                 * Find the exact world coordinate
                 * underneath the mouse BEFORE zooming.
                 */

                const worldX =
                    screenToWorldX(
                        mouseX
                    );

                const worldY =
                    screenToWorldY(
                        mouseY
                    );

                window.camZoom =
                    newZoom;

                /*
                 * Move camera so the same world coordinate
                 * stays underneath the mouse.
                 */

                window.camX =
                    worldX -
                    mouseX *
                    newZoom;

                window.camY =
                    worldY -
                    mouseY *
                    newZoom;

                updateInfiniteView();

            },
            {
                passive: false
            }
        );

        /*
         * -------------------------
         * START PAN
         * -------------------------
         */

        mapCanvas.addEventListener(
            "mousedown",
            function (e) {

                /*
                 * Left and middle/right mouse can pan.
                 */

                if (
                    e.button !== 0 &&
                    e.button !== 1 &&
                    e.button !== 2
                ) {
                    return;
                }

                panning = true;

                startMouseX =
                    e.clientX;

                startMouseY =
                    e.clientY;

                startCamX =
                    window.camX;

                startCamY =
                    window.camY;

                /*
                 * Capture the mouse so dragging continues
                 * even if it leaves the map.
                 */

                if (
                    mapCanvas.setPointerCapture &&
                    e.pointerId !==
                        undefined
                ) {
                    try {
                        mapCanvas.setPointerCapture(
                            e.pointerId
                        );
                    } catch (_) {}
                }
            }
        );

        /*
         * -------------------------
         * PAN
         * -------------------------
         */

        window.addEventListener(
            "mousemove",
            function (e) {

                if (!panning) {
                    return;
                }

                const dx =
                    e.clientX -
                    startMouseX;

                const dy =
                    e.clientY -
                    startMouseY;

                /*
                 * Moving the mouse right means the camera
                 * moves left through the world.
                 */

                window.camX =
                    startCamX -
                    dx *
                    window.camZoom;

                window.camY =
                    startCamY -
                    dy *
                    window.camZoom;

                updateInfiniteView();
            }
        );

        /*
         * -------------------------
         * END PAN
         * -------------------------
         */

        window.addEventListener(
            "mouseup",
            function () {
                panning = false;
            }
        );

        /*
         * -------------------------
         * RIGHT CLICK
         * -------------------------
         */

        mapCanvas.addEventListener(
            "contextmenu",
            function (e) {
                e.preventDefault();
            }
        );
    }

    /*
     * ============================================================
     * CURSOR / WORLD POSITION
     * ============================================================
     */

    function installCursor() {

        mapCanvas.addEventListener(
            "mousemove",
            function (e) {

                if (
                    !planet ||
                    !planet.config
                ) {
                    return;
                }

                const rect =
                    mapCanvas.getBoundingClientRect();

                const screenX =
                    e.clientX -
                    rect.left;

                const screenY =
                    e.clientY -
                    rect.top;

                const worldX =
                    Math.floor(
                        screenToWorldX(
                            screenX
                        )
                    );

                const worldY =
                    Math.floor(
                        screenToWorldY(
                            screenY
                        )
                    );

                const size =
                    planet.config.chunkSize;

                const chunkX =
                    worldToChunk(
                        worldX,
                        size
                    );

                const chunkY =
                    worldToChunk(
                        worldY,
                        size
                    );

                mousePos = {
                    x: worldX,
                    y: worldY,
                    chunkX: chunkX,
                    chunkY: chunkY
                };

                /*
                 * Generate the chunk under the cursor.
                 */

                generateChunk(
                    chunkX,
                    chunkY
                );

                renderInfiniteCursor();
            }
        );
    }

    /*
     * ============================================================
     * CENTER CAMERA
     * ============================================================
     */

    function centerOnExistingWorld() {

        if (
            !planet ||
            !planet.config
        ) {
            return;
        }

        const size =
            getCanvasSize();

        /*
         * Start around the center of GenTown's original map.
         * This is only the INITIAL camera position.
         *
         * It does not limit the world.
         */

        window.camX =
            (
                planet.config.width -
                size.width
            ) / 2;

        window.camY =
            (
                planet.config.height -
                size.height
            ) / 2;

        window.camZoom = 1;
    }

    /*
     * ============================================================
     * INITIALIZATION
     * ============================================================
     */

    function initInfiniteWorld() {

        if (
            !planet ||
            !planet.config
        ) {
            return false;
        }

        if (
            !mapCanvas ||
            !canvasLayersCtx ||
            !canvasLayersCtx.terrain
        ) {
            return false;
        }

        console.log(
            "[Infinite World] Initializing..."
        );

        /*
         * Remove the normal edge falloff.
         */

        planet.config.borderFalloff = 0;

        /*
         * DO NOT regenerate the planet.
         *
         * This is extremely important.
         *
         * Existing towns, saves and terrain remain intact.
         */

        centerOnExistingWorld();

        /*
         * Install camera.
         */

        installCameraControls();

        /*
         * Install world cursor.
         */

        installCursor();

        /*
         * First render.
         */

        updateInfiniteView();

        console.log(
            "[Infinite World] Ready."
        );

        if (
            typeof logMessage ===
            "function"
        ) {
            try {

                logMessage(
                    "Infinite world initialized.",
                    "tip"
                );

            } catch (_) {}
        }

        return true;
    }

    /*
     * ============================================================
     * WAIT FOR GENTOWN
     * ============================================================
     */

    function waitForGame() {

        if (initialized) {
            return;
        }

        const ready =
            typeof planet !==
                "undefined" &&
            planet &&
            planet.config &&
            typeof mapCanvas !==
                "undefined" &&
            mapCanvas &&
            typeof canvasLayers !==
                "undefined" &&
            canvasLayers &&
            canvasLayers.terrain &&
            typeof canvasLayersCtx !==
                "undefined" &&
            canvasLayersCtx &&
            canvasLayersCtx.terrain &&
            typeof biomes !==
                "undefined" &&
            typeof noise !==
                "undefined";

        if (!ready) {

            setTimeout(
                waitForGame,
                250
            );

            return;
        }

        /*
         * Give GenTown another moment to finish its normal
         * map initialization before taking over rendering.
         */

        setTimeout(
            function () {

                try {

                    if (
                        initInfiniteWorld()
                    ) {

                        initialized = true;

                    } else {

                        setTimeout(
                            waitForGame,
                            500
                        );
                    }

                } catch (err) {

                    console.error(
                        "[Infinite World] Initialization error:",
                        err
                    );

                    setTimeout(
                        waitForGame,
                        1000
                    );
                }

            },
            750
        );
    }

    waitForGame();
});

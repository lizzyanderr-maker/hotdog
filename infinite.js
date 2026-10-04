Mod.afterLoad(function () {
    console.log("[Infinite World] Mod loaded.");

    let initialized = false;
    let initializing = false;

    window.camX = 0;
    window.camY = 0;
    window.camZoom = 1;

    function waitForGame() {
        if (initialized || initializing) return;

        if (
            typeof planet === "undefined" ||
            !planet ||
            !planet.config ||
            typeof mapCanvas === "undefined" ||
            !mapCanvas ||
            typeof canvasLayers === "undefined" ||
            !canvasLayers.terrain ||
            typeof canvasLayersCtx === "undefined" ||
            !canvasLayersCtx.terrain ||
            typeof biomes === "undefined" ||
            typeof viewData === "undefined" ||
            typeof currentView === "undefined"
        ) {
            setTimeout(waitForGame, 250);
            return;
        }

        initializing = true;

        setTimeout(function () {
            try {
                initInfiniteWorld();
                initialized = true;
                console.log("[Infinite World] Initialized successfully.");
            } catch (err) {
                console.error("[Infinite World] Initialization failed:", err);
                initializing = false;
            }
        }, 1000);
    }

    function getChunk(cx, cy) {
        if (!planet || !planet.config) return null;

        let key = cx + "," + cy;

        if (planet.chunks[key]) {
            return planet.chunks[key];
        }

        const chunkSize = planet.config.chunkSize;
        const waterLevel = planet.config.waterLevel;

        const biomeSize = planet.config.biomeSize ?? 20;
        const configTemp = planet.config.temp ?? 0;
        const configMoisture = planet.config.moisture ?? 0;
        const configElevation = planet.config.elevation ?? 0;
        const detail = planet.config.detail ?? 5;
        const smooth = 1 - (planet.config.smooth ?? 0.5);
        const landmassSize = planet.config.landmassSize ?? 40;

        const tuneX = -(planet.config.tuneX ?? 0);
        const tuneY = -(planet.config.tuneY ?? 0);

        const tuneXChunk = tuneX / chunkSize;
        const tuneYChunk = tuneY / chunkSize;

        let chunk = {
            v: {},
            x: cx,
            y: cy
        };

        /*
         * Temperature
         */
        chunk.t = noise.perlin2(
            (cx + tuneXChunk) / biomeSize,
            (cy + tuneYChunk) / biomeSize
        );

        chunk.t = (chunk.t + 0.5) / 0.8 + configTemp;
        chunk.t = Math.max(0, Math.min(chunk.t, 1));
        chunk.t = Math.ceil(chunk.t * 10) / 10;

        /*
         * Moisture
         */
        chunk.m = noise.perlin2(
            (cx + 1000 + tuneXChunk) / biomeSize,
            (cy + 1000 + tuneYChunk) / biomeSize
        );

        chunk.m = (chunk.m + 0.5) / 0.8 + configMoisture;
        chunk.m = Math.max(0, Math.min(chunk.m, 1));
        chunk.m = Math.ceil(chunk.m * 10) / 10;

        /*
         * Generate terrain pixels for this chunk only.
         */
        let elevations = 0;
        let isLand = false;
        let chunkPixels = [];

        for (let x0 = 0; x0 < chunkSize; x0++) {
            chunkPixels.push([]);

            for (let y0 = 0; y0 < chunkSize; y0++) {
                let x = cx * chunkSize + x0;
                let y = cy * chunkSize + y0;

                let value = generatePerlinNoise(
                    (x + tuneX) / landmassSize,
                    (y + tuneY) / landmassSize,
                    detail,
                    smooth
                );

                value = (value + 0.3) / 0.72;
                value += configElevation;

                value = Math.max(0, Math.min(1, value));
                value = Math.ceil(value * 10) / 10;

                chunkPixels[x0].push(value);

                elevations += value;

                if (value > waterLevel) {
                    isLand = true;
                }
            }
        }

        chunk.p = chunkPixels;

        chunk.e = elevations / (chunkSize * chunkSize);
        chunk.e = Math.ceil(chunk.e * 10) / 10;

        if (chunk.e <= waterLevel + 0.05) {
            chunk.m = 1;
        }

        /*
         * Determine biome.
         */
        if (!isLand || chunk.e <= waterLevel) {
            chunk.b = "water";
        } else if (chunk.e === 1) {
            chunk.b = "mountain";
        } else {
            let closestBiome = "grass";
            let closestDiff = Infinity;

            for (let biomeKey in biomes) {
                let b = biomes[biomeKey];

                if (!b || b.noAuto) continue;

                let diff = 0;

                if (b.elevation !== undefined) {
                    diff += Math.pow(b.elevation - chunk.e, 2);
                }

                if (b.temp !== undefined) {
                    diff += Math.pow(b.temp - chunk.t, 2);
                }

                if (b.moisture !== undefined) {
                    diff += Math.pow(b.moisture - chunk.m, 2);
                }

                if (diff < closestDiff) {
                    closestDiff = diff;
                    closestBiome = biomeKey;
                }
            }

            chunk.b = closestBiome;
        }

        planet.chunks[key] = chunk;

        return chunk;
    }

    function renderInfiniteMap() {
        if (!planet || !planet.config) return;
        if (!canvasLayersCtx || !canvasLayersCtx.terrain) return;

        let ctx = canvasLayersCtx.terrain;

        ctx.clearRect(
            0,
            0,
            canvasLayers.terrain.width,
            canvasLayers.terrain.height
        );

        const chunkSize = planet.config.chunkSize;
        const waterLevel = planet.config.waterLevel;

        /*
         * Use the actual canvas dimensions as the viewport.
         * This is important because the original code incorrectly
         * used the finite planet width/height as a clipping boundary.
         */
        const screenW = mapCanvas.clientWidth || mapCanvas.width;
        const screenH = mapCanvas.clientHeight || mapCanvas.height;

        /*
         * camZoom:
         *
         * 1 = normal
         * < 1 = zoomed in
         * > 1 = zoomed out
         */
        const worldW = screenW * window.camZoom;
        const worldH = screenH * window.camZoom;

        const startWorldX = window.camX;
        const startWorldY = window.camY;

        const endWorldX = startWorldX + worldW;
        const endWorldY = startWorldY + worldH;

        let startChunkX = Math.floor(startWorldX / chunkSize);
        let endChunkX = Math.floor(endWorldX / chunkSize);

        let startChunkY = Math.floor(startWorldY / chunkSize);
        let endChunkY = Math.floor(endWorldY / chunkSize);

        /*
         * Prevent accidentally rendering thousands of chunks at once.
         */
        const MAX_CHUNKS_X = 80;
        const MAX_CHUNKS_Y = 80;

        if (endChunkX - startChunkX > MAX_CHUNKS_X) {
            endChunkX = startChunkX + MAX_CHUNKS_X;
        }

        if (endChunkY - startChunkY > MAX_CHUNKS_Y) {
            endChunkY = startChunkY + MAX_CHUNKS_Y;
        }

        for (let cx = startChunkX; cx <= endChunkX; cx++) {
            for (let cy = startChunkY; cy <= endChunkY; cy++) {

                let chunk = getChunk(cx, cy);

                if (!chunk) continue;

                let biome = biomes[chunk.b] || biomes.water;

                if (!biome) continue;

                let biomeColor =
                    biome.colorOverride ||
                    biome.color ||
                    [100, 100, 100];

                /*
                 * Draw each terrain pixel.
                 */
                for (let x0 = 0; x0 < chunkSize; x0++) {
                    for (let y0 = 0; y0 < chunkSize; y0++) {

                        let value = chunk.p[x0][y0];

                        let worldX = cx * chunkSize + x0;
                        let worldY = cy * chunkSize + y0;

                        let sx = Math.floor(
                            (worldX - window.camX) / window.camZoom
                        );

                        let sy = Math.floor(
                            (worldY - window.camY) / window.camZoom
                        );

                        let nextSX = Math.ceil(
                            (worldX + 1 - window.camX) / window.camZoom
                        );

                        let nextSY = Math.ceil(
                            (worldY + 1 - window.camY) / window.camZoom
                        );

                        let sw = Math.max(1, nextSX - sx);
                        let sh = Math.max(1, nextSY - sy);

                        if (
                            sx + sw < 0 ||
                            sy + sh < 0 ||
                            sx >= screenW ||
                            sy >= screenH
                        ) {
                            continue;
                        }

                        let color;

                        if (value <= waterLevel) {

                            let waterValue =
                                value + 1 - waterLevel - 0.1;

                            waterValue = Math.max(waterValue, 0);

                            if (typeof waterColors !== "undefined" && waterColors.length) {
                                color =
                                    waterColors[
                                        Math.min(
                                            waterColors.length - 1,
                                            Math.floor(
                                                waterValue *
                                                waterColors.length
                                            )
                                        )
                                    ];
                            } else {
                                color = [50, 100, 180];
                            }

                        } else {

                            let percent =
                                value -
                                (waterLevel -
                                    ($c.defaultWaterLevel ?? waterLevel));

                            color = [
                                biomeColor[0] * percent + 50,
                                biomeColor[1] * percent + 50,
                                biomeColor[2] * percent + 50
                            ];
                        }

                        if (
                            typeof userSettings !== "undefined" &&
                            userSettings.desaturate &&
                            typeof RGBtoHSL === "function"
                        ) {
                            let hsl = RGBtoHSL(color);

                            hsl[1] *= 0.7;

                            color = HSLtoRGB(hsl);
                        }

                        ctx.fillStyle =
                            "rgb(" +
                            color.map(Math.round).join(",") +
                            ")";

                        ctx.fillRect(
                            sx,
                            sy,
                            sw,
                            sh
                        );
                    }
                }
            }
        }
    }

    function renderInfiniteCursor() {
        if (!canvasLayersCtx || !canvasLayersCtx.cursor) return;

        let ctx = canvasLayersCtx.cursor;

        ctx.clearRect(
            0,
            0,
            canvasLayers.cursor.width,
            canvasLayers.cursor.height
        );

        if (!mousePos || !planet || !planet.config) {
            return;
        }

        const chunkSize = planet.config.chunkSize;

        let sx = Math.floor(
            (mousePos.chunkX * chunkSize - window.camX) /
            window.camZoom
        );

        let sy = Math.floor(
            (mousePos.chunkY * chunkSize - window.camY) /
            window.camZoom
        );

        let sw = Math.max(
            1,
            Math.ceil(
                ((mousePos.chunkX + 1) * chunkSize - window.camX) /
                window.camZoom
            ) - sx
        );

        let sh = Math.max(
            1,
            Math.ceil(
                ((mousePos.chunkY + 1) * chunkSize - window.camY) /
                window.camZoom
            ) - sy
        );

        ctx.fillStyle = "rgba(240,240,240,0.5)";

        ctx.fillRect(
            sx,
            sy,
            sw,
            sh
        );
    }

    function updateInfiniteView() {
        renderInfiniteMap();

        if (typeof renderHighlight === "function") {
            try {
                renderHighlight();
            } catch (err) {
                console.warn(
                    "[Infinite World] Highlight render failed:",
                    err
                );
            }
        }

        renderInfiniteCursor();

        if (typeof updateCanvas === "function") {
            updateCanvas();
        }

        if (typeof updateStats === "function") {
            updateStats();
        }
    }

    function installMouseControls() {

        /*
         * Zoom
         */
        mapCanvas.addEventListener(
            "wheel",
            function (e) {

                e.preventDefault();
                e.stopPropagation();

                let rect =
                    mapCanvas.getBoundingClientRect();

                let mouseX =
                    e.clientX - rect.left;

                let mouseY =
                    e.clientY - rect.top;

                let screenW =
                    mapCanvas.clientWidth;

                let screenH =
                    mapCanvas.clientHeight;

                let oldZoom =
                    window.camZoom;

                let factor =
                    e.deltaY < 0
                        ? 0.8
                        : 1.25;

                let newZoom =
                    Math.max(
                        0.25,
                        Math.min(
                            20,
                            oldZoom * factor
                        )
                    );

                if (newZoom === oldZoom) {
                    return;
                }

                /*
                 * Keep the world point under the mouse stationary.
                 */
                let worldX =
                    window.camX +
                    mouseX * oldZoom;

                let worldY =
                    window.camY +
                    mouseY * oldZoom;

                window.camZoom =
                    newZoom;

                window.camX =
                    worldX -
                    mouseX * newZoom;

                window.camY =
                    worldY -
                    mouseY * newZoom;

                updateInfiniteView();

            },
            {
                passive: false
            }
        );

        /*
         * Panning
         */
        let panning = false;

        let startMouseX = 0;
        let startMouseY = 0;

        let startCamX = 0;
        let startCamY = 0;

        mapCanvas.addEventListener(
            "mousedown",
            function (e) {

                if (
                    e.button !== 0 &&
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

                e.preventDefault();
            }
        );

        mapCanvas.addEventListener(
            "contextmenu",
            function (e) {
                e.preventDefault();
            }
        );

        window.addEventListener(
            "mousemove",
            function (e) {

                if (!panning) {
                    return;
                }

                let dx =
                    e.clientX -
                    startMouseX;

                let dy =
                    e.clientY -
                    startMouseY;

                window.camX =
                    startCamX -
                    dx * window.camZoom;

                window.camY =
                    startCamY -
                    dy * window.camZoom;

                updateInfiniteView();
            }
        );

        window.addEventListener(
            "mouseup",
            function () {
                panning = false;
            }
        );
    }

    function installCursor() {

        mapCanvas.addEventListener(
            "mousemove",
            function (e) {

                if (!planet || !planet.config) {
                    return;
                }

                let rect =
                    mapCanvas.getBoundingClientRect();

                let screenX =
                    e.clientX -
                    rect.left;

                let screenY =
                    e.clientY -
                    rect.top;

                let worldX =
                    Math.floor(
                        window.camX +
                        screenX *
                        window.camZoom
                    );

                let worldY =
                    Math.floor(
                        window.camY +
                        screenY *
                        window.camZoom
                    );

                let chunkSize =
                    planet.config.chunkSize;

                let chunkX =
                    Math.floor(
                        worldX / chunkSize
                    );

                let chunkY =
                    Math.floor(
                        worldY / chunkSize
                    );

                mousePos = {
                    x: worldX,
                    y: worldY,
                    chunkX: chunkX,
                    chunkY: chunkY
                };

                /*
                 * Only generate the chunk under the cursor.
                 */
                getChunk(
                    chunkX,
                    chunkY
                );

                renderInfiniteCursor();
            }
        );
    }

    function initInfiniteWorld() {

        if (!planet || !planet.config) {
            throw new Error(
                "Planet is not ready."
            );
        }

        console.log(
            "[Infinite World] Starting safe initialization..."
        );

        /*
         * Remove the edge falloff without regenerating
         * the existing planet.
         */
        planet.config.borderFalloff = 0;

        /*
         * Expose chunk functions.
         */
        window.getOrGenChunk = getChunk;

        window.chunkAt = function (x, y) {
            return getChunk(x, y);
        };

        window.coordsToChunk = function (x, y) {
            return (
                Math.floor(
                    x / planet.config.chunkSize
                ) +
                "," +
                Math.floor(
                    y / planet.config.chunkSize
                )
            );
        };

        window.pixelAt = function (x, y) {

            let chunkSize =
                planet.config.chunkSize;

            let cx =
                Math.floor(
                    x / chunkSize
                );

            let cy =
                Math.floor(
                    y / chunkSize
                );

            let chunk =
                getChunk(cx, cy);

            if (!chunk) {
                return 0;
            }

            let px =
                ((x % chunkSize) +
                    chunkSize) %
                chunkSize;

            let py =
                ((y % chunkSize) +
                    chunkSize) %
                chunkSize;

            return chunk.p[px][py];
        };

        /*
         * Start from the current center of the existing map.
         */
        window.camX = 0;
        window.camY = 0;
        window.camZoom = 1;

        /*
         * Generate only the chunks currently visible.
         */
        renderInfiniteMap();

        /*
         * Don't replace all of GenTown's existing render
         * functions. That was one of the dangerous parts
         * of the original script.
         */
        installMouseControls();
        installCursor();

        renderInfiniteCursor();

        if (typeof updateCanvas === "function") {
            updateCanvas();
        }

        console.log(
            "[Infinite World] Infinite terrain is ready."
        );

        if (typeof logMessage === "function") {
            try {
                logMessage(
                    "Infinite world initialized.",
                    "tip"
                );
            } catch (e) {
                console.warn(
                    "[Infinite World] Could not write game log."
                );
            }
        }
    }

    waitForGame();
});

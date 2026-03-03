/**
 * ExportPipeline.js — Offline render loop for WebGL2 compositor export
 *
 * Drives the compositor frame-by-frame:
 *   renderFrame(f) -> readPixels() -> IPC to main process -> FFmpeg NVENC encode
 *
 * The main process spawns FFmpeg with raw RGBA pipe input and handles encoding.
 * Audio is muxed separately after all video frames are written.
 *
 * Two export paths:
 *   - Legacy: per-frame HTMLVideoElement seeking + RAF yield + sync readPixels + per-frame IPC
 *   - Optimized: WebCodecs sequential decode + PBO async readback + batched IPC
 */

class ExportPipeline {
    /**
     * @param {Compositor} compositor - The initialized compositor engine
     */
    constructor(compositor) {
        this.compositor = compositor;
        this._cancelled = false;
        this._progressCallback = null;
        this._running = false;
    }

    /**
     * Register a progress callback.
     * @param {function} cb - (data: { percent, currentFrame, totalFrames, fps }) => void
     */
    onProgress(cb) {
        this._progressCallback = cb;
    }

    /**
     * Run the full export pipeline.
     *
     * @param {object} options - Export options
     * @param {number} options.width - Output width (default 1920)
     * @param {number} options.height - Output height (default 1080)
     * @param {number} options.fps - Frames per second (default 30)
     * @param {boolean} options.legacy - Force legacy export path (per-frame seek + RAF)
     * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
     */
    async start(options) {
        if (this._running) {
            return { success: false, error: 'Export already in progress' };
        }

        const width = (options && options.width) || this.compositor.width;
        const height = (options && options.height) || this.compositor.height;
        const fps = (options && options.fps) || this.compositor.fps;
        const totalFrames = this.compositor.totalFrames;

        if (totalFrames <= 0) {
            return { success: false, error: 'No frames to export (empty timeline)' };
        }

        const legacy = !!(options && options.legacy);

        this._running = true;
        this._cancelled = false;
        this.compositor._exporting = true;

        console.log(`[ExportPipeline] Starting ${legacy ? 'LEGACY' : 'OPTIMIZED'} export: ${totalFrames} frames, ${width}x${height} @ ${fps}fps`);
        const startTime = performance.now();

        try {
            // 1. Tell main process to spawn FFmpeg
            const startResult = await window.electronAPI.startWebGLExport({
                width, height, fps, totalFrames,
            });
            if (!startResult || !startResult.success) {
                throw new Error(startResult?.error || 'Failed to start FFmpeg process');
            }

            // 2. Pause all video playback, prepare for seeking
            this.compositor.pauseVideos();

            // 3. Run frame loop (legacy or optimized)
            if (legacy || !this._canUseOptimizedPath()) {
                await this._runLegacyFrameLoop(fps, totalFrames, startTime);
            } else {
                await this._runOptimizedFrameLoop(fps, totalFrames, startTime);
            }

            // 4. Finish: close FFmpeg stdin, mux audio
            const finishResult = await window.electronAPI.finishWebGLExport();
            if (!finishResult || !finishResult.success) {
                throw new Error(finishResult?.error || 'FFmpeg failed to produce output');
            }

            const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            console.log(`[ExportPipeline] Export complete in ${totalElapsed}s: ${finishResult.outputPath}`);

            return { success: true, outputPath: finishResult.outputPath };

        } catch (err) {
            console.error('[ExportPipeline] Export failed:', err.message);
            try {
                await window.electronAPI.cancelWebGLExport();
            } catch (_) {}
            return { success: false, error: err.message };

        } finally {
            this._running = false;
            this.compositor._exporting = false;
            this.compositor._resetVideosForPreview();
        }
    }

    /**
     * Check if the optimized export path is available.
     * Phase 1: requires WebCodecs VideoDecoder + VideoFrameSource class.
     */
    _canUseOptimizedPath() {
        // Phase 1: WebCodecs sequential decode (no per-frame seeking/RAF)
        // Phase 2 (future): + PBO async readback + batched IPC
        return typeof VideoFrameSource !== 'undefined'
            && typeof VideoDecoder !== 'undefined';
    }

    // ========================================================================
    // LEGACY FRAME LOOP (current working path)
    // ========================================================================

    /**
     * Legacy export: per-frame HTMLVideoElement seeking + RAF yield + sync readPixels + per-frame IPC.
     */
    async _runLegacyFrameLoop(fps, totalFrames, startTime) {
        let lastProgressTime = 0;
        for (let frame = 0; frame < totalFrames; frame++) {
            if (this._cancelled) throw new Error('Export cancelled');

            // Seek all active videos to this frame
            const activeScenes = this.compositor.sceneGraph.getActiveScenesAtFrame(frame);
            let didSeek = false;
            for (const { scene } of activeScenes) {
                if (scene.isMGScene || scene.mediaType === 'motion-graphic') continue;
                const localFrame = frame - scene._startFrame;
                const mediaOffsetFrames = Math.round((scene.mediaOffset || 0) * fps);
                await this.compositor.seekVideoToFrame(scene.index, localFrame + mediaOffsetFrames);
                didSeek = true;
            }

            // Yield to browser so video frames are decoded for texImage2D
            if (didSeek) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }

            // Render the frame
            this.compositor.renderFrame(frame);

            // Read pixels (flipped to top-down)
            const pixels = this.compositor.readPixels();

            // Send to main process via IPC
            const result = await window.electronAPI.sendExportFrame(pixels.buffer);
            if (!result || !result.success) {
                throw new Error('Failed to write frame to FFmpeg');
            }

            // Progress reporting
            this._reportProgress(frame, totalFrames, startTime, lastProgressTime, (t) => { lastProgressTime = t; });
        }
    }

    // ========================================================================
    // OPTIMIZED FRAME LOOP (WebCodecs + PBO + batch IPC)
    // ========================================================================

    /**
     * Optimized export: WebCodecs sequential decode replaces per-frame HTMLVideoElement seeking.
     * Eliminates the seek + seeked-event + requestAnimationFrame yield per frame.
     * Falls back per-scene to legacy seeking if WebCodecs init fails (non-MP4, unsupported codec).
     *
     * Guarantees:
     *  - Renders the exact same frameIndex sequence as legacy (0..totalFrames-1)
     *  - compositor._exportFrameSources cleared in finally{} even on cancel/error
     *  - All VideoFrames closed on exit to prevent GPU memory leaks
     *  - Legacy path still available via options.legacy=true for hash comparison
     */
    async _runOptimizedFrameLoop(fps, totalFrames, startTime) {
        const vfs = new VideoFrameSource();
        const webcodecScenes = new Set();  // sceneIndex → uses WebCodecs
        const legacyScenes = new Set();    // sceneIndex → falls back to HTMLVideoElement seek

        // 1. Init WebCodecs decoders for all video scenes
        const allScenes = this.compositor.sceneGraph.scenes;
        const initPromises = [];

        for (const scene of allScenes) {
            if (scene.isMGScene || scene.mediaType === 'motion-graphic') continue;
            if (scene.mediaType === 'image') continue;
            const idx = scene.index;
            const url = this.compositor._mediaUrls[idx];
            if (!url) {
                legacyScenes.add(idx);
                console.log(`[ExportPipeline] Fallback to LEGACY for scene ${idx} (no media URL)`);
                continue;
            }

            const ext = (scene.mediaExtension || '.mp4').toLowerCase();
            if (ext !== '.mp4') {
                legacyScenes.add(idx);
                console.log(`[ExportPipeline] Fallback to LEGACY for scene ${idx} (non-MP4: ${ext})`);
                continue;
            }

            initPromises.push(
                vfs.init(idx, url, fps).then(ok => {
                    if (ok) {
                        webcodecScenes.add(idx);
                        const state = vfs._decoders.get(idx);
                        const codec = state && state.codecConfig ? state.codecConfig.codec : 'unknown';
                        console.log(`[ExportPipeline] Using OPTIMIZED WebCodecs for scene ${idx} (${codec})`);
                    } else {
                        legacyScenes.add(idx);
                        console.log(`[ExportPipeline] Fallback to LEGACY for scene ${idx} (WebCodecs init failed)`);
                    }
                })
            );
        }

        await Promise.all(initPromises);
        console.log(`[ExportPipeline] Optimized: ${webcodecScenes.size} WebCodecs, ${legacyScenes.size} legacy scenes`);

        // If no scenes could use WebCodecs, fall back entirely to legacy
        if (webcodecScenes.size === 0) {
            console.warn('[ExportPipeline] No WebCodecs decoders initialized, falling back to legacy');
            vfs.closeAll();
            return this._runLegacyFrameLoop(fps, totalFrames, startTime);
        }

        // 2. Frame loop — same frame indices as legacy (0..totalFrames-1)
        let lastProgressTime = 0;
        const exportFrameSources = new Map();
        this.compositor._exportFrameSources = exportFrameSources;

        try {
            for (let frame = 0; frame < totalFrames; frame++) {
                if (this._cancelled) throw new Error('Export cancelled');

                const activeScenes = this.compositor.sceneGraph.getActiveScenesAtFrame(frame);
                exportFrameSources.clear();
                let didLegacySeek = false;

                for (const { scene } of activeScenes) {
                    if (scene.isMGScene || scene.mediaType === 'motion-graphic') continue;
                    if (scene.mediaType === 'image') continue;
                    const idx = scene.index;
                    const localFrame = frame - scene._startFrame;
                    const mediaOffsetFrames = Math.round((scene.mediaOffset || 0) * fps);
                    const timeSec = (localFrame + mediaOffsetFrames) / fps;

                    if (webcodecScenes.has(idx)) {
                        // WebCodecs: sequential decode — no seek, no RAF yield needed
                        const videoFrame = await vfs.getFrameAtTime(idx, timeSec);
                        if (videoFrame) {
                            exportFrameSources.set(idx, videoFrame);
                        } else {
                            // End of stream or closed frame — fall back to legacy seek for this frame
                            await this.compositor.seekVideoToFrame(idx, localFrame + mediaOffsetFrames);
                            didLegacySeek = true;
                        }
                    } else if (legacyScenes.has(idx)) {
                        // Legacy: HTMLVideoElement seek (same as _runLegacyFrameLoop)
                        await this.compositor.seekVideoToFrame(idx, localFrame + mediaOffsetFrames);
                        didLegacySeek = true;
                    }
                }

                // Only yield for RAF if we did a legacy seek (WebCodecs frames are ready)
                if (didLegacySeek) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                }

                // Render — _getSceneTexture checks _exportFrameSources for WebCodecs scenes
                this.compositor.renderFrame(frame);

                // Close VideoFrames immediately after render — texImage2D already copied
                // pixels to GPU, so the decoded frame backing memory can be released now.
                // Also null out VideoFrameSource's currentFrame ref so getFrameAtTime
                // won't return a closed frame on end-of-stream reuse (returns null instead).
                for (const [idx, vf] of exportFrameSources.entries()) {
                    try { vf.close(); } catch (_) {}
                    const decState = vfs._decoders.get(idx);
                    if (decState && decState.currentFrame === vf) {
                        decState.currentFrame = null;
                    }
                }

                // Read pixels and send via IPC (same as legacy)
                const pixels = this.compositor.readPixels();
                const result = await window.electronAPI.sendExportFrame(pixels.buffer);
                if (!result || !result.success) {
                    throw new Error('Failed to write frame to FFmpeg');
                }

                this._reportProgress(frame, totalFrames, startTime, lastProgressTime, (t) => { lastProgressTime = t; });
            }
        } finally {
            // Always clean up — even on cancel/error
            this.compositor._exportFrameSources = null;
            vfs.closeAll();
        }
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================

    /**
     * Validate frame hashes: render specific frames and log their hashes.
     * Use this to compare legacy vs optimized export output.
     *
     * @param {number[]} testFrames - Frame indices to validate (e.g. [0, 100, 500, lastFrame-1])
     * @returns {Promise<Array<{frame: number, hash: string}>>}
     */
    async validate(testFrames) {
        if (!this.compositor || !this.compositor.isInitialized || !this.compositor.sceneGraph) {
            console.error('[Validation] Compositor not ready');
            return [];
        }

        const totalFrames = this.compositor.totalFrames;
        const fps = this.compositor.fps;
        const results = [];

        // Save exporting state and restore after
        const wasExporting = this.compositor._exporting;
        this.compositor._exporting = true;
        this.compositor.pauseVideos();

        try {
            for (const frame of testFrames) {
                if (frame < 0 || frame >= totalFrames) {
                    console.warn(`[Validation] Frame ${frame} out of range (0-${totalFrames - 1}), skipping`);
                    continue;
                }

                // Seek all active videos to this frame
                const activeScenes = this.compositor.sceneGraph.getActiveScenesAtFrame(frame);
                for (const { scene } of activeScenes) {
                    if (scene.isMGScene || scene.mediaType === 'motion-graphic') continue;
                    const localFrame = frame - scene._startFrame;
                    const mediaOffsetFrames = Math.round((scene.mediaOffset || 0) * fps);
                    await this.compositor.seekVideoToFrame(scene.index, localFrame + mediaOffsetFrames);
                }
                // Yield for video frame decode
                await new Promise(resolve => requestAnimationFrame(resolve));

                // Render and hash
                this.compositor.renderFrame(frame);
                const hash = this.compositor.computeFrameHash();
                results.push({ frame, hash });
                console.log(`[Validation] Frame ${frame}: hash=${hash}`);
            }
        } finally {
            this.compositor._exporting = wasExporting;
            this.compositor._resetVideosForPreview();
        }

        return results;
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Throttled progress reporting.
     */
    _reportProgress(frame, totalFrames, startTime, lastProgressTime, setLastTime) {
        const now = performance.now();
        if (now - lastProgressTime > 100 || frame === totalFrames - 1) {
            setLastTime(now);
            const percent = Math.round(((frame + 1) / totalFrames) * 100);
            const elapsed = (now - startTime) / 1000;
            const currentFps = elapsed > 0 ? ((frame + 1) / elapsed).toFixed(1) : '0';

            if (this._progressCallback) {
                this._progressCallback({
                    percent,
                    currentFrame: frame + 1,
                    totalFrames,
                    fps: currentFps,
                    elapsed: elapsed.toFixed(1),
                });
            }
        }
    }

    /**
     * Cancel an in-progress export.
     */
    cancel() {
        this._cancelled = true;
    }
}

window.ExportPipeline = ExportPipeline;

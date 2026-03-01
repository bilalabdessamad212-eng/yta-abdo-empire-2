'use strict';

const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

// Version marker — if you see this in the log, the latest code is loaded
const RENDERER_VERSION = 'v4-2026-03-01';

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'C:\\ffmg\\bin\\ffmpeg.exe';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'C:\\ffmg\\bin\\ffprobe.exe';
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const PARALLEL_LIMIT = 2; // Keep at 2 to avoid NVENC session contention on consumer GPUs

// Fast + close quality defaults (override via env if needed)
const NVENC_PRESET_FAST = process.env.FFMPEG_NVENC_PRESET || 'p4';
const NVENC_PRESET_COMPAT = process.env.FFMPEG_NVENC_COMPAT_PRESET || 'medium';
const PREP_VIDEO_BITRATE = process.env.FFMPEG_PREP_BITRATE || '6M';
const FINAL_VIDEO_BITRATE = process.env.FFMPEG_FINAL_BITRATE || '18M';
const FINAL_VIDEO_MAXRATE = process.env.FFMPEG_FINAL_MAXRATE || '24M';
const FINAL_VIDEO_BUFSIZE = process.env.FFMPEG_FINAL_BUFSIZE || '48M';
const CPU_FALLBACK_CRF = process.env.FFMPEG_CPU_CRF || '26';

// ---------------------------------------------------------------------------
// TRANSITION MAP: App transition types → FFmpeg xfade names
// ---------------------------------------------------------------------------

const XFADE_MAP = {
    // Direct mappings
    'fade': 'fade',
    'dissolve': 'dissolve',
    'crossfade': 'dissolve',
    'wipe': 'wipeleft',
    'slide': 'slideleft',
    'slideLeft': 'slideleft',
    'slideRight': 'slideright',
    'push': 'slideleft',
    'swipe': 'slideright',
    'zoom': 'zoomin',
    'flash': 'fadewhite',
    'cameraFlash': 'fadewhite',
    'pixelate': 'pixelize',
    'mosaic': 'pixelize',
    'reveal': 'circlecrop',
    'ink': 'circlecrop',
    'vignetteBlink': 'fadeblack',
    // Fallback mappings
    'crossBlur': 'dissolve',
    'blur': 'dissolve',
    'luma': 'wipeleft',
    'ripple': 'dissolve',
    'filmBurn': 'fadewhite',
    'morph': 'dissolve',
    'dreamFade': 'dissolve',
    'whip': 'smoothleft',
    'bounce': 'zoomin',
    'shutterSlice': 'wipeup',
    'zoomBlur': 'dissolve',
    'splitWipe': 'wipeup',
    'directionalBlur': 'dissolve',
    'colorFade': 'fadeblack',
    'spin': 'dissolve',
    'flare': 'fadewhite',
    'lightLeak': 'fadewhite',
    'filmGrain': 'fade',
    'shadowWipe': 'wipeleft',
    'prismShift': 'dissolve',
    'glitch': 'pixelize',
    'dataMosh': 'pixelize',
    'scanline': 'fade',
    'rgbSplit': 'fade',
    'static': 'pixelize',
    'tvStatic': 'pixelize',
};

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------

function log(msg) { console.log(`  [FFmpeg] ${msg}`); }
function logError(msg) { console.error(`  [FFmpeg] ❌ ${msg}`); }

// Timing helper
function timer(label) {
    const start = Date.now();
    return () => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(`⏱ ${label}: ${elapsed}s`);
        return parseFloat(elapsed);
    };
}

/**
 * Get scene duration in SECONDS.
 * scene.duration may be in frames (e.g., 553 for a 18.4s scene at 30fps).
 * endTime - startTime is always in seconds and is the reliable source.
 */
function getSceneDurationSec(scene, fps) {
    if (scene.endTime != null && scene.startTime != null && scene.endTime > scene.startTime) {
        return scene.endTime - scene.startTime;
    }
    // Fallback: if duration > totalDuration or seems like frames, convert
    const d = scene.duration || 0;
    if (d > 100) return d / (fps || 30); // likely frames
    return d;
}

// Cache NVENC probe result
let _nvencAvailable = null;

async function probeNvenc() {
    if (_nvencAvailable !== null) return _nvencAvailable;
    try {
        await new Promise((resolve, reject) => {
            const args = [
                '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
                '-c:v', 'h264_nvenc', '-preset', 'p4',
                '-f', 'null', '-'
            ];
            execFile(FFMPEG_PATH, args, { timeout: 10000 }, (err) => {
                if (err) reject(err); else resolve();
            });
        });
        _nvencAvailable = true;
        log('✓ NVENC GPU encoder available');
    } catch {
        _nvencAvailable = false;
        log('✗ NVENC not available — will use CPU (libx264)');
    }
    return _nvencAvailable;
}

function errorText(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.stack || err.message || String(err);
    try { return JSON.stringify(err); } catch { return String(err); }
}

async function parallelWithLimit(tasks, limit) {
    const results = [];
    let i = 0;
    async function next() {
        const idx = i++;
        if (idx >= tasks.length) return;
        results[idx] = await tasks[idx]();
        await next();
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => next()));
    return results;
}

function probeMedia(filePath) {
    return new Promise((resolve, reject) => {
        execFile(FFPROBE_PATH, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,duration,codec_name',
            '-show_entries', 'format=duration',
            '-of', 'json',
            filePath
        ], { timeout: 15000 }, (err, stdout) => {
            if (err) return reject(err);
            try {
                const data = JSON.parse(stdout);
                const stream = data.streams?.[0] || {};
                // CRITICAL: prefer format.duration over stream.duration.
                // stream.duration can report source duration for tpad/trimmed clips, not output duration.
                const dur = parseFloat(data.format?.duration) || parseFloat(stream.duration) || 0;
                resolve({ width: stream.width || 0, height: stream.height || 0, duration: dur, codec: stream.codec_name });
            } catch (e) { reject(e); }
        });
    });
}

// Track ALL active FFmpeg processes for cancellation (parallel prep spawns multiple)
const _activeProcesses = new Set();
let _cancelled = false;

function cancelRender() {
    _cancelled = true;
    log(`Cancelling render — killing ${_activeProcesses.size} active FFmpeg process(es)...`);
    for (const proc of _activeProcesses) {
        try {
            // On Windows, kill the entire process tree
            if (process.platform === 'win32' && proc.pid) {
                require('child_process').exec(`taskkill /pid ${proc.pid} /f /t`, () => {});
            } else {
                proc.kill('SIGTERM');
            }
        } catch (e) { /* ignore */ }
    }
    _activeProcesses.clear();
}

function runFFmpeg(args, onProgress, totalDuration, timeoutMs) {
    return new Promise((resolve, reject) => {
        if (_cancelled) return reject(new Error('Cancelled'));
        const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        _activeProcesses.add(proc);
        let stderr = '';
        let settled = false;
        let lastProgressTime = Date.now();
        const startTime = Date.now();

        const killProc = () => {
            try {
                if (process.platform === 'win32' && proc.pid) {
                    require('child_process').exec(`taskkill /pid ${proc.pid} /f /t`, () => {});
                } else {
                    proc.kill('SIGTERM');
                }
            } catch (e) { /* ignore */ }
        };

        const settle = (fn) => { if (!settled) { settled = true; clearInterval(watchdog); _activeProcesses.delete(proc); fn(); } };

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            lastProgressTime = Date.now();
            if (onProgress && totalDuration) {
                const m = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
                if (m) {
                    const rawSecs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
                    const secs = Math.min(rawSecs, totalDuration);
                    const pct = Math.min(99, Math.round((secs / totalDuration) * 100));
                    onProgress(pct, secs);
                }
            }
        });

        // Watchdog: silence detection + hard timeout
        const watchdog = setInterval(() => {
            const silentMs = Date.now() - lastProgressTime;
            const totalMs = Date.now() - startTime;
            // Kill if silent for 30s
            if (silentMs > 30000 && !settled) {
                log('FFmpeg silent for 30s, killing process...');
                killProc();
            }
            // Hard timeout — kill if scene takes way too long
            if (timeoutMs && totalMs > timeoutMs && !settled) {
                log(`FFmpeg hard timeout (${Math.round(totalMs / 1000)}s > ${Math.round(timeoutMs / 1000)}s limit), killing...`);
                killProc();
            }
        }, 5000);

        proc.on('close', (code) => {
            settle(() => {
                if (_cancelled) reject(new Error('Cancelled'));
                else if (code === 0 || code === null) resolve(stderr);
                else reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-1000)}`));
            });
        });
        proc.on('error', (err) => { settle(() => reject(err)); });
    });
}

// ---------------------------------------------------------------------------
// PASS 1: SCENE PREPARATION
// ---------------------------------------------------------------------------

async function prepareScene(scene, publicDir, prepDir, fps) {
    const outFile = path.join(prepDir, `prep-${scene.index}.mp4`);
    if (fs.existsSync(outFile)) return outFile;

    const mediaPath = resolveMediaPath(scene.mediaFile, publicDir);
    if (!mediaPath || !fs.existsSync(mediaPath)) {
        log(`Scene ${scene.index}: no media, generating black clip`);
        return generateBlackClip(outFile, scene.duration, fps);
    }

    if (scene.mediaType === 'image') {
        return prepareImageScene(mediaPath, outFile, scene, fps);
    }
    return prepareVideoScene(mediaPath, outFile, scene, fps);
}

function resolveMediaPath(mediaFile, publicDir) {
    if (!mediaFile) return null;
    if (fs.existsSync(mediaFile)) return mediaFile;
    // Try in public dir
    const basename = path.basename(mediaFile);
    const inPublic = path.join(publicDir, basename);
    if (fs.existsSync(inPublic)) return inPublic;
    return null;
}

async function generateBlackClip(outFile, duration, fps) {
    const useGpu = _nvencAvailable;
    const encArgs = useGpu
        ? ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET_FAST, '-b:v', PREP_VIDEO_BITRATE]
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CPU_FALLBACK_CRF];
    await runFFmpeg([
        '-f', 'lavfi', '-i', `color=c=black:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:r=${fps}:d=${duration}`,
        ...encArgs, '-pix_fmt', 'yuv420p', '-an', '-y', outFile
    ]);
    return outFile;
}

async function prepareVideoScene(mediaPath, outFile, scene, fps) {
    const duration = getSceneDurationSec(scene, fps);
    const offset = scene.mediaOffset || 0;
    const scale = scene.scale || 1;
    const posX = scene.posX || 0;
    const posY = scene.posY || 0;
    const fitMode = scene.fitMode || 'cover';

    // Build video filter
    let vf = [];

    // Fit mode: cover (fill frame, crop excess) or contain (fit inside, pad black)
    if (fitMode === 'cover') {
        vf.push(`scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`);
        vf.push(`crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`);
    } else {
        vf.push(`scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease`);
        vf.push(`pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`);
    }

    // Apply scale/position transforms if non-default
    if (scale !== 1 || posX !== 0 || posY !== 0) {
        const sw = Math.round(OUTPUT_WIDTH * scale);
        const sh = Math.round(OUTPUT_HEIGHT * scale);
        const ox = Math.round(OUTPUT_WIDTH / 2 + (posX / 100) * OUTPUT_WIDTH - sw / 2);
        const oy = Math.round(OUTPUT_HEIGHT / 2 + (posY / 100) * OUTPUT_HEIGHT - sh / 2);
        // Scale content, then place on black canvas
        vf = [
            vf.join(','),  // first normalize to 1920x1080
            `scale=${sw}:${sh}`,
            `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:${Math.max(0, -ox)}:${Math.max(0, -oy)}:black`,
            `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:${Math.max(0, ox)}:${Math.max(0, oy)}`
        ];
    }

    // Set FPS and reset timestamps
    vf.push(`fps=${fps}`);
    // tpad freezes the last frame if source is shorter than needed.
    // Use a fixed frame count (not stop=-1 which creates infinite stream and corrupts duration metadata).
    const padFrames = Math.ceil(duration * fps) + fps; // pad up to 1 extra second of frames
    vf.push(`tpad=stop_mode=clone:stop=${padFrames}`);
    vf.push(`setpts=PTS-STARTPTS`);

    const useGpu = _nvencAvailable;
    const encArgs = useGpu
        ? ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET_FAST, '-b:v', PREP_VIDEO_BITRATE]
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CPU_FALLBACK_CRF];

    const args = [
        ...(offset > 0 ? ['-ss', String(offset)] : []),
        '-i', mediaPath,
        '-t', String(duration),
        '-vf', vf.join(','),
        ...encArgs,
        '-pix_fmt', 'yuv420p',
        '-an', '-y', outFile
    ];

    // Timeout: max 90s or 15x the scene duration — whichever is larger.
    // If a scene takes longer than this, something is wrong — kill it and use black fallback.
    const timeoutMs = Math.max(90000, Math.round(duration * 15 * 1000));
    await runFFmpeg(args, null, null, timeoutMs);

    // Verify the prepared clip has correct duration
    try {
        const info = await probeMedia(outFile);
        if (info.duration > 0 && Math.abs(info.duration - duration) > 0.5) {
            log(`⚠ Scene ${scene.index}: expected ${duration.toFixed(2)}s, got ${info.duration.toFixed(2)}s`);
        }
    } catch (e) { /* ignore probe errors */ }

    return outFile;
}

async function prepareImageScene(mediaPath, outFile, scene, fps) {
    const duration = getSceneDurationSec(scene, fps);
    const fitMode = scene.fitMode || 'cover';

    // Static image → video: scale to 1920x1080, encode just enough frames.
    // No zoompan/crop-pan (both are CPU-intensive and extremely slow).
    // Ken Burns effect is subtle and not worth the 10-100x slowdown for prep.
    let vf;
    if (fitMode === 'cover') {
        vf = `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`;
    } else {
        vf = `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
    }

    vf += `,fps=${fps},setpts=PTS-STARTPTS`;

    const useGpu = _nvencAvailable;
    const encArgs = useGpu
        ? ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET_FAST, '-b:v', PREP_VIDEO_BITRATE]
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CPU_FALLBACK_CRF];

    // Timeout: 60s or 10x duration — images should be fast (no decoding overhead)
    const timeoutMs = Math.max(60000, Math.round(duration * 10 * 1000));
    await runFFmpeg([
        '-loop', '1', '-i', mediaPath,
        '-t', String(duration),
        '-vf', vf,
        ...encArgs,
        '-pix_fmt', 'yuv420p',
        '-an', '-y', outFile
    ], null, null, timeoutMs);
    return outFile;
}

// ---------------------------------------------------------------------------
// MG PRE-RENDERING — Canvas (fast) + Remotion fallback (complex types)
// ---------------------------------------------------------------------------

/**
 * Pre-render all MGs as individual WebM clips.
 *
 * Uses @napi-rs/canvas for 14 common MG types (~200fps, no browser).
 * Falls back to Remotion batch render for complex types (mapChart, articleHighlight, animatedIcons).
 * If @napi-rs/canvas is not installed, uses Remotion for everything.
 */
async function preRenderMGs(plan, publicDir, prepDir, progressCallback) {
    const mgClipDir = path.join(prepDir, 'mg-clips');
    if (!fs.existsSync(mgClipDir)) fs.mkdirSync(mgClipDir, { recursive: true });

    const overlayMGs = plan.motionGraphics || [];
    const scriptContext = plan.scriptContext || {};
    const fps = plan.fps || 30;

    // Collect full-screen MG scenes
    const normalizeMgScene = (scene) => {
        const startT = Number(scene?.startTime) || 0;
        let endT = Number(scene?.endTime);
        let dur = Number(scene?.duration);
        if (Number.isFinite(dur) && dur > 1000) dur = dur / 1000;
        if (!Number.isFinite(endT) || endT <= startT) {
            endT = startT + (Number.isFinite(dur) && dur > 0 ? dur : 3);
        }
        return { ...scene, isMGScene: true, startTime: startT, endTime: endT, duration: Math.max(0.1, endT - startT) };
    };

    const mgSceneCandidates = [
        ...((plan.mgScenes || []).map(normalizeMgScene)),
        ...((plan.scenes || []).filter(s => s.isMGScene && !s.disabled).map(normalizeMgScene)),
    ];
    const seenMg = new Set();
    const fullscreenMGs = mgSceneCandidates
        .filter(s => !s.disabled && s.endTime > s.startTime)
        .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
        .filter((s) => {
            const key = `${s.type || 'mg'}|${(s.startTime || 0).toFixed(3)}|${(s.endTime || 0).toFixed(3)}|${s.text || s.headline || ''}`;
            if (seenMg.has(key)) return false;
            seenMg.add(key);
            return true;
        });

    const totalMGs = overlayMGs.length + fullscreenMGs.length;
    if (totalMGs === 0) {
        log('No MGs to pre-render');
        return mgClipDir;
    }

    // Try loading canvas renderer
    let canvasRenderer = null;
    try {
        canvasRenderer = require('./canvas-mg-renderer');
    } catch (e) {
        log(`Canvas MG renderer not available (${e.message}), using Remotion for all MGs`);
    }

    // Partition MGs into canvas-renderable vs Remotion-only
    const canvasMGs = [];
    const remotionOverlayMGs = [];
    const remotionFullscreenMGs = [];

    for (let i = 0; i < overlayMGs.length; i++) {
        const mg = overlayMGs[i];
        const mgData = {
            type: mg.type, text: mg.text || '', subtext: mg.subtext || '',
            style: mg.style || plan.mgStyle || 'clean',
            position: mg.position || 'bottom-left',
            duration: mg.duration || 3, startTime: 0,
            ...(mg.mgData || {}),
        };
        if (canvasRenderer && canvasRenderer.canRenderWithCanvas(mg.type)) {
            canvasMGs.push({ mg: mgData, isFullScreen: false, originalIndex: i, category: 'overlay' });
        } else {
            remotionOverlayMGs.push({ mg: mgData, originalIndex: i });
        }
    }

    for (let i = 0; i < fullscreenMGs.length; i++) {
        const scene = fullscreenMGs[i];
        const mgData = {
            type: scene.type, text: scene.text || '', subtext: scene.subtext || '',
            style: scene.style || plan.mgStyle || 'clean',
            position: 'center', duration: scene.duration || 3, startTime: 0,
            ...(scene.mgData || {}),
        };
        if (mgData.type === 'mapChart') {
            mgData.mapStyle = scene.mapStyle || (scene.mgData && scene.mgData.mapStyle) || plan.mapStyle || 'dark';
        }
        if (canvasRenderer && canvasRenderer.canRenderWithCanvas(scene.type)) {
            canvasMGs.push({ mg: mgData, isFullScreen: true, originalIndex: i, category: 'fullscreen' });
        } else {
            remotionFullscreenMGs.push({ mg: mgData, originalIndex: i, scene });
        }
    }

    log(`MG rendering: ${canvasMGs.length} via Canvas, ${remotionOverlayMGs.length + remotionFullscreenMGs.length} via Remotion`);

    // ---- Phase 1: Canvas render (fast) ----
    if (canvasMGs.length > 0) {
        const canvasTimer = timer('Canvas MG render');
        progressCallback({ percent: 26, message: `Canvas-rendering ${canvasMGs.length} MGs...` });

        await canvasRenderer.renderAll(canvasMGs, mgClipDir, fps, scriptContext, (pct) => {
            const p = 26 + Math.round(pct * 6);
            progressCallback({ percent: Math.min(32, p), message: `Canvas MGs: ${Math.round(pct * 100)}%` });
        });

        canvasTimer();
    }

    // ---- Phase 2: Remotion fallback for complex types ----
    const remotionTotal = remotionOverlayMGs.length + remotionFullscreenMGs.length;
    if (remotionTotal > 0) {
        log(`Remotion-rendering ${remotionTotal} complex MGs (${[...remotionOverlayMGs, ...remotionFullscreenMGs].map(m => m.mg.type).join(', ')})`);

        let bundle, renderMedia, selectComposition;
        try {
            const bundler = require('@remotion/bundler');
            const renderer = require('@remotion/renderer');
            bundle = bundler.bundle;
            renderMedia = renderer.renderMedia;
            selectComposition = renderer.selectComposition;
        } catch (e) {
            logError(`Remotion renderer not available: ${e.message}`);
            return mgClipDir;
        }

        const appRoot = path.resolve(__dirname, '..');
        const rootFile = path.join(appRoot, 'src', 'remotion', 'Root.jsx');

        // Windows: find Remotion binaries
        let binariesDirectory = null;
        if (process.platform === 'win32') {
            const remotionBinRoot = path.join(appRoot, 'temp', 'remotion-binaries');
            if (fs.existsSync(remotionBinRoot)) {
                if (fs.existsSync(path.join(remotionBinRoot, 'remotion.exe'))) {
                    binariesDirectory = remotionBinRoot;
                } else {
                    const subdirs = fs.readdirSync(remotionBinRoot).filter(d => {
                        try { return fs.statSync(path.join(remotionBinRoot, d)).isDirectory(); } catch { return false; }
                    });
                    for (const sd of subdirs) {
                        const candidate = path.join(remotionBinRoot, sd);
                        if (fs.existsSync(path.join(candidate, 'remotion.exe'))) {
                            binariesDirectory = candidate;
                            break;
                        }
                    }
                }
                if (binariesDirectory) log(`Using Remotion binaries: ${binariesDirectory}`);
            }
        }

        let bundleLocation;
        try {
            const bundleTimer = timer('MG Remotion bundle');
            progressCallback({ percent: 33, message: 'Bundling Remotion for complex MGs...' });
            bundleLocation = await bundle({ entryPoint: rootFile, publicDir });
            bundleTimer();
        } catch (e) {
            logError(`Remotion bundle failed: ${e.message}`);
            return mgClipDir;
        }

        // Build batch items for Remotion-only MGs
        const batchItems = [];
        const mgManifest = [];
        let offsetFrames = 0;

        for (const entry of remotionOverlayMGs) {
            const dur = entry.mg.duration || 3;
            const durFrames = Math.max(1, Math.round(dur * fps));
            batchItems.push({ mg: entry.mg, isFullScreen: false, offsetFrames, durationFrames: durFrames });
            mgManifest.push({ type: 'overlay', index: entry.originalIndex, batchStartSec: offsetFrames / fps, durationSec: dur });
            offsetFrames += durFrames;
        }
        for (const entry of remotionFullscreenMGs) {
            const dur = entry.mg.duration || 3;
            const durFrames = Math.max(1, Math.round(dur * fps));
            batchItems.push({ mg: entry.mg, isFullScreen: true, offsetFrames, durationFrames: durFrames });
            mgManifest.push({ type: 'fullscreen', index: entry.originalIndex, batchStartSec: offsetFrames / fps, durationSec: dur });
            offsetFrames += durFrames;
        }

        const totalBatchDuration = offsetFrames / fps;
        const batchFile = path.join(mgClipDir, 'mg-batch.webm');

        try {
            const mgRenderTimer = timer('MG Remotion renderMedia');
            progressCallback({ percent: 34, message: 'Rendering complex MGs via Remotion...' });

            const composition = await selectComposition({
                serveUrl: bundleLocation, id: 'MGBatch',
                inputProps: { items: batchItems, scriptContext, totalDuration: totalBatchDuration },
                ...(binariesDirectory ? { binariesDirectory } : {}),
            });

            await renderMedia({
                composition, serveUrl: bundleLocation, codec: 'vp8',
                outputLocation: batchFile, chromiumOptions: { gl: 'angle' },
                concurrency: 6,
                ...(binariesDirectory ? { binariesDirectory } : {}),
                onProgress: ({ progress }) => {
                    progressCallback({ percent: 34 + Math.round(progress * 5), message: `Remotion MGs: ${Math.round(progress * 100)}%` });
                },
            });
            mgRenderTimer();

            // Split batch into individual clips
            for (const item of mgManifest) {
                const outFile = path.join(mgClipDir, `mg-${item.type}-${item.index}.webm`);
                try {
                    await new Promise((resolve, reject) => {
                        execFile(FFMPEG_PATH, [
                            '-y', '-i', batchFile,
                            '-ss', item.batchStartSec.toFixed(3),
                            '-t', item.durationSec.toFixed(3),
                            '-c:v', 'copy', '-an', outFile
                        ], { timeout: 30000 }, (err) => { if (err) reject(err); else resolve(); });
                    });
                } catch (e) {
                    logError(`Split Remotion MG ${item.type}-${item.index} failed: ${e.message}`);
                }
            }
        } catch (e) {
            logError(`Remotion batch render failed: ${e.message}`);
        }
    }

    progressCallback({ percent: 40, message: 'MG rendering complete' });
    return mgClipDir;
}

// ---------------------------------------------------------------------------
// PASS 2: FILTER GRAPH BUILDER
// ---------------------------------------------------------------------------

async function buildFilterGraph(plan, prepDir, overlayPrepDir, publicDir) {
    const fps = plan.fps || 30;
    const track1Scenes = getTrackScenes(plan, 'video-track-1');
    const track2Scenes = getTrackScenes(plan, 'video-track-2');
    const track3Scenes = getTrackScenes(plan, 'video-track-3');

    // Map transitions by fromSceneIndex
    const transMap = {};
    (plan.transitions || []).forEach(t => { transMap[t.fromSceneIndex] = t; });

    const inputs = [];     // -i arguments
    const filters = [];    // filter_complex lines
    let labelCounter = 0;
    const nextLabel = (prefix) => `${prefix}${labelCounter++}`;

    // -----------------------------------------------------------------------
    // Section A: Build full-duration timeline base
    // Track-1 has gaps where track-2/3 scenes take over. We fill gaps with
    // black clips so the base video spans the entire duration.
    // -----------------------------------------------------------------------
    const totalDur = plan.totalDuration || 90;
    const timelineSegments = []; // ordered list of scenes + gap fillers

    // Detect gaps and insert black fillers
    let cursor = track1Scenes.length > 0 ? (track1Scenes[0].startTime || 0) : 0;

    // Add initial gap if first scene doesn't start at 0
    if (cursor > 0.1) {
        timelineSegments.push({ type: 'gap', duration: cursor });
        log(`Gap: 0.00-${cursor.toFixed(2)} (${cursor.toFixed(2)}s) — black filler`);
    }

    for (let i = 0; i < track1Scenes.length; i++) {
        const scene = track1Scenes[i];
        const sceneStart = scene.startTime || 0;
        const sceneEnd = scene.endTime || (sceneStart + scene.duration);

        // Gap before this scene?
        if (sceneStart - cursor > 0.1) {
            const gapDur = sceneStart - cursor;
            timelineSegments.push({ type: 'gap', duration: gapDur });
            log(`Gap: ${cursor.toFixed(2)}-${sceneStart.toFixed(2)} (${gapDur.toFixed(2)}s) — black filler`);
        }

        timelineSegments.push({ type: 'scene', scene });
        cursor = sceneEnd;
    }

    // Trailing gap to reach total duration
    if (totalDur - cursor > 0.1) {
        const gapDur = totalDur - cursor;
        timelineSegments.push({ type: 'gap', duration: gapDur });
        log(`Gap: ${cursor.toFixed(2)}-${totalDur.toFixed(2)} (${gapDur.toFixed(2)}s) — black filler`);
    }

    // Build inputs for each segment — generate real .mp4 files for gaps
    // (lavfi color= sources have different pixel format and break xfade)
    const t1Prepared = [];
    let gapCounter = 0;
    for (const seg of timelineSegments) {
        if (seg.type === 'scene') {
            const scene = seg.scene;
            const prepFile = path.join(prepDir, `prep-${scene.index}.mp4`);
            if (!fs.existsSync(prepFile)) {
                log(`⚠ Scene ${scene.index}: prep missing, generating black`);
                await generateBlackClip(prepFile, scene.duration, fps);
            }

            const inputIdx = inputs.length;
            inputs.push(prepFile);

            let actualDuration = scene.duration;
            try {
                const info = await probeMedia(prepFile);
                if (info.duration > 0) {
                    // Safety: if probed duration is >2x expected, something is wrong — use planned duration
                    if (info.duration > scene.duration * 2) {
                        log(`⚠ Scene ${scene.index}: probed ${info.duration.toFixed(2)}s >> expected ${scene.duration.toFixed(2)}s — using planned duration`);
                    } else {
                        actualDuration = info.duration;
                        if (Math.abs(actualDuration - scene.duration) > 0.5) {
                            log(`Scene ${scene.index}: plan=${scene.duration.toFixed(2)}s actual=${actualDuration.toFixed(2)}s`);
                        }
                    }
                }
            } catch (e) { /* fallback to scene.duration */ }

            t1Prepared.push({ scene, inputIdx, label: `${inputIdx}:v`, actualDuration });
        } else {
            // Black gap filler — generate a real .mp4 file (same format as prep clips)
            const gapFile = path.join(prepDir, `gap-${gapCounter++}.mp4`);
            await generateBlackClip(gapFile, seg.duration, fps);

            const inputIdx = inputs.length;
            inputs.push(gapFile);

            let actualDuration = seg.duration;
            try {
                const info = await probeMedia(gapFile);
                if (info.duration > 0) actualDuration = info.duration;
            } catch (e) { /* use planned duration */ }

            t1Prepared.push({ scene: null, inputIdx, label: `${inputIdx}:v`, actualDuration, isGap: true });
        }
    }

    // Chain all segments with xfade
    let baseLabel = null;
    if (t1Prepared.length === 0) {
        // Generate a black clip file for the full duration
        const fullBlack = path.join(prepDir, `gap-full.mp4`);
        await generateBlackClip(fullBlack, totalDur, fps);
        const blackInput = inputs.length;
        inputs.push(fullBlack);
        baseLabel = `[${blackInput}:v]`;
    } else if (t1Prepared.length === 1) {
        baseLabel = `[${t1Prepared[0].label}]`;
    } else {
        let prevLabel = `[${t1Prepared[0].label}]`;
        let runningOffset = t1Prepared[0].actualDuration;

        for (let i = 1; i < t1Prepared.length; i++) {
            const curr = t1Prepared[i];
            const prev = t1Prepared[i - 1];
            const outLabel = nextLabel('x');

            // Only use real transitions between two actual scenes (not gaps)
            const trans = (prev.scene && !prev.isGap) ? transMap[prev.scene.index] : null;

            if (trans && trans.type !== 'cut' && trans.duration > 0 && !curr.isGap) {
                const xfadeType = XFADE_MAP[trans.type] || 'fade';
                const transDur = Math.min(trans.duration / 1000, runningOffset * 0.8);
                const offset = Math.max(0, runningOffset - transDur);
                filters.push(
                    `${prevLabel}[${curr.label}]xfade=transition=${xfadeType}:duration=${transDur.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`
                );
                runningOffset = offset + curr.actualDuration;
            } else {
                // Cut / gap boundary — instant fade
                const cutDur = 0.04;
                const offset = Math.max(0, runningOffset - cutDur);
                filters.push(
                    `${prevLabel}[${curr.label}]xfade=transition=fade:duration=${cutDur}:offset=${offset.toFixed(3)}[${outLabel}]`
                );
                runningOffset = offset + curr.actualDuration;
            }
            prevLabel = `[${outLabel}]`;
        }
        baseLabel = prevLabel;

        log(`Track-1 timeline: ${t1Prepared.length} segments (${track1Scenes.length} scenes + ${t1Prepared.length - track1Scenes.length} gaps), total ${runningOffset.toFixed(2)}s`);
    }

    // -----------------------------------------------------------------------
    // Section B: Track-2 and Track-3 overlays
    // -----------------------------------------------------------------------
    for (const trackScenes of [track2Scenes, track3Scenes]) {
        for (const scene of trackScenes) {
            const prepFile = path.join(prepDir, `prep-${scene.index}.mp4`);
            if (!fs.existsSync(prepFile)) continue;

            const inputIdx = inputs.length;
            inputs.push(prepFile);

            const startT = scene.startTime || 0;
            const endT = scene.endTime || (startT + scene.duration);

            // Delay the overlay stream to start at the scene's startTime
            // setpts shifts the overlay's PTS so it appears at the right time
            const delayedLabel = nextLabel('d');
            filters.push(
                `[${inputIdx}:v]setpts=PTS+${startT.toFixed(3)}/TB[${delayedLabel}]`
            );

            const outLabel = nextLabel('t');
            filters.push(
                `${baseLabel}[${delayedLabel}]overlay=0:0:eof_action=pass:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})'[${outLabel}]`
            );
            baseLabel = `[${outLabel}]`;
        }
    }

    // -----------------------------------------------------------------------
    // Section C: Overlay videos (grain, dust, lightLeak) — DISABLED until rebuild
    // (preview doesn't render these, so applying them causes visual mismatch)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Section D: Code-generated VFX — DISABLED until rebuild
    // (vignette, letterbox, colorTint, chromatic — preview doesn't render
    //  these, so applying them here causes visual mismatch)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Section E: Motion Graphics (canvas-rendered FFV1 MKV clips with alpha)
    // -----------------------------------------------------------------------
    // Individual MG clips: mg-overlay-N.mkv (canvas FFV1) or mg-overlay-N.webm (Remotion VP8 fallback)
    // FFV1 yuva444p has guaranteed alpha — overlay filter (format=auto) handles transparency.
    const mgClipDir = overlayPrepDir;
    const mgs = plan.motionGraphics || [];
    if (mgClipDir && mgs.length > 0) {
        log(`Overlaying ${mgs.length} MG clips in filter graph`);
        let overlayIdx = 0;
        for (const mg of mgs) {
            // Try .mkv first (canvas FFV1), fall back to .webm (Remotion VP8)
            let clipFile = path.join(mgClipDir, `mg-overlay-${overlayIdx}.mkv`);
            if (!fs.existsSync(clipFile)) clipFile = path.join(mgClipDir, `mg-overlay-${overlayIdx}.webm`);
            overlayIdx++;
            if (!fs.existsSync(clipFile)) continue;

            const startT = mg.startTime || 0;
            const dur = mg.duration || 3;
            const endT = startT + dur;

            const inputIdx = inputs.length;
            inputs.push(clipFile);

            // Delay the MG clip to its position on the main timeline
            const delayedLabel = nextLabel('mgd');
            filters.push(
                `[${inputIdx}:v]setpts=PTS+${startT.toFixed(3)}/TB[${delayedLabel}]`
            );

            const outLabel = nextLabel('mgo');
            filters.push(
                `${baseLabel}[${delayedLabel}]overlay=0:0:format=auto:eof_action=pass:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})'[${outLabel}]`
            );
            baseLabel = `[${outLabel}]`;
        }
    }

    // Full-screen MG scenes
    if (mgClipDir) {
        const normalizeMgScene = (scene) => {
            const startT = Number(scene?.startTime) || 0;
            let endT = Number(scene?.endTime);
            let dur = Number(scene?.duration);
            if (Number.isFinite(dur) && dur > 1000) dur = dur / 1000;
            if (!Number.isFinite(endT) || endT <= startT) {
                endT = startT + (Number.isFinite(dur) && dur > 0 ? dur : 3);
            }
            return { ...scene, isMGScene: true, startTime: startT, endTime: endT, duration: Math.max(0.1, endT - startT) };
        };

        const mgSceneCandidates = [
            ...((plan.mgScenes || []).map(normalizeMgScene)),
            ...((plan.scenes || []).filter(s => s.isMGScene && !s.disabled).map(normalizeMgScene)),
        ];
        const seenMg = new Set();
        const mgScenes = mgSceneCandidates
            .filter(s => !s.disabled && s.endTime > s.startTime)
            .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
            .filter((s) => {
                const key = `${s.type || 'mg'}|${(s.startTime || 0).toFixed(3)}|${(s.endTime || 0).toFixed(3)}|${s.text || s.headline || ''}`;
                if (seenMg.has(key)) return false;
                seenMg.add(key);
                return true;
            });

        if (mgScenes.length > 0) {
            log(`Overlaying ${mgScenes.length} fullscreen MG clips in filter graph`);
            let fsIdx = 0;
            for (const scene of mgScenes) {
                // Try .mkv first (canvas FFV1), fall back to .webm (Remotion VP8)
                let clipFile = path.join(mgClipDir, `mg-fullscreen-${fsIdx}.mkv`);
                if (!fs.existsSync(clipFile)) clipFile = path.join(mgClipDir, `mg-fullscreen-${fsIdx}.webm`);
                fsIdx++;
                if (!fs.existsSync(clipFile)) continue;

                const startT = scene.startTime || 0;
                const dur = scene.duration || 3;
                const endT = scene.endTime || (startT + dur);

                const inputIdx = inputs.length;
                inputs.push(clipFile);

                const delayedLabel = nextLabel('mgd');
                filters.push(
                    `[${inputIdx}:v]setpts=PTS+${startT.toFixed(3)}/TB[${delayedLabel}]`
                );

                const outLabel = nextLabel('mgo');
                filters.push(
                    `${baseLabel}[${delayedLabel}]overlay=0:0:format=auto:eof_action=pass:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})'[${outLabel}]`
                );
                baseLabel = `[${outLabel}]`;
            }
        }
    }

    // Final output normalization for encoder compatibility:
    // - enforce constant FPS
    // - force yuv420p (widely supported by h264_nvenc + libx264)
    // - ensure even dimensions
    // - normalize SAR
    const videoOutLabel = nextLabel('vout');
    filters.push(
        `${baseLabel}fps=${fps},format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[${videoOutLabel}]`
    );

    return { inputs, filters, videoOutLabel, fps };
}

function getTrackScenes(plan, trackId) {
    return (plan.scenes || [])
        .filter(s => s.trackId === trackId && !s.disabled && !s.isMGScene)
        .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
}

// ---------------------------------------------------------------------------
// AUDIO MIXING
// ---------------------------------------------------------------------------

function buildAudioMix(plan, publicDir, inputs) {
    const audioFilters = [];
    const audioInputs = [];
    let audioStreams = [];

    // Voice-over
    const audioFile = resolveMediaPath(plan.audio, publicDir);
    if (audioFile && fs.existsSync(audioFile)) {
        const audioIdx = inputs.length;
        inputs.push(audioFile);
        const isMuted = plan.mutedTracks?.['audio-track'];
        if (!isMuted) {
            audioStreams.push(`[${audioIdx}:a]`);
        }
    }

    // SFX clips
    if (plan.sfxEnabled !== false && !plan.mutedTracks?.['sfx-track'] && plan.sfxClips?.length) {
        const sfxVolume = plan.sfxVolume || 0.35;

        for (const sfx of plan.sfxClips) {
            const sfxPath = findSfxFile(sfx.file, publicDir);
            if (!sfxPath) continue;

            const sfxIdx = inputs.length;
            inputs.push(sfxPath);
            const sfxLabel = `sfx${sfxIdx}`;
            const delayMs = Math.max(0, Math.round((sfx.startTime || 0) * 1000));
            const vol = (sfx.volume || sfxVolume).toFixed(2);

            audioFilters.push(
                `[${sfxIdx}:a]adelay=${delayMs}|${delayMs},volume=${vol}[${sfxLabel}]`
            );
            audioStreams.push(`[${sfxLabel}]`);
        }
    }

    if (audioStreams.length === 0) {
        return { audioFilters: [], audioOutLabel: null };
    }

    // Mix all audio streams
    const audioOutLabel = 'aout';
    if (audioStreams.length === 1) {
        audioFilters.push(`${audioStreams[0]}acopy[${audioOutLabel}]`);
    } else {
        audioFilters.push(
            `${audioStreams.join('')}amix=inputs=${audioStreams.length}:duration=first:dropout_transition=0:normalize=0[${audioOutLabel}]`
        );
    }

    return { audioFilters, audioOutLabel };
}

function findSfxFile(filename, publicDir) {
    if (!filename) return null;
    // Check public dir
    const inPublic = path.join(publicDir, filename);
    if (fs.existsSync(inPublic)) return inPublic;
    // Check assets/sfx
    const assetsDir = path.join(path.dirname(publicDir), 'assets', 'sfx');
    // Try project root assets
    const appRoot = path.dirname(require.main?.filename || __dirname);
    const inAssets = path.join(appRoot, 'assets', 'sfx', filename);
    if (fs.existsSync(inAssets)) return inAssets;
    return null;
}

// ---------------------------------------------------------------------------
// SUBTITLES
// ---------------------------------------------------------------------------

function buildSubtitleFilter(plan, baseLabel) {
    if (!plan.subtitlesEnabled) return { filters: [], label: baseLabel };

    const filters = [];
    let currentLabel = baseLabel;

    for (const scene of (plan.scenes || [])) {
        if (!scene.text || scene.text.trim() === '') continue;
        const text = scene.text.replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
        const startT = scene.startTime || 0;
        const endT = scene.endTime || (startT + scene.duration);
        const outLabel = `sub${scene.index}`;

        filters.push(
            `${currentLabel}drawtext=text='${text}':fontsize=32:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-100:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})'[${outLabel}]`
        );
        currentLabel = `[${outLabel}]`;
    }

    return { filters, label: currentLabel };
}

// ---------------------------------------------------------------------------
// MAIN RENDER FUNCTION
// ---------------------------------------------------------------------------

async function renderWithFFmpeg(plan, options = {}) {
    _cancelled = false;
    _activeProcesses.clear();

    const {
        publicDir,
        outputPath,
        progressCallback = () => {},
        ffmpegPath = FFMPEG_PATH
    } = options;

    const fps = plan.fps || 30;
    const totalDuration = plan.totalDuration || 60;
    const tempDir = path.join(path.dirname(publicDir), 'temp');
    const prepDir = path.join(tempDir, 'ffmpeg-prep');

    // Clean and recreate prep directory (avoid stale files from previous runs)
    if (fs.existsSync(prepDir)) {
        try {
            const oldFiles = fs.readdirSync(prepDir);
            for (const f of oldFiles) {
                const fp = path.join(prepDir, f);
                try {
                    if (fs.statSync(fp).isDirectory()) {
                        // Remove subdirectories (e.g., mg-clips)
                        const subFiles = fs.readdirSync(fp);
                        for (const sf of subFiles) fs.unlinkSync(path.join(fp, sf));
                        fs.rmdirSync(fp);
                    } else {
                        fs.unlinkSync(fp);
                    }
                } catch (e2) { /* ignore individual file errors */ }
            }
        } catch (e) { /* ignore */ }
    } else {
        fs.mkdirSync(prepDir, { recursive: true });
    }

    const totalTimer = timer('TOTAL RENDER');

    // ==== Probe NVENC at startup ====
    await probeNvenc();

    log(`FFmpeg renderer ${RENDERER_VERSION} loaded`);
    log(`Starting FFmpeg${_nvencAvailable ? ' GPU' : ' CPU'} render (${totalDuration.toFixed(1)}s, ${fps}fps, parallel=${PARALLEL_LIMIT})`);
    log(`Output: ${outputPath}`);

    // ==== PASS 1: Prepare scenes ====
    const pass1Timer = timer('Pass 1 — Scene prep');
    progressCallback({ percent: 5, message: 'Preparing scene clips...' });

    const allScenes = (plan.scenes || []).filter(s => !s.isMGScene && !s.isOverlay && !s.disabled);
    let preparedCount = 0;

    // Log scene durations to confirm they're in seconds
    allScenes.forEach(s => {
        const dur = getSceneDurationSec(s, fps);
        log(`  Plan scene ${s.index}: ${(s.mediaType || 'video')} dur=${dur.toFixed(2)}s (raw duration=${s.duration})`);
    });

    const prepareTasks = allScenes.map((scene) => async () => {
        try {
            const t0 = Date.now();
            await prepareScene(scene, publicDir, prepDir, fps);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            log(`  Scene ${scene.index} (${scene.mediaType || 'video'}): ${elapsed}s`);
            preparedCount++;
            const pct = 5 + Math.round((preparedCount / allScenes.length) * 35);
            progressCallback({ percent: pct, message: `Preparing: ${preparedCount}/${allScenes.length} scenes` });
        } catch (e) {
            logError(`Scene ${scene.index} prep failed: ${e.message}`);
            // Generate black clip fallback
            await generateBlackClip(
                path.join(prepDir, `prep-${scene.index}.mp4`),
                getSceneDurationSec(scene, fps),
                fps
            );
        }
    });

    await parallelWithLimit(prepareTasks, PARALLEL_LIMIT);
    pass1Timer();
    log(`Prepared ${preparedCount}/${allScenes.length} scenes`);

    // ==== PASS 1.5: Pre-render MGs via Remotion ====
    const pass15Timer = timer('Pass 1.5 — MG pre-render (Remotion)');
    let mgClipDir = null;
    const hasMGs = (plan.motionGraphics || []).length > 0 ||
                   (plan.mgScenes || []).length > 0 ||
                   (plan.scenes || []).some(s => s.isMGScene && !s.disabled);
    if (hasMGs) {
        try {
            mgClipDir = await preRenderMGs(plan, publicDir, prepDir, progressCallback);
        } catch (e) {
            logError(`MG pre-rendering failed: ${e.message}`);
            log('MGs will be skipped in this render');
        }
    }
    pass15Timer();

    // ==== PASS 2: Build filter graph & compose ====
    const pass2Timer = timer('Pass 2 — FFmpeg compose + encode');
    progressCallback({ percent: 42, message: 'Building composition...' });

    const { inputs, filters, videoOutLabel } = await buildFilterGraph(plan, prepDir, mgClipDir, publicDir);

    // Add audio
    const { audioFilters, audioOutLabel } = buildAudioMix(plan, publicDir, inputs);
    const allFilters = [...filters, ...audioFilters];

    // Write filter graph to file (avoids Windows command length limit)
    const filterFile = path.join(prepDir, 'filter_graph.txt');
    fs.writeFileSync(filterFile, allFilters.join(';\n'));

    log(`Filter graph: ${allFilters.length} filters, ${inputs.length} inputs`);
    log(`Inputs:\n${inputs.map((f, i) => {
        if (typeof f === 'object') return `  [${i}] ${path.basename(f.file)}${f.streamLoop ? ' (looped)' : ''}`;
        return `  [${i}] ${path.basename(f)}`;
    }).join('\n')}`);
    log(`Filter graph written to: ${filterFile}`);

    // Build FFmpeg command
    const inputArgs = [];
    for (const inp of inputs) {
        const file = typeof inp === 'object' ? inp.file : inp;
        const streamLoop = typeof inp === 'object' && inp.streamLoop;
        if (file.startsWith('color=') || file.startsWith('nullsrc')) {
            inputArgs.push('-f', 'lavfi', '-i', file);
        } else {
            if (streamLoop) inputArgs.push('-stream_loop', '-1');
            inputArgs.push('-i', file);
        }
    }

    const buildNvencOutputArgs = (preset) => ([
        '-filter_complex_script', filterFile,
        '-map', `[${videoOutLabel}]`,
        ...(audioOutLabel ? ['-map', `[${audioOutLabel}]`] : []),
        // Keep NVENC args conservative for widest driver compatibility
        '-c:v', 'h264_nvenc', '-preset', preset,
        '-b:v', FINAL_VIDEO_BITRATE,
        '-maxrate:v', FINAL_VIDEO_MAXRATE,
        '-bufsize:v', FINAL_VIDEO_BUFSIZE,
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        ...(audioOutLabel ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        '-movflags', '+faststart',
        '-t', String(Math.ceil(totalDuration + 1)),
        '-y', outputPath
    ]);

    const runEncodePass = (args, modeLabel) => runFFmpeg(args, (pct, secs) => {
        const percent = 45 + Math.round(pct * 0.55);
        progressCallback({
            percent: Math.min(99, percent),
            message: `${modeLabel}: ${secs.toFixed(1)}s / ${totalDuration.toFixed(1)}s`
        });
    }, totalDuration);

    if (_nvencAvailable) {
        log('Compositing with NVENC GPU encoding...');
        progressCallback({ percent: 45, message: 'Compositing & encoding (GPU)...' });
    } else {
        log('Compositing with CPU encoding (libx264)...');
        progressCallback({ percent: 45, message: 'Compositing & encoding (CPU)...' });
    }

    const nvencArgsP4 = [...inputArgs, ...buildNvencOutputArgs(NVENC_PRESET_FAST)];
    const nvencArgsCompat = [...inputArgs, ...buildNvencOutputArgs(NVENC_PRESET_COMPAT)];

    try {
        if (!_nvencAvailable) throw new Error('NVENC not available, skip to CPU');
        await runEncodePass(nvencArgsP4, 'GPU Encoding');
        log('✓ Compose used h264_nvenc (GPU)');
    } catch (e) {
        if (_nvencAvailable) {
            log(`NVENC failed (preset=${NVENC_PRESET_FAST}): ${errorText(e).slice(-1500)}`);
            log(`Retrying NVENC with compatibility preset=${NVENC_PRESET_COMPAT}...`);
        }
        try {
            if (!_nvencAvailable) throw new Error('Skip compat too');
            await runEncodePass(nvencArgsCompat, 'GPU Encoding (compat)');
            log('✓ Compose used h264_nvenc compat (GPU)');
        } catch (eCompat) {
            // Fallback to CPU encoding
            if (_nvencAvailable) {
                log(`NVENC compatibility failed: ${errorText(eCompat).slice(-1500)}`);
            }
            log('Encoding with CPU (libx264)...');
            progressCallback({ percent: 45, message: 'Encoding with CPU...' });

            // Build CPU output args from scratch
            const cpuOutputArgs = [
                '-filter_complex_script', filterFile,
                '-map', `[${videoOutLabel}]`,
                ...(audioOutLabel ? ['-map', `[${audioOutLabel}]`] : []),
                '-c:v', 'libx264', '-preset', 'medium', '-crf', CPU_FALLBACK_CRF,
                '-pix_fmt', 'yuv420p',
                ...(audioOutLabel ? ['-c:a', 'aac', '-b:a', '192k'] : []),
                '-movflags', '+faststart',
                '-t', String(Math.ceil(totalDuration + 1)),
                '-y', outputPath
            ];
            const cpuArgs = [...inputArgs, ...cpuOutputArgs];
            try {
                await runEncodePass(cpuArgs, 'CPU Encoding');
            } catch (cpuErr) {
                logError(`CPU fallback also failed: ${errorText(cpuErr).slice(-1500)}`);
                throw cpuErr;
            }
        }
    }

    // Cleanup prep directory (keep filter_graph.txt + mg-clips for debugging)
    try {
        const prepFiles = fs.readdirSync(prepDir);
        for (const f of prepFiles) {
            if (f === 'filter_graph.txt' || f === 'mg-clips') continue; // keep for debugging
            const fp = path.join(prepDir, f);
            if (fs.statSync(fp).isDirectory()) {
                // Clean mg-clips subdirectory
                try {
                    const subFiles = fs.readdirSync(fp);
                    for (const sf of subFiles) fs.unlinkSync(path.join(fp, sf));
                    fs.rmdirSync(fp);
                } catch (e2) { /* ignore */ }
            } else {
                fs.unlinkSync(fp);
            }
        }
    } catch (e) { /* ignore cleanup errors */ }

    pass2Timer();
    const totalSec = totalTimer();

    if (fs.existsSync(outputPath)) {
        const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
        log(`✅ Render complete: ${outputPath} (${sizeMB} MB) in ${totalSec}s`);
        log(`Encoder: ${_nvencAvailable ? 'h264_nvenc (GPU)' : 'libx264 (CPU)'}`);
        return { success: true, outputPath };
    }

    return { success: false, error: 'Output file not found after render' };
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = { renderWithFFmpeg, cancelRender };

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execFile, execFileSync } = require('child_process');
const config = require('./config');

/**
 * Standalone overlay video downloader with local cache.
 *
 * Cache: assets/overlays/ stores one .mp4 per overlay type (grain.mp4, dust.mp4, etc.)
 * On build: cache hit → instant copy, no network. Cache miss → download → save to cache + temp.
 * Priority: Local cache → Pexels → Pixabay → yt-dlp YouTube → code-generated fallback.
 * Completely independent of footage provider settings.
 */

// Search keywords for each overlay type
const OVERLAY_KEYWORDS = {
    grain:        'film grain overlay black background',
    dust:         'dust particles overlay black background',
    lightLeak:    'light leak flare overlay black background',
    blurVignette: 'bokeh lights overlay black background',
};

// ============ LOCAL CACHE ============
const CACHE_DIR = path.join(__dirname, '..', 'assets', 'overlays');

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function getCachePath(overlayType) {
    return path.join(CACHE_DIR, `${overlayType}.mp4`);
}

function isCached(overlayType) {
    const cachePath = getCachePath(overlayType);
    return fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1000;
}

function copyFromCache(overlayType, outputPath) {
    fs.copyFileSync(getCachePath(overlayType), outputPath);
}

function saveToCache(overlayType, sourcePath) {
    ensureCacheDir();
    fs.copyFileSync(sourcePath, getCachePath(overlayType));
}

const OVERLAY_TYPES = new Set(Object.keys(OVERLAY_KEYWORDS));

// ============ SCAN LOCAL OVERLAYS ============
// Scans assets/overlays/ folder for all available overlay files (video + image)
function scanLocalOverlays() {
    ensureCacheDir();
    const supportedExts = new Set(['.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.gif']);
    let files;
    try {
        files = fs.readdirSync(CACHE_DIR).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return supportedExts.has(ext) && !f.startsWith('.');
        });
    } catch (e) {
        return [];
    }

    return files.map(f => {
        const ext = path.extname(f).toLowerCase();
        const name = path.basename(f, path.extname(f));
        const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);
        const fullPath = path.join(CACHE_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
            filename: f,
            name,
            ext,
            mediaType: isVideo ? 'video' : 'image',
            size: stat.size,
            path: fullPath,
        };
    });
}

// ============ YT-DLP DETECTION ============
let _ytdlpPath = null;
let _ytdlpChecked = false;

function findYtdlp() {
    if (_ytdlpChecked) return _ytdlpPath;
    _ytdlpChecked = true;

    const projectRoot = path.join(__dirname, '..');
    const candidates = [
        config.youtube?.ytdlpPath || null,
        path.join(projectRoot, 'yt-dlp', 'yt-dlp.exe'),
        path.join(projectRoot, 'yt-dlp.exe'),
        'yt-dlp',
        'yt-dlp.exe',
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            execFileSync(candidate, ['--version'], {
                timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
            });
            _ytdlpPath = candidate;
            return _ytdlpPath;
        } catch (e) { /* try next */ }
    }
    return null;
}

// ============ PEXELS API ============
async function searchPexels(keyword) {
    if (!config.pexels?.apiKey) return [];
    try {
        const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=10&orientation=landscape`;
        const res = await axios.get(url, {
            headers: { Authorization: config.pexels.apiKey },
            timeout: 15000,
        });
        if (!res.data?.videos?.length) return [];
        return res.data.videos.map(v => {
            const hd = v.video_files.find(f => f.quality === 'hd');
            return { id: `pexels-${v.id}`, url: hd?.link || v.video_files[0]?.link, source: 'Pexels' };
        }).filter(r => r.url);
    } catch (e) {
        console.log(`  ⚠️ Pexels search failed: ${e.message}`);
        return [];
    }
}

// ============ PIXABAY API ============
async function searchPixabay(keyword) {
    if (!config.pixabay?.apiKey) return [];
    try {
        const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(config.pixabay.apiKey)}&q=${encodeURIComponent(keyword)}&per_page=10&orientation=horizontal`;
        const res = await axios.get(url, { timeout: 15000 });
        if (!res.data?.hits?.length) return [];
        return res.data.hits.map(h => {
            const vid = h.videos?.large || h.videos?.medium || h.videos?.small;
            return { id: `pixabay-${h.id}`, url: vid?.url, source: 'Pixabay' };
        }).filter(r => r.url);
    } catch (e) {
        console.log(`  ⚠️ Pixabay search failed: ${e.message}`);
        return [];
    }
}

// ============ YT-DLP YOUTUBE SEARCH ============
async function searchYouTube(keyword) {
    const ytdlp = findYtdlp();
    if (!ytdlp) return [];

    return new Promise((resolve) => {
        const args = [
            `ytsearch5:${keyword}`,
            '--get-id', '--get-title',
            '--no-download', '--no-warnings', '--flat-playlist',
        ];
        execFile(ytdlp, args, { timeout: 30000, windowsHide: true }, (error, stdout) => {
            if (error) {
                console.log(`  ⚠️ yt-dlp search failed: ${error.message}`);
                return resolve([]);
            }
            const lines = stdout.trim().split('\n').filter(l => l.trim());
            const results = [];
            for (let i = 0; i < lines.length - 1; i += 2) {
                const videoId = lines[i + 1].trim();
                if (videoId && videoId.length === 11) {
                    results.push({
                        id: `yt-${videoId}`,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        source: 'YouTube',
                    });
                }
            }
            resolve(results);
        });
    });
}

// ============ DOWNLOAD: HTTP DIRECT ============
async function downloadDirect(url, outputPath) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 60000 });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(outputPath));
        writer.on('error', reject);
    });
}

// ============ DOWNLOAD: YT-DLP ============
async function downloadYtdlp(url, outputPath) {
    const ytdlp = findYtdlp();
    if (!ytdlp) throw new Error('yt-dlp not available');

    const args = [
        url,
        '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',
        '--download-sections', '*0-12',
        '--merge-output-format', 'mp4',
        '--no-playlist', '--no-warnings', '--no-check-certificates',
        '-o', outputPath, '--force-overwrites', '--max-filesize', '30M',
    ];

    // Use ffmpeg-static if available
    try {
        const ffmpegPath = require('ffmpeg-static');
        if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));
    } catch (e) { /* system ffmpeg */ }

    return new Promise((resolve, reject) => {
        execFile(ytdlp, args, { timeout: 120000, windowsHide: true }, (error) => {
            if (error) {
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
                return reject(new Error(`yt-dlp download failed: ${error.message}`));
            }

            // Handle section suffix in filename
            if (!fs.existsSync(outputPath)) {
                const dir = path.dirname(outputPath);
                const base = path.basename(outputPath, '.mp4');
                try {
                    const files = fs.readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.mp4'));
                    if (files.length > 0) fs.renameSync(path.join(dir, files[0]), outputPath);
                } catch (e) {}
            }

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
                return reject(new Error('yt-dlp produced empty or missing file'));
            }
            resolve(outputPath);
        });
    });
}

// ============ FETCH ONE OVERLAY (TRY ALL SOURCES) ============
const usedIds = new Set();

async function fetchOverlay(keyword, outputPath) {
    // Source 1 & 2: Pexels, Pixabay (direct HTTP download)
    for (const searcher of [searchPexels, searchPixabay]) {
        const results = await searcher(keyword);
        const pick = results.find(r => !usedIds.has(r.id)) || results[0];
        if (!pick) continue;
        try {
            usedIds.add(pick.id);
            await downloadDirect(pick.url, outputPath);
            return pick.source;
        } catch (e) {
            console.log(`  ⚠️ ${pick.source} download failed: ${e.message}`);
        }
    }

    // Source 3: YouTube via yt-dlp (no API key needed)
    const ytResults = await searchYouTube(keyword);
    const ytPick = ytResults.find(r => !usedIds.has(r.id)) || ytResults[0];
    if (ytPick) {
        try {
            usedIds.add(ytPick.id);
            console.log(`  ⬇️  [YouTube] Downloading overlay clip...`);
            await downloadYtdlp(ytPick.url, outputPath);
            return 'YouTube';
        } catch (e) {
            console.log(`  ⚠️ YouTube download failed: ${e.message}`);
        }
    }

    return null;
}

// ============ MAIN ============
async function downloadOverlays(visualEffects, scenes, aiSelectedOverlays) {
    console.log('\n🎭 Overlay videos (with local cache)...');

    ensureCacheDir();

    const overlayScenes = [];
    let overlayIndex = 0;

    // If AI selected overlays from local library, they cover the whole video —
    // skip the old per-scene download system to avoid duplication
    if (aiSelectedOverlays && aiSelectedOverlays.length > 0) {
        console.log(`  ℹ️  AI selected ${aiSelectedOverlays.length} overlay(s) from local library — skipping per-scene downloads`);
    } else {
        // Legacy per-scene overlay download (only when no AI selection)
        const neededTypes = new Set();
        for (const sceneVfx of visualEffects) {
            for (const effect of sceneVfx.effects) {
                if (OVERLAY_TYPES.has(effect.type)) neededTypes.add(effect.type);
            }
        }

        // Deduplicate: only need one overlay per TYPE (covers whole video), not per scene
        const cachedTypes = [...neededTypes].filter(t => isCached(t));
        const uncachedTypes = [...neededTypes].filter(t => !isCached(t));

        if (cachedTypes.length > 0) {
            console.log(`  📁 Cached: ${cachedTypes.join(', ')}`);
        }

        const hasPexels = !!config.pexels?.apiKey;
        const hasPixabay = !!config.pixabay?.apiKey;
        const hasYtdlp = !!findYtdlp();
        const hasAnySources = hasPexels || hasPixabay || hasYtdlp;

        if (uncachedTypes.length > 0 && !hasAnySources) {
            console.log(`  ℹ️ Uncached: ${uncachedTypes.join(', ')} (no sources available to download)`);
            if (cachedTypes.length === 0) {
                console.log('  ℹ️ Code-generated VFX will be used instead\n');
            }
        } else if (uncachedTypes.length > 0) {
            console.log(`  ⬇️  Need download: ${uncachedTypes.join(', ')}`);
            console.log(`  📦 Sources: ${hasPexels ? '✅ Pexels' : '—'} ${hasPixabay ? '✅ Pixabay' : '—'} ${hasYtdlp ? '✅ yt-dlp' : '—'}`);
        }

        usedIds.clear();
        const resolvedByType = {};

        // Create ONE overlay per type covering the whole video (not per-scene duplicates)
        const totalStart = scenes.length > 0 ? scenes[0].startTime : 0;
        const totalEnd = scenes.length > 0 ? scenes[scenes.length - 1].endTime : 60;

        for (const overlayType of neededTypes) {
            const keyword = OVERLAY_KEYWORDS[overlayType];
            if (!keyword) continue;

            // Find the best intensity from any scene that uses this effect
            let bestIntensity = 0.3;
            for (const sceneVfx of visualEffects) {
                const match = sceneVfx.effects.find(e => e.type === overlayType);
                if (match) { bestIntensity = match.intensity; break; }
            }

            const filenameBase = `overlay-${overlayIndex}`;
            const outputPath = path.join(config.paths.temp, `${filenameBase}.mp4`);
            let provider = null;

            if (isCached(overlayType)) {
                try {
                    copyFromCache(overlayType, outputPath);
                    provider = 'cache';
                    console.log(`  📁 [Cache] ${overlayType} → ${filenameBase}.mp4`);
                } catch (err) {
                    console.log(`  ⚠️ Cache copy failed: ${err.message}`);
                    continue;
                }
            } else if (hasAnySources) {
                console.log(`  🔍 Searching: "${keyword}"`);
                provider = await fetchOverlay(keyword, outputPath);
                if (provider) {
                    try {
                        saveToCache(overlayType, outputPath);
                        console.log(`  ✅ [${provider}] ${overlayType} → ${filenameBase}.mp4 (cached for future)`);
                    } catch (err) {
                        console.log(`  ✅ [${provider}] ${overlayType} → ${filenameBase}.mp4 (cache save failed: ${err.message})`);
                    }
                } else {
                    console.log(`  ⚠️ No overlay found for ${overlayType} — code fallback will apply`);
                    continue;
                }
            } else {
                continue;
            }

            overlayScenes.push({
                index: overlayIndex,
                trackId: 'overlay-track',
                isOverlay: true,
                blendMode: 'screen',
                overlayType: overlayType,
                overlayIntensity: bestIntensity,
                mediaFile: outputPath,
                mediaExtension: '.mp4',
                mediaType: 'video',
                sourceProvider: provider,
                startTime: totalStart,
                endTime: totalEnd,
                text: `${overlayType} overlay`,
            });
            overlayIndex++;
        }
    }

    // Merge AI-selected local overlay files (from assets/overlays/)
    if (aiSelectedOverlays && aiSelectedOverlays.length > 0) {
        console.log(`\n  🎭 Adding ${aiSelectedOverlays.length} AI-selected local overlay(s)...`);
        for (const sel of aiSelectedOverlays) {
            const localPath = path.join(CACHE_DIR, sel.sourceFile || sel.filename);
            if (!fs.existsSync(localPath)) {
                console.log(`    ⚠️ Local overlay not found: ${sel.filename}`);
                continue;
            }

            // Copy local overlay to temp with overlay index naming
            const ext = sel.ext || path.extname(sel.filename).toLowerCase();
            const outputPath = path.join(config.paths.temp, `overlay-${overlayIndex}${ext}`);
            try {
                fs.copyFileSync(localPath, outputPath);
            } catch (err) {
                console.log(`    ⚠️ Failed to copy local overlay: ${err.message}`);
                continue;
            }

            overlayScenes.push({
                index: overlayIndex,
                trackId: 'overlay-track',
                isOverlay: true,
                blendMode: sel.blendMode || 'screen',
                overlayType: sel.name || path.basename(sel.filename, ext),
                overlayIntensity: sel.intensity || 0.25,
                mediaFile: outputPath,
                mediaExtension: ext,
                mediaType: sel.mediaType || (['.jpg', '.jpeg', '.png', '.gif'].includes(ext) ? 'image' : 'video'),
                sourceProvider: 'local',
                sourceFile: sel.filename,
                isLocal: true,
                startTime: sel.startTime || 0,
                endTime: sel.endTime || (scenes.length > 0 ? scenes[scenes.length - 1].endTime : 60),
                text: `${sel.name || sel.filename} overlay`,
            });
            console.log(`    📁 [Local] "${sel.name || sel.filename}" → overlay-${overlayIndex}${ext}`);
            overlayIndex++;
        }
    }

    const fromCache = overlayScenes.filter(s => s.sourceProvider === 'cache').length;
    const fromLocal = overlayScenes.filter(s => s.sourceProvider === 'local').length;
    const fromDownload = overlayScenes.length - fromCache - fromLocal;
    console.log(`\n✅ ${overlayScenes.length} overlay clips (${fromCache} cached, ${fromLocal} local, ${fromDownload} downloaded)\n`);
    return overlayScenes;
}

module.exports = { downloadOverlays, scanLocalOverlays };

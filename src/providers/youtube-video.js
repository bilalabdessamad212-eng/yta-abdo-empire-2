const { execFile, execFileSync } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const BaseProvider = require('./base-provider');

// Chapter titles that indicate intro/outro segments to skip
const SKIP_CHAPTER_PATTERNS = [
    'intro', 'introduction', 'opening', 'welcome', 'sponsor',
    'outro', 'end screen', 'credits', 'subscribe', 'like and subscribe',
    'disclaimer', 'teaser', 'preview', 'bumper',
];

// Title patterns that indicate non-footage content (music, lyrics, etc.)
const REJECT_TITLE_PATTERNS = [
    'official music video', 'official video', 'lyrics', 'lyric video',
    'karaoke', 'full album', 'audio only', 'official audio',
    'sing along', 'instrumental', 'remix', 'live performance',
    'reaction video', 'unboxing', 'asmr',
];

// Theme-specific query strategies for YouTube
const QUERY_STRATEGIES = {
    politics:      (kw) => [`${kw} news report`, `${kw} press conference`, `${kw} footage`],
    finance:       (kw) => [`${kw} news report`, `${kw} market analysis`, `${kw} footage`],
    business:      (kw) => [`${kw} news`, `${kw} corporate`, `${kw} footage`],
    technology:    (kw) => [`${kw} demo`, `${kw} tech review`, `${kw} footage`],
    history:       (kw) => [`${kw} documentary`, `${kw} historical footage`, `${kw} archive`],
    entertainment: (kw) => [`${kw} clip`, `${kw} highlights`, `${kw} footage`],
    sports:        (kw) => [`${kw} highlights`, `${kw} game footage`, `${kw} sports`],
    nature:        (kw) => [`${kw} nature documentary`, `${kw} wildlife`, `${kw} stock footage`],
    travel:        (kw) => [`${kw} travel`, `${kw} aerial`, `${kw} stock footage`],
    science:       (kw) => [`${kw} explained`, `${kw} experiment`, `${kw} documentary`],
    health:        (kw) => [`${kw} medical`, `${kw} health report`, `${kw} footage`],
    education:     (kw) => [`${kw} explained`, `${kw} lecture`, `${kw} educational`],
    crime:         (kw) => [`${kw} crime report`, `${kw} investigation`, `${kw} footage`],
    documentary:   (kw) => [`${kw} documentary`, `${kw} real footage`, `${kw} investigation`],
    motivation:    (kw) => [`${kw} motivational`, `${kw} inspirational`, `${kw} stock footage`],
};

class YouTubeVideoProvider extends BaseProvider {
    constructor() {
        super('YouTube Videos', 'video');
        this._ytdlpPath = null;
        this._ytdlpChecked = false;
        this._ytdlpAvailable = false;
        this._scriptContext = null;
    }

    /**
     * Set script context for theme-aware search queries
     */
    setContext(scriptContext) {
        this._scriptContext = scriptContext;
    }

    isAvailable() {
        if (!this._ytdlpChecked) {
            this._ytdlpChecked = true;
            this._ytdlpAvailable = false;

            // Check: configured path, project-local yt-dlp folder, then system PATH
            const projectRoot = path.join(__dirname, '..', '..');
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
                        timeout: 5000,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        windowsHide: true
                    });
                    this._ytdlpPath = candidate;
                    this._ytdlpAvailable = true;
                    console.log(`  [YouTube] yt-dlp found: ${candidate}`);
                    break;
                } catch (e) {
                    // try next candidate
                }
            }

            if (!this._ytdlpAvailable) {
                console.log('  [YouTube] yt-dlp not found. Install from: https://github.com/yt-dlp/yt-dlp/releases');
            }
        }
        return this._ytdlpAvailable;
    }

    /**
     * Build context-aware search queries based on video theme
     */
    _buildSearchQueries(keyword) {
        const queries = [];
        const theme = (this._scriptContext?.theme || '').toLowerCase();

        // Use theme-specific strategies if available
        if (theme && QUERY_STRATEGIES[theme]) {
            queries.push(...QUERY_STRATEGIES[theme](keyword));
        }

        // Tone-based additions
        const tone = (this._scriptContext?.tone || '').toLowerCase();
        if (tone === 'urgent' || tone === 'dramatic' || tone === 'serious') {
            queries.push(`${keyword} breaking news`);
        }

        // Always add generic fallbacks
        queries.push(`${keyword} stock footage`);
        queries.push(keyword); // raw keyword as last resort

        // Deduplicate while preserving order
        return [...new Set(queries)];
    }

    /**
     * Filter out non-footage results (music videos, lyrics, etc.)
     */
    _filterByTitle(results) {
        return results.filter(r => {
            if (!r.title) return true; // no title info, let it through
            const lower = r.title.toLowerCase();
            for (const pattern of REJECT_TITLE_PATTERNS) {
                if (lower.includes(pattern)) return false;
            }
            return true;
        });
    }

    /**
     * Fetch video metadata (duration, chapters) via yt-dlp --dump-json
     */
    async _getVideoMetadata(url) {
        return new Promise((resolve) => {
            const args = [
                url,
                '--dump-json',
                '--no-download',
                '--no-warnings',
                '--no-check-certificates',
            ];

            execFile(this._ytdlpPath, args, {
                timeout: 20000,
                windowsHide: true,
                maxBuffer: 5 * 1024 * 1024, // 5MB buffer for large JSON
            }, (error, stdout) => {
                if (error) {
                    console.log(`  [YouTube] Metadata fetch failed: ${error.message}`);
                    return resolve(null);
                }

                try {
                    const data = JSON.parse(stdout);
                    return resolve({
                        duration: data.duration || 0,
                        chapters: data.chapters || [],
                        title: data.title || '',
                        description: data.description || '',
                    });
                } catch (e) {
                    console.log(`  [YouTube] Failed to parse metadata JSON`);
                    return resolve(null);
                }
            });
        });
    }

    /**
     * Calculate the best start time to skip intros/logos.
     * Uses chapters if available, otherwise skips a percentage of the video.
     */
    _calculateBestStartTime(metadata, neededDuration) {
        if (!metadata || !metadata.duration) {
            // No metadata — skip a fixed 15s to avoid most intros
            return 15;
        }

        const totalDuration = metadata.duration;

        // Very short video (< 30s) — don't skip, it's already concise
        if (totalDuration < 30) {
            return 0;
        }

        // Short video (30-60s) — skip just a few seconds
        if (totalDuration < 60) {
            return Math.min(5, Math.floor(totalDuration * 0.1));
        }

        // Try chapter-based selection first
        if (metadata.chapters && metadata.chapters.length > 1) {
            const startTime = this._pickChapterStartTime(metadata.chapters, neededDuration, totalDuration);
            if (startTime !== null) {
                return startTime;
            }
        }

        // No usable chapters — skip intro percentage
        // Skip 15-20% of video, minimum 10s, maximum 90s
        const skipPercent = 0.15;
        let skipSeconds = Math.floor(totalDuration * skipPercent);
        skipSeconds = Math.max(10, Math.min(skipSeconds, 90));

        // Make sure we don't overshoot — leave room for our clip
        const maxStart = totalDuration - neededDuration - 2;
        if (maxStart <= 0) return 0;

        return Math.min(skipSeconds, maxStart);
    }

    /**
     * Pick the best chapter start time, skipping intro/outro chapters.
     */
    _pickChapterStartTime(chapters, neededDuration, totalDuration) {
        // Find content chapters (not intro/outro)
        const contentChapters = chapters.filter(ch => {
            const title = (ch.title || '').toLowerCase();
            for (const pattern of SKIP_CHAPTER_PATTERNS) {
                if (title.includes(pattern)) return false;
            }
            return true;
        });

        if (contentChapters.length === 0) return null;

        // Pick the first content chapter that's long enough for our clip
        for (const ch of contentChapters) {
            const chStart = ch.start_time || 0;
            const chEnd = ch.end_time || totalDuration;
            const chDuration = chEnd - chStart;

            if (chDuration >= neededDuration) {
                // Start a few seconds into the chapter (skip chapter title cards)
                const offset = Math.min(3, Math.floor(chDuration * 0.1));
                const startTime = chStart + offset;
                // Ensure we have room
                if (startTime + neededDuration <= totalDuration) {
                    console.log(`  [YouTube] Using chapter "${ch.title}" starting at ${Math.round(startTime)}s`);
                    return Math.floor(startTime);
                }
            }
        }

        // No chapter long enough, just use the first content chapter's start
        const first = contentChapters[0];
        const startTime = first.start_time || 0;
        if (startTime + neededDuration <= totalDuration) {
            console.log(`  [YouTube] Using chapter "${first.title}" starting at ${Math.round(startTime)}s`);
            return Math.floor(startTime);
        }

        return null;
    }

    /**
     * Find the best segment of a video by sampling frames and scoring with vision AI.
     * Downloads a low-res copy, extracts frames at sample points, scores each against keyword.
     * @returns {number|null} best start time in seconds, or null if analysis fails
     */
    async _findBestSegment(url, keyword, metadata, neededDuration) {
        const { scoreVideoFrame, isVisionAvailable, checkFfmpegAvailable } = require('../ai-vision');

        if (!isVisionAvailable()) {
            console.log(`  [YouTube] Vision AI not available, using heuristic`);
            return null;
        }

        const ffmpegPath = checkFfmpegAvailable();
        if (!ffmpegPath) {
            console.log(`  [YouTube] ffmpeg not available for frame extraction`);
            return null;
        }

        const totalDuration = metadata.duration;
        if (totalDuration < 60) return null; // Too short, heuristic is fine

        const tempDir = config.paths?.temp || path.join(__dirname, '..', '..', 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const uid = Date.now();
        const lowResPath = path.join(tempDir, `_yt_sample_${uid}.mp4`);
        const framePaths = [];

        try {
            // Step 1: Download low-res video (no audio, worst quality — fast)
            console.log(`  [YouTube] Downloading low-res sample for frame analysis...`);
            await this._downloadLowRes(url, lowResPath);

            if (!fs.existsSync(lowResPath) || fs.statSync(lowResPath).size < 1000) {
                console.log(`  [YouTube] Low-res download failed`);
                return null;
            }

            // Step 2: Calculate 3 sample timestamps (at 10%, 47%, 85% of video)
            const startAt = Math.floor(totalDuration * 0.10);
            const endAt = Math.floor(totalDuration * 0.85);
            const range = endAt - startAt;
            const numSamples = 3;
            const timestamps = [];
            for (let i = 0; i < numSamples; i++) {
                timestamps.push(Math.floor(startAt + (range * i) / (numSamples - 1)));
            }

            // Step 3: Extract frames in parallel (async)
            console.log(`  [YouTube] Extracting ${numSamples} sample frames at: ${timestamps.map(t => t + 's').join(', ')}`);
            const extractPromises = timestamps.map((ts, i) => {
                const framePath = path.join(tempDir, `_yt_frame_${uid}_${i}.jpg`);
                framePaths.push(framePath);
                return new Promise((resolve) => {
                    execFile(ffmpegPath, [
                        '-ss', String(ts),
                        '-i', lowResPath,
                        '-vf', 'scale=512:-1',
                        '-frames:v', '1',
                        '-q:v', '3',
                        '-y', framePath
                    ], { timeout: 10000, windowsHide: true }, (err) => {
                        resolve(err ? null : framePath);
                    });
                });
            });
            const extractedFrames = await Promise.all(extractPromises);
            // Mark failed extractions
            for (let i = 0; i < extractedFrames.length; i++) {
                if (!extractedFrames[i]) framePaths[i] = null;
            }

            // Step 4: Score each frame against the keyword in parallel
            const validIndices = [];
            const scorePromises = [];

            for (let i = 0; i < framePaths.length; i++) {
                if (!framePaths[i] || !fs.existsSync(framePaths[i])) continue;
                try {
                    const imageBuffer = fs.readFileSync(framePaths[i]);
                    const base64 = imageBuffer.toString('base64');
                    validIndices.push(i);
                    scorePromises.push(scoreVideoFrame(base64, 'image/jpeg', keyword));
                } catch (e) {
                    // Skip this frame
                }
            }

            if (scorePromises.length < 2) {
                console.log(`  [YouTube] Too few frames extracted, using heuristic`);
                return null;
            }

            console.log(`  [YouTube] Scoring ${scorePromises.length} frames with Vision AI...`);
            const scores = await Promise.all(scorePromises);

            // Step 5: Pick the highest-scoring frame
            let bestIdx = 0;
            let bestScore = 0;
            for (let i = 0; i < scores.length; i++) {
                const frameNum = validIndices[i];
                console.log(`    Frame ${frameNum + 1} (${timestamps[frameNum]}s): score ${scores[i]}/10`);
                if (scores[i] > bestScore) {
                    bestScore = scores[i];
                    bestIdx = frameNum;
                }
            }

            if (bestScore <= 2) {
                console.log(`  [YouTube] All frames scored poorly, using heuristic`);
                return null;
            }

            const bestTimestamp = timestamps[bestIdx];
            console.log(`  [YouTube] 🎯 Best frame: #${bestIdx + 1} at ${bestTimestamp}s (score: ${bestScore}/10)`);

            // Ensure we don't overshoot the video
            const maxStart = totalDuration - neededDuration - 2;
            return Math.min(bestTimestamp, Math.max(0, maxStart));

        } catch (err) {
            console.log(`  [YouTube] Smart segment analysis failed: ${err.message}`);
            return null;
        } finally {
            // Clean up all temp files
            const cleanupFiles = [lowResPath, ...framePaths.filter(Boolean)];
            for (const f of cleanupFiles) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
            }
        }
    }

    /**
     * Download a low-resolution copy of the video (no audio) for frame analysis.
     */
    async _downloadLowRes(url, outputPath) {
        return new Promise((resolve, reject) => {
            // Use flexible format: try worst mp4 combined, then any worst format
            // "worstvideo[ext=mp4]" alone fails on videos with only webm video streams
            const args = [
                url,
                '-f', 'worst[ext=mp4]/worst[vcodec!=none]/worstvideo/worst',
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificates',
                '-o', outputPath,
                '--force-overwrites',
                '--no-audio',  // We only need video for frame extraction
            ];

            // Use ffmpeg-static if available
            try {
                const ffmpegPath = require('ffmpeg-static');
                if (ffmpegPath) {
                    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
                }
            } catch (e) {}

            execFile(this._ytdlpPath, args, {
                timeout: 60000,
                windowsHide: true,
            }, (error) => {
                if (error) return reject(error);
                resolve(outputPath);
            });
        });
    }

    async search(keyword) {
        const queries = this._buildSearchQueries(keyword);

        for (const query of queries) {
            // Try YouTube Data API v3 first (if API key available)
            if (config.youtube?.apiKey) {
                try {
                    const results = await this._searchAPI(query);
                    const filtered = this._filterByTitle(results);
                    if (filtered.length > 0) return filtered;
                } catch (error) {
                    console.log(`  [YouTube] API search failed for "${query}": ${error.message}`);
                }
            }

            // Fallback: yt-dlp search (no API key needed)
            try {
                const results = await this._searchYtdlp(query);
                const filtered = this._filterByTitle(results);
                if (filtered.length > 0) return filtered;
            } catch (error) {
                console.log(`  [YouTube] yt-dlp search failed for "${query}": ${error.message}`);
            }

            console.log(`  [YouTube] No good results for "${query}", trying next query...`);
        }

        return [];
    }

    async _searchAPI(keyword) {
        const params = {
            part: 'snippet',
            type: 'video',
            q: keyword,
            key: config.youtube.apiKey,
            maxResults: 10,
            videoDuration: 'short',
            videoEmbeddable: 'true',
            order: 'relevance',
        };

        if (config.youtube?.creativeCommonsOnly) {
            params.videoLicense = 'creativeCommon';
        }

        const response = await axios.get(
            'https://www.googleapis.com/youtube/v3/search',
            { params, timeout: 15000 }
        );

        if (!response.data.items || response.data.items.length === 0) {
            return [];
        }

        const items = response.data.items;

        // Fetch view counts for quality-based sorting (1 extra API call)
        let viewCounts = {};
        try {
            const ids = items.map(i => i.id.videoId).join(',');
            const statsResponse = await axios.get(
                'https://www.googleapis.com/youtube/v3/videos',
                {
                    params: { part: 'statistics', id: ids, key: config.youtube.apiKey },
                    timeout: 10000
                }
            );
            for (const vid of (statsResponse.data.items || [])) {
                viewCounts[vid.id] = parseInt(vid.statistics.viewCount || '0');
            }
        } catch (e) {
            // Non-critical — continue without view counts
        }

        return items
            .map(item => ({
                id: item.id.videoId,
                url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                title: item.snippet.title,
                width: 1920,
                height: 1080,
                viewCount: viewCounts[item.id.videoId] || 0,
            }))
            .sort((a, b) => b.viewCount - a.viewCount); // Prefer higher view count
    }

    async _searchYtdlp(keyword) {
        return new Promise((resolve) => {
            const args = [
                `ytsearch10:${keyword}`,
                '--get-id',
                '--get-title',
                '--no-download',
                '--no-warnings',
                '--flat-playlist',
            ];

            // Try with duration filter (newer yt-dlp versions)
            // 10s minimum to avoid shorts/intros, 600s max (10 min)
            args.push('--match-filter', 'duration > 10 & duration < 600');

            execFile(this._ytdlpPath, args, {
                timeout: 30000,
                windowsHide: true,
            }, (error, stdout) => {
                if (error) {
                    // If --match-filter caused error, retry without it
                    if (error.message && error.message.includes('match-filter')) {
                        const fallbackArgs = args.filter(a => a !== '--match-filter' && a !== 'duration > 10 & duration < 600');
                        return execFile(this._ytdlpPath, fallbackArgs, {
                            timeout: 30000,
                            windowsHide: true,
                        }, (err2, stdout2) => {
                            if (err2) return resolve([]);
                            resolve(this._parseYtdlpOutput(stdout2));
                        });
                    }
                    console.log(`  [YouTube] yt-dlp search error: ${error.message}`);
                    return resolve([]);
                }

                resolve(this._parseYtdlpOutput(stdout));
            });
        });
    }

    /**
     * Parse yt-dlp search output (alternating title/id lines)
     */
    _parseYtdlpOutput(stdout) {
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        const results = [];
        // yt-dlp outputs alternating: title, id, title, id, ...
        for (let i = 0; i < lines.length - 1; i += 2) {
            const title = lines[i].trim();
            const videoId = lines[i + 1].trim();
            if (videoId && videoId.length === 11) {
                results.push({
                    id: videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    title: title,
                    width: 1920,
                    height: 1080,
                });
            }
        }
        return results;
    }

    async download(url, outputPath, options = {}) {
        const duration = options.duration || 10;
        const downloadDuration = Math.ceil(duration) + 2;
        const maxHeight = config.youtube?.maxHeight || 720;
        const keyword = options.keyword || '';

        // Fetch metadata to find the best start time (skip intros/logos)
        console.log(`  [YouTube] Fetching metadata for smart clip selection...`);
        const metadata = await this._getVideoMetadata(url);

        let startTime = null;

        // Try vision-based segment selection (most accurate)
        if (keyword && metadata && metadata.duration >= 60) {
            startTime = await this._findBestSegment(url, keyword, metadata, downloadDuration);
        }

        // Fall back to chapter/percentage-based heuristic
        if (startTime === null) {
            startTime = this._calculateBestStartTime(metadata, downloadDuration);
        }

        const endTime = startTime + downloadDuration;

        if (metadata) {
            console.log(`  [YouTube] Video duration: ${Math.round(metadata.duration)}s → Extracting ${startTime}s-${endTime}s`);
        }

        const args = [
            url,
            '-f', `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]`,
            '--download-sections', `*${startTime}-${endTime}`,
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--no-warnings',
            '--no-check-certificates',
            '-o', outputPath,
            '--force-overwrites',
            '--max-filesize', '50M',
        ];

        // Use ffmpeg-static if available (so yt-dlp can merge streams)
        try {
            const ffmpegPath = require('ffmpeg-static');
            if (ffmpegPath) {
                args.push('--ffmpeg-location', path.dirname(ffmpegPath));
            }
        } catch (e) {
            // ffmpeg-static not available, rely on system ffmpeg
        }

        return new Promise((resolve, reject) => {
            console.log(`  [YouTube] Downloading ${downloadDuration}s clip from ${url} [${startTime}s-${endTime}s]`);

            execFile(this._ytdlpPath, args, {
                timeout: 120000,
                windowsHide: true,
            }, (error) => {
                if (error) {
                    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
                    return reject(new Error(`yt-dlp download failed: ${error.message}`));
                }

                // yt-dlp --download-sections may append section suffix to filename
                if (!fs.existsSync(outputPath)) {
                    const dir = path.dirname(outputPath);
                    const base = path.basename(outputPath, '.mp4');
                    try {
                        const files = fs.readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.mp4'));
                        if (files.length > 0) {
                            fs.renameSync(path.join(dir, files[0]), outputPath);
                        }
                    } catch (e) {}
                }

                if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
                    return reject(new Error('yt-dlp produced empty or missing file'));
                }

                console.log(`  [YouTube] Downloaded: ${path.basename(outputPath)} (from ${startTime}s)`);
                resolve(outputPath);
            });
        });
    }
}

module.exports = YouTubeVideoProvider;

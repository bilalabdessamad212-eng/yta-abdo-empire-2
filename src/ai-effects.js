const axios = require('axios');
const config = require('./config');
const { callAI } = require('./ai-provider');

// Track placed effects across scenes for variety
let placedEffects = [];
let aiInstructionsRef = '';

// Lightweight CSS effects (kept as CSS overlays - no heavy per-frame computation)
const CSS_EFFECT_TYPES = {
    vignette: { min: 0.2, max: 0.8, default: 0.5 },
    chromatic: { min: 0.1, max: 0.5, default: 0.3 },
    letterbox: { min: 0.3, max: 1.0, default: 0.6 },
    colorTint: { min: 0.1, max: 0.6, default: 0.3 },
};

// Generated effects — rendered as code in Remotion (no video downloads needed)
const GENERATED_EFFECT_TYPES = {
    grain: { min: 0.1, max: 0.5, default: 0.3 },
    dust: { min: 0.1, max: 0.4, default: 0.2 },
    lightLeak: { min: 0.2, max: 0.7, default: 0.4 },
    blurVignette: { min: 0.2, max: 0.7, default: 0.4 },
};

// Combined for prompt and parsing
const EFFECT_TYPES = { ...CSS_EFFECT_TYPES, ...GENERATED_EFFECT_TYPES };

function buildPrompt(scene, sceneIndex, totalScenes, scriptContext, sceneVisual) {
    const sceneDuration = (scene.endTime - scene.startTime).toFixed(1);

    let prompt = `You are a colorist/VFX artist choosing visual effects for a video scene. Your effects set the mood and visual tone.\n`;

    // Feed all available context
    if (scriptContext) {
        if (scriptContext.summary) prompt += `\nVIDEO TOPIC: ${scriptContext.summary}`;
        if (scriptContext.theme) prompt += `\nTHEME: ${scriptContext.theme}`;
        if (scriptContext.visualStyle) prompt += `\nVISUAL STYLE: ${scriptContext.visualStyle}`;
        if (scriptContext.mood) prompt += `\nMOOD: ${scriptContext.mood}`;
        if (scriptContext.tone) prompt += `\nTONE: ${scriptContext.tone}`;
        if (scriptContext.emotionalArc) prompt += `\nARC: ${scriptContext.emotionalArc}`;
    }

    // User instructions BEFORE scene — they set the creative direction
    if (aiInstructionsRef) {
        prompt += `\n\nUSER INSTRUCTIONS (these control the visual look — follow them closely):
${aiInstructionsRef}`;
    }

    // Visual analysis of actual footage
    if (sceneVisual && sceneVisual.description !== 'No visual analysis available') {
        let visualNote = `\nFOOTAGE: ${sceneVisual.description}`;
        if (sceneVisual.mood) visualNote += ` | MOOD: ${sceneVisual.mood}`;
        if (sceneVisual.dominantColors) visualNote += ` | COLORS: ${sceneVisual.dominantColors}`;
        prompt += visualNote;
    }

    prompt += `\n\nScene ${sceneIndex + 1}/${totalScenes}:
NARRATION: "${scene.text}"
DURATION: ${sceneDuration}s

EFFECTS & WHEN TO USE THEM:
- vignette: dark edges → drama, focus, cinematic. Good for: serious moments, establishing shots
- grain: film noise → vintage, gritty, documentary. Good for: news, history, raw footage
- dust: floating particles → vintage, nostalgic. Good for: historical scenes, memories, old footage
- lightLeak: warm light bleed → emotional, dreamy. Good for: hopeful moments, transitions, warmth
- chromatic: RGB color split → tech, glitch, tension. Good for: tech topics, suspense, digital themes
- letterbox: cinematic bars → epic, dramatic. Good for: opening/closing, dramatic statements
- colorTint: color shift → mood setting. warm=hope/energy, cool=sadness/tech, sepia=nostalgia/history
- blurVignette: blurred edges → intimate, dreamy. Good for: personal stories, close-ups, reflection

RULES:
- Pick 0-3 effects that MATCH the mood of this scene (0 = clean look, not every scene needs effects)
- Intensity: 0.1 (barely visible) to 1.0 (strong). Keep most at 0.2-0.4 for a professional look
- For colorTint: must specify tint (warm, cool, or sepia)
- Effects should enhance the footage, not fight it
- A news video might want subtle grain + vignette. A travel video might want lightLeak + colorTint warm
- A tech video might want chromatic + colorTint cool. A documentary might want grain + letterbox`;

    if (placedEffects.length > 0) {
        const recent = [...new Set(placedEffects.slice(-6))].join(', ');
        prompt += `\nRECENT EFFECTS: ${recent} (vary your choices — don't repeat the same combo)`;
    }

    prompt += `\n\nReply ONLY in this format (1-3 lines, or just "none"):
effect: <type> | intensity: <0.1-1.0> | tint: <warm|cool|sepia|none>`;

    return prompt;
}

function parseResponse(text, scene, sceneIndex) {
    if (!text || !text.trim()) return { sceneIndex, effects: [] };

    const lines = text.trim().split('\n');
    const effects = [];

    // Type aliases for flexible matching
    const typeMap = {
        'vignette': 'vignette',
        'grain': 'grain',
        'film grain': 'grain',
        'filmgrain': 'grain',
        'noise': 'grain',
        'dust': 'dust',
        'dust and scratches': 'dust',
        'dustandscratches': 'dust',
        'scratches': 'dust',
        'lightleak': 'lightLeak',
        'light leak': 'lightLeak',
        'light_leak': 'lightLeak',
        'leak': 'lightLeak',
        'chromatic': 'chromatic',
        'chromatic aberration': 'chromatic',
        'chromaticaberration': 'chromatic',
        'rgb split': 'chromatic',
        'letterbox': 'letterbox',
        'cinematic bars': 'letterbox',
        'colortint': 'colorTint',
        'color tint': 'colorTint',
        'color_tint': 'colorTint',
        'tint': 'colorTint',
        'blurvignette': 'blurVignette',
        'blur vignette': 'blurVignette',
        'blur_vignette': 'blurVignette',
        'blur': 'blurVignette',
    };

    for (const line of lines) {
        const lower = line.toLowerCase().trim()
            .replace(/^\*+/, '').replace(/\*+$/, '')
            .replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')
            .trim();

        if (lower === 'none' || lower === 'effect: none') break;

        // Match "effect: vignette | intensity: 0.5 | tint: none"
        const effectMatch = lower.match(/effect\s*[:=\-]\s*([a-z\s]+)/);
        if (!effectMatch) continue;

        const rawType = effectMatch[1].trim().replace(/\s*\|.*$/, '');
        const type = typeMap[rawType];
        if (!type) continue;

        // Extract intensity
        let intensity = EFFECT_TYPES[type].default;
        const intensityMatch = lower.match(/intensity\s*[:=\-]\s*([\d.]+)/);
        if (intensityMatch) {
            intensity = parseFloat(intensityMatch[1]);
            intensity = Math.max(0.1, Math.min(1.0, intensity));
        }

        // Extract tint for colorTint
        let tint = 'none';
        if (type === 'colorTint') {
            const tintMatch = lower.match(/tint\s*[:=\-]\s*(warm|cool|sepia|none)/);
            tint = tintMatch ? tintMatch[1] : 'warm';
        }

        // Avoid duplicate effect types in same scene
        if (!effects.find(e => e.type === type)) {
            effects.push({ type, intensity, tint, renderMode: 'css' });
        }
    }

    // Limit to 3 effects max
    return { sceneIndex, effects: effects.slice(0, 3) };
}

// ============ PROVIDER DISPATCH ============

// ============ BATCH FALLBACK ============
// NOTE: AI providers moved to shared ai-provider.js module

async function batchFallback(scenes, scriptContext) {
    const sceneList = scenes.map((s, i) =>
        `${i}: "${s.text.substring(0, 80)}"`
    ).join('\n');

    const topic = scriptContext?.summary || 'unknown';
    const style = scriptContext?.visualStyle || '';
    const mood = scriptContext?.mood || '';

    let prompt = `Video about: ${topic}`;
    if (style) prompt += ` | Style: ${style}`;
    if (mood) prompt += ` | Mood: ${mood}`;

    if (aiInstructionsRef) {
        prompt += `\nUSER INSTRUCTIONS: ${aiInstructionsRef}`;
    }

    prompt += `\n\nScenes:
${sceneList}

Pick 3-5 scenes for visual effects. Match effects to the video's mood and style.
Reply ONE line per scene: <scene_number>|<effect1:intensity>,<effect2:intensity>

Effects: vignette, grain, dust, lightLeak, chromatic, letterbox, colorTint(warm/cool/sepia), blurVignette
Guide: news/documentary→grain+vignette, cinematic→letterbox+vignette, tech→chromatic+colorTint(cool), emotional→lightLeak+colorTint(warm)
Example: 0|vignette:0.4,grain:0.3
Reply ONLY the lines.`;

    const rawText = await callAI(prompt);
    console.log(`    [Batch raw]: ${rawText.substring(0, 120).replace(/\n/g, ' | ')}`);

    const results = [];
    const lines = rawText.trim().split('\n');

    for (const line of lines) {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length >= 2) {
            const idx = parseInt(parts[0]);
            if (isNaN(idx) || idx < 0 || idx >= scenes.length) continue;

            const effectParts = parts[1].split(',').map(s => s.trim());
            const effects = [];

            for (const ep of effectParts) {
                const [typeName, intensityStr] = ep.split(':').map(s => s.trim());
                const type = typeName && EFFECT_TYPES[typeName] ? typeName : null;
                if (!type) continue;

                let intensity = parseFloat(intensityStr) || EFFECT_TYPES[type].default;
                intensity = Math.max(0.1, Math.min(1.0, intensity));

                effects.push({ type, intensity, tint: 'none', renderMode: 'css' });
            }

            if (effects.length > 0) {
                results.push({ sceneIndex: idx, effects: effects.slice(0, 3) });
                console.log(`    🎨 [batch] Scene ${idx} → ${effects.map(e => `${e.type}(${e.intensity})`).join(', ')}`);
            }
        }
    }

    return results;
}

// ============ AI OVERLAY FILE SELECTION ============
// Selects overlay files from the local library based on video theme/content

async function selectOverlayFiles(availableOverlays, scenes, scriptContext, themeOverlayPrefs) {
    if (!availableOverlays || availableOverlays.length === 0) {
        console.log('  ℹ️  No overlay files in assets/overlays/ — skipping AI overlay selection');
        return [];
    }

    console.log(`\n🎭 AI is selecting overlays from ${availableOverlays.length} available files...`);

    // Separate files by category so images are prominent
    const imageOverlays = availableOverlays.filter(ov => ov.mediaType === 'image');
    const videoOverlays = availableOverlays.filter(ov => ov.mediaType === 'video');
    const hasImages = imageOverlays.length > 0;
    const hasVideos = videoOverlays.length > 0;
    const hasBoth = hasImages && hasVideos;

    // Build categorized file list
    let fileList = '';
    if (hasImages) {
        fileList += '  === STATIC TEXTURE OVERLAYS (images) ===\n';
        imageOverlays.forEach(ov => {
            const idx = availableOverlays.indexOf(ov);
            fileList += `  ${idx}: "${ov.name}" (${ov.ext}) — static texture layer\n`;
        });
    }
    if (hasVideos) {
        fileList += '  === ANIMATED OVERLAYS (videos) ===\n';
        videoOverlays.forEach(ov => {
            const idx = availableOverlays.indexOf(ov);
            fileList += `  ${idx}: "${ov.name}" (${ov.ext}) — animated loop\n`;
        });
    }

    const topic = scriptContext?.summary || 'unknown topic';
    const theme = scriptContext?.theme || 'general';
    const mood = scriptContext?.mood || '';
    const totalDuration = scenes.length > 0 ? scenes[scenes.length - 1].endTime : 60;
    const sceneCount = scenes.length;

    // Theme overlay preferences for guidance
    let themeHint = '';
    if (themeOverlayPrefs) {
        if (themeOverlayPrefs.preferred?.length > 0) {
            themeHint += `\nTHEME PREFERRED keywords: ${themeOverlayPrefs.preferred.join(', ')}`;
        }
        if (themeOverlayPrefs.avoid?.length > 0) {
            themeHint += `\nTHEME AVOID keywords: ${themeOverlayPrefs.avoid.join(', ')}`;
        }
        if (themeOverlayPrefs.blendMode) {
            themeHint += `\nSUGGESTED BLEND MODE: ${themeOverlayPrefs.blendMode}`;
        }
        if (themeOverlayPrefs.intensity) {
            themeHint += `\nSUGGESTED INTENSITY RANGE: ${themeOverlayPrefs.intensity.min}-${themeOverlayPrefs.intensity.max}`;
        }
    }

    let prompt = `You are a VFX artist selecting overlay files to layer on top of a video for visual style.

VIDEO: ${topic}
THEME: ${theme}${mood ? ` | MOOD: ${mood}` : ''}
DURATION: ${totalDuration.toFixed(0)}s (${sceneCount} scenes)${themeHint}`;

    if (aiInstructionsRef) {
        prompt += `\nUSER INSTRUCTIONS: ${aiInstructionsRef}`;
    }

    // Diversity rule in prompt
    const diversityRule = hasBoth
        ? `\n- **MANDATORY**: When picking 2+ overlays, you MUST pick from BOTH categories (at least 1 static image texture AND at least 1 animated video). Mixing a static texture with an animated overlay creates the best layered look.`
        : '';

    prompt += `

AVAILABLE OVERLAY FILES:
${fileList}
RULES:
- Pick 1-2 overlay files that enhance ALL clips without overpowering them
- Each overlay spans the ENTIRE video — so it MUST look good on every clip regardless of color/brightness
- STRONGLY prefer subtle/universal overlays: grain, dust, light leak, film grain, bokeh, paper texture
- AVOID heavy stylized overlays (CRT, VHS, scanlines, damaged) UNLESS the theme specifically calls for them — these clash with diverse footage
- Static image textures (.jpg, .png): paper, film texture, bokeh, subtle vignette
- Animated video overlays (.mp4): grain, dust particles, light leaks${diversityRule}
- Blend modes: screen (bright overlays), multiply (dark textures), soft-light (subtle textures)
- Intensity: keep VERY LOW (0.1-0.25). These overlays cover EVERY clip so they must be barely visible
- Heavy/stylized overlays (CRT, VHS, scanlines): MAX intensity 0.12 — they fight with footage if higher
- Pick 0 if nothing subtle enough is available

Reply ONLY in this format (1-3 lines, or just "none"):
overlay: <file_number> | intensity: <0.1-0.6> | blend: <screen|multiply|soft-light|overlay|hard-light|color-dodge>`;

    try {
        const rawText = await callAI(prompt);
        console.log(`  [AI overlay raw]: ${rawText.substring(0, 120).replace(/\n/g, ' | ')}`);
        let selections = parseOverlayResponse(rawText, availableOverlays, totalDuration);

        // Post-selection diversity enforcement: if AI only picked videos but images exist, inject one
        selections = enforceMediaDiversity(selections, availableOverlays, themeOverlayPrefs, totalDuration);
        return capHeavyOverlayIntensity(selections);
    } catch (error) {
        console.log(`  ⚠️ AI overlay selection failed: ${error.message}`);
        // Algorithmic fallback based on theme preferences
        return algorithmicOverlayFallback(availableOverlays, themeOverlayPrefs, totalDuration);
    }
}

/**
 * If AI only picked one media type but both types are available, inject a themed match from the other type.
 */
function enforceMediaDiversity(selections, availableOverlays, themeOverlayPrefs, totalDuration) {
    const imageOverlays = availableOverlays.filter(ov => ov.mediaType === 'image');
    const videoOverlays = availableOverlays.filter(ov => ov.mediaType === 'video');
    if (imageOverlays.length === 0 || videoOverlays.length === 0) return selections; // only one type available

    const hasImagePick = selections.some(s => s.mediaType === 'image');
    const hasVideoPick = selections.some(s => s.mediaType === 'video');

    if (hasImagePick && hasVideoPick) return selections; // already diverse

    // Determine which type is missing
    const missingType = hasImagePick ? 'video' : 'image';
    const candidates = missingType === 'image' ? imageOverlays : videoOverlays;
    const usedFilenames = new Set(selections.map(s => s.filename));

    // Score candidates by theme keyword match
    const preferred = themeOverlayPrefs?.preferred || [];
    let bestCandidate = null;
    let bestScore = -1;

    for (const ov of candidates) {
        if (usedFilenames.has(ov.filename)) continue;
        const lowerName = ov.name.toLowerCase();
        let score = 1; // base score so we always pick something
        for (const kw of preferred) {
            if (lowerName.includes(kw.toLowerCase())) score += 10;
        }
        const avoid = themeOverlayPrefs?.avoid || [];
        for (const kw of avoid) {
            if (lowerName.includes(kw.toLowerCase())) score -= 20;
        }
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = ov;
        }
    }

    if (bestCandidate && bestScore > 0) {
        const blendMode = bestCandidate.mediaType === 'image' ? 'multiply' : 'screen';
        const intensity = bestCandidate.mediaType === 'image' ? 0.2 : 0.25;
        const injected = {
            filename: bestCandidate.filename,
            name: bestCandidate.name,
            ext: bestCandidate.ext,
            mediaType: bestCandidate.mediaType,
            intensity,
            blendMode,
            startTime: 0,
            endTime: totalDuration,
            isLocal: true,
            sourceFile: bestCandidate.filename,
        };
        selections.push(injected);
        console.log(`  🔀 Diversity enforcement: injected ${missingType} overlay "${bestCandidate.name}" (${bestCandidate.ext})`);
    }

    return selections.slice(0, 3);
}

function parseOverlayResponse(text, availableOverlays, totalDuration) {
    if (!text || !text.trim()) return [];

    const lines = text.trim().split('\n');
    const selections = [];
    const usedFiles = new Set();

    for (const line of lines) {
        const lower = line.toLowerCase().trim()
            .replace(/^\*+/, '').replace(/\*+$/, '')
            .replace(/^-\s*/, '').replace(/^\d+\.\s*/, '')
            .trim();

        if (lower === 'none' || lower === 'overlay: none') break;

        // Match "overlay: 3 | intensity: 0.3 | blend: screen"
        const fileMatch = lower.match(/overlay\s*[:=\-]\s*(\d+)/);
        if (!fileMatch) continue;

        const fileIdx = parseInt(fileMatch[1]);
        if (fileIdx < 0 || fileIdx >= availableOverlays.length) continue;
        if (usedFiles.has(fileIdx)) continue;

        const overlay = availableOverlays[fileIdx];

        // Extract intensity
        let intensity = 0.25;
        const intensityMatch = lower.match(/intensity\s*[:=\-]\s*([\d.]+)/);
        if (intensityMatch) {
            intensity = parseFloat(intensityMatch[1]);
            intensity = Math.max(0.1, Math.min(0.6, intensity));
        }

        // Extract blend mode
        let blendMode = 'screen';
        const blendMatch = lower.match(/blend\s*[:=\-]\s*(screen|multiply|soft-light|overlay|hard-light|color-dodge|lighten|normal)/);
        if (blendMatch) blendMode = blendMatch[1];

        usedFiles.add(fileIdx);
        selections.push({
            filename: overlay.filename,
            name: overlay.name,
            ext: overlay.ext,
            mediaType: overlay.mediaType,
            intensity,
            blendMode,
            startTime: 0,
            endTime: totalDuration,
            isLocal: true,
            sourceFile: overlay.filename,
        });

        console.log(`  🎭 Selected: "${overlay.name}" (${overlay.ext}) — intensity ${intensity}, blend ${blendMode}`);
    }

    // Post-process: cap intensity of heavy/stylized overlays
    return capHeavyOverlayIntensity(selections.slice(0, 3));
}

// Heavy/stylized overlays that clash with diverse footage — cap their intensity
const HEAVY_OVERLAY_KEYWORDS = ['crt', 'vhs', 'scanline', 'damaged', 'glitch', 'tv', 'static', 'distort', 'rgb'];
const HEAVY_OVERLAY_MAX_INTENSITY = 0.12;
const UNIVERSAL_OVERLAY_MAX_INTENSITY = 0.3;

function capHeavyOverlayIntensity(selections) {
    return selections.map(s => {
        const lowerName = (s.name || s.filename || '').toLowerCase();
        const isHeavy = HEAVY_OVERLAY_KEYWORDS.some(kw => lowerName.includes(kw));
        if (isHeavy && s.intensity > HEAVY_OVERLAY_MAX_INTENSITY) {
            console.log(`  ⚠️ Capped heavy overlay "${s.name}" intensity: ${s.intensity} → ${HEAVY_OVERLAY_MAX_INTENSITY}`);
            return { ...s, intensity: HEAVY_OVERLAY_MAX_INTENSITY };
        }
        if (!isHeavy && s.intensity > UNIVERSAL_OVERLAY_MAX_INTENSITY) {
            return { ...s, intensity: UNIVERSAL_OVERLAY_MAX_INTENSITY };
        }
        return s;
    });
}

// Algorithmic fallback: pick overlays based on theme preferences when AI fails
function algorithmicOverlayFallback(availableOverlays, themeOverlayPrefs, totalDuration) {
    if (!themeOverlayPrefs?.preferred || themeOverlayPrefs.preferred.length === 0) return [];

    console.log('  🔄 Using algorithmic overlay selection (theme-based fallback)...');

    const preferred = themeOverlayPrefs.preferred || [];
    const avoid = themeOverlayPrefs.avoid || [];
    const intensity = themeOverlayPrefs.intensity || { min: 0.15, max: 0.4 };
    const blendMode = themeOverlayPrefs.blendMode || 'screen';

    // Score each overlay file by theme match
    const scored = availableOverlays.map(ov => {
        const lowerName = ov.name.toLowerCase();
        let score = 0;

        // Boost for preferred keyword matches
        for (const kw of preferred) {
            if (lowerName.includes(kw.toLowerCase())) score += 10;
        }

        // Penalize avoided keywords
        for (const kw of avoid) {
            if (lowerName.includes(kw.toLowerCase())) score -= 20;
        }

        return { ...ov, score };
    }).filter(ov => ov.score > 0)
      .sort((a, b) => b.score - a.score);

    // Pick top 2 — try to get one image + one video for diversity
    const imageScored = scored.filter(ov => ov.mediaType === 'image');
    const videoScored = scored.filter(ov => ov.mediaType === 'video');
    let picks = [];
    if (imageScored.length > 0 && videoScored.length > 0) {
        // One of each type for best layered look
        picks = [imageScored[0], videoScored[0]];
    } else {
        picks = scored.slice(0, 2);
    }
    const midIntensity = (intensity.min + intensity.max) / 2;

    const selections = picks.map(ov => ({
        filename: ov.filename,
        name: ov.name,
        ext: ov.ext,
        mediaType: ov.mediaType,
        intensity: midIntensity,
        blendMode: ov.mediaType === 'image' ? 'multiply' : blendMode,
        startTime: 0,
        endTime: totalDuration,
        isLocal: true,
        sourceFile: ov.filename,
    }));

    if (selections.length > 0) {
        console.log(`  🎭 [Algorithmic] Selected: ${selections.map(s => `"${s.name}" (${s.ext})`).join(', ')}`);
    }

    return capHeavyOverlayIntensity(selections);
}

// ============ MAIN PROCESSOR ============

async function processVisualEffects(scenes, scriptContext, visualAnalysis, aiInstructions) {
    console.log('\n🎨 AI is analyzing scenes for visual effects...');
    console.log(`📡 Using: ${config.aiProvider.toUpperCase()}\n`);

    placedEffects = [];
    aiInstructionsRef = aiInstructions || '';
    const results = [];

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneVisual = visualAnalysis ? visualAnalysis.find(v => v.sceneIndex === i) : null;
        console.log(`  Scene ${i}: "${scene.text.substring(0, 45)}..."`);

        try {
            const prompt = buildPrompt(scene, i, scenes.length, scriptContext, sceneVisual);
            const rawText = await callAI(prompt);
            console.log(`    [AI raw]: ${rawText.substring(0, 80).replace(/\n/g, ' | ')}`);
            const parsed = parseResponse(rawText, scene, i);

            if (parsed.effects.length > 0) {
                results.push(parsed);
                parsed.effects.forEach(e => placedEffects.push(e.type));
                console.log(`    🎨 ${parsed.effects.map(e => `${e.type}(${e.intensity})`).join(', ')}`);
            } else {
                console.log(`    ⏭️  No visual effects`);
            }
        } catch (error) {
            console.log(`    ⚠️ VFX analysis failed: ${error.message}`);
        }
    }

    // Fallback: if no effects were generated, try batch approach
    if (results.length === 0 && scenes.length > 0) {
        console.log('\n  🔄 No VFX from per-scene analysis. Trying batch fallback...');
        try {
            const batchResults = await batchFallback(scenes, scriptContext);
            results.push(...batchResults);
        } catch (e) {
            console.log(`    ⚠️ Batch fallback failed: ${e.message}`);
        }
    }

    console.log(`\n📊 Visual effects applied: ${results.length}/${scenes.length} scenes\n`);
    return results;
}

module.exports = { processVisualEffects, selectOverlayFiles };

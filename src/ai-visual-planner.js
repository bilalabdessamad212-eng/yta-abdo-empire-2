/**
 * AI Visual Planner Module — Step 4 of the pipeline
 *
 * Replaces ai-keywords.js with a BATCH approach.
 * Instead of calling AI once per scene (N calls), we call it ONCE for ALL scenes.
 *
 * Why batch is better:
 *   - AI sees the FULL video story arc → plans visual variety
 *   - AI understands context from ai-director.js → smarter keyword choices
 *   - 1 API call instead of N calls → faster, cheaper
 *   - Visual consistency across the video (no repetition)
 *
 * Receives from ai-director.js:
 *   - scenes: Scene[] with text, timestamps, words
 *   - scriptContext: { theme, tone, mood, pacing, format, entities, hook, CTA, etc. }
 *   - directorsBrief: Quality tier, format, audience hint
 *
 * Outputs:
 *   - Enriched scenes with:
 *     • keyword: "FBI agents raiding mansion at night"
 *     • mediaType: "video" | "image"
 *     • sourceHint: "stock" | "youtube" | "web-image"
 *     • visualIntent: "Aerial establishing shot of large mansion surrounded by police vehicles"
 *
 * Uses shared ai-provider.js for all AI calls.
 */

const { callAI } = require('./ai-provider');
const config = require('./config');
const { getMatchingBackgrounds, BACKGROUND_LIBRARY } = require('./themes');

// ============================================================
// HELPERS
// ============================================================

/**
 * Build a list of available gradient backgrounds for the AI prompt.
 * Shows backgrounds that match the current theme, plus a few extras.
 */
function _buildBackgroundList(themeId) {
    const matched = getMatchingBackgrounds(themeId || 'neutral');
    // Show top 6 matches to keep prompt concise
    const shown = matched.slice(0, 6);
    return shown.map(bg => `   - "${bg.id}" = ${bg.name}`).join('\n');
}

// ============================================================
// PROMPT BUILDER
// ============================================================

/**
 * Build the batch visual planning prompt.
 * AI sees ALL scenes at once and plans visuals with full story context.
 */
function buildBatchPrompt(scenes, scriptContext, directorsBrief) {
    const { theme, tone, mood, pacing, format, visualStyle, entities, hookEndTime, ctaDetected, ctaStartTime } = scriptContext;
    const { qualityTier, tier, audienceHint } = directorsBrief;

    // Build scene list with timing info
    let sceneList = '';
    for (const scene of scenes) {
        const duration = (scene.endTime - scene.startTime).toFixed(1);
        const period = scene.startTime < (hookEndTime || 15) ? '[HOOK]' :
                       (ctaDetected && scene.startTime >= ctaStartTime) ? '[CTA]' : '';

        sceneList += `SCENE ${scene.index} (${scene.startTime.toFixed(1)}s-${scene.endTime.toFixed(1)}s, ${duration}s) ${period}:\n`;
        sceneList += `   "${scene.text}"\n\n`;
    }

    let prompt = `You are a visual director planning B-ROLL FOOTAGE for a FACELESS VIDEO.

The AI Director has analyzed this script and provided deep context. Your job is to plan SPECIFIC, SEARCHABLE visuals for EVERY scene that:
1. Match the story's theme, mood, and pacing
2. Create visual variety across the video (don't repeat the same type of shot)
3. Use the ENTITIES and context to be specific (not generic)
4. Consider the story arc (hook → body → CTA)
5. INTELLIGENTLY mix sources: stock video, YouTube clips, and web images

${directorsBrief.freeInstructions ? `\n🔥 USER INSTRUCTIONS (HIGHEST PRIORITY — OVERRIDE ALL DEFAULTS):
${directorsBrief.freeInstructions}

↑ These instructions are MANDATORY. Follow them exactly, even if they conflict with the rules below.\n` : ''}

DIRECTOR'S ANALYSIS:
- Theme: ${theme || 'general'}
- Tone: ${tone || 'informative'}
- Mood: ${mood || 'neutral'}
- Pacing: ${pacing || 'moderate'}
- Visual Style: ${visualStyle || 'cinematic'}
- Format: ${format}
${entities.length > 0 ? `- Key Entities: ${entities.join(', ')}` : ''}
${hookEndTime ? `- Hook Period: 0-${hookEndTime}s (needs strong visuals to grab attention)` : ''}
${ctaDetected ? `- CTA Period: ${ctaStartTime}s-end (wind down, show branding/channel elements)` : ''}
${audienceHint ? `- Target Audience: ${audienceHint}` : ''}

QUALITY TIER: ${qualityTier}
${tier.allowVideo ? '- Can use VIDEO clips (preferred for motion and impact)' : '- IMAGES ONLY (no video allowed)'}

SCENES TO PLAN (${scenes.length} total):

${sceneList}

PLANNING RULES:

1. VISUAL VARIETY:
   - Look at ALL scenes — plan a visual journey
   - Vary shot types: wide shots, close-ups, aerials, POV, establishing shots
   - Vary subjects: locations → people → objects → actions → data
   - NEVER use the same keyword twice
   - Example: If scene 1 shows "city skyline at night", scene 2 should show something different like "police car with flashing lights"

2. CONTENT TYPE & SOURCE SELECTION (MATCH CONTENT TO BEST SOURCE):

   **Priority 1: SPECIFIC REAL PEOPLE** → web-image
   - When a scene mentions a named person → show their photo
   - Example: "Gene Hackman" → web-image

   **Priority 2: DATA/STATS** → web-image
   - Numbers, charts, graphs, infographics
   - Example: "unemployment rate chart" → web-image

   **Priority 3: REAL NEWS EVENTS** → youtube
   - Current events, breaking news, viral moments
   - Theme: ${theme} ${['politics', 'news', 'entertainment', 'sports'].includes(theme) ? '→ PREFER YOUTUBE for real footage' : ''}
   - Example: "Tesla recall announcement" → youtube

   **Priority 4: GENERIC ACTIONS** → stock
   - No specific person/event, just illustrative B-roll
   - Example: "scientists in lab" → stock

   **Priority 5: NATURE/LOCATIONS** → stock
   - Landscapes, cityscapes, establishing shots
   - Example: "Santa Fe sunset" → stock

   **CRITICAL**: Don't default to stock for everything! Actively consider if YouTube or web-image would be better.

3. SOURCE HINTS (YOU MUST ACTIVELY CHOOSE THE BEST SOURCE):

   **When to use "youtube":**
   - Real news events, breaking stories, press conferences
   - Viral moments, trending topics, social media incidents
   - Interviews, speeches, public appearances
   - Specific documented events (protests, disasters, ceremonies)
   - Documentary footage of real places/events
   - Theme: news, politics, entertainment, sports → prefer YouTube
   - Example: "2024 presidential debate" → YouTube
   - Example: "Tesla Cybertruck reveal" → YouTube

   **When to use "stock":**
   - Generic actions (walking, working, cooking, driving)
   - Nature scenes (sunsets, mountains, oceans, forests)
   - Abstract concepts (technology, business, lifestyle)
   - Establishing shots (cityscapes, buildings, interiors)
   - No specific person/event mentioned
   - Theme: nature, lifestyle, technology, business → prefer stock
   - Example: "woman typing on laptop" → stock
   - Example: "aerial view of forest" → stock

   **When to use "web-image":**
   - Specific real people (photos, portraits, headshots)
   - Data visualizations (charts, graphs, infographics)
   - Historical photos, archival images
   - Product images, logos, branding
   - Screenshots, diagrams, technical illustrations
   - Example: "Elon Musk portrait" → web-image
   - Example: "global warming temperature chart" → web-image

4. MEDIA TYPE SELECTION:
${tier.allowVideo
    ? `   - Prefer VIDEO for: action scenes, locations, events, motion-heavy moments
   - Use IMAGE for: data/stats, specific people, charts, historical photos`
    : `   - IMAGES ONLY (quality tier: ${qualityTier})`}

5. HOOK PERIOD (first ${hookEndTime || 15}s):
   - Use STRONG, ATTENTION-GRABBING visuals
   - Prefer dynamic VIDEO over static images
   - Match the emotional hook (if dramatic → intense visuals, if mysterious → dark/intriguing)

6. CTA PERIOD (${ctaDetected ? `${ctaStartTime}s onwards` : 'N/A'}):
   - Wind down with calmer visuals
   - Can show branding elements, channel graphics, recap moments

7. ENTITY AWARENESS (CRITICAL):
   - **PEOPLE**: When a scene mentions a REAL PERSON by name → you MUST show THEIR PHOTO
     ${entities.length > 0 ? `• Key people in this story: ${entities.slice(0, 5).join(', ')}` : ''}
     • Use mediaType: "image" (photos of people are images, not video)
     • Use sourceHint: "web-image" (Google Images has their photos)
     • Use their REAL NAME in keyword (e.g., "Gene Hackman portrait photo", "Betsy Arakawa photo")
     • Example: "They found the body of John Smith" → keyword: "John Smith photo", mediaType: image, sourceHint: web-image
   - **LOCATIONS**: Use specific place names (e.g., "Santa Fe mansion" not "luxury house")
   - **COMPANIES**: Show their products/branding (e.g., "Tesla Model 3" not "electric car")
   - **GENERIC ACTIONS**: When NO specific entity mentioned → stock footage is OK
   - Be SPECIFIC, not generic! Use the entity names we found!

8. VISUAL INTENT:
   - Describe the EXACT shot you want
   - Include: camera angle, lighting, subject, action, mood
   - Example: "Aerial drone shot of abandoned mansion at twilight with police tape"
   - Example: "Close-up of hands typing on laptop keyboard, data on screen, dark room"

9. FRAMING (how the footage fills the 16:9 frame):
   - "fullscreen" = media fills the entire frame edge-to-edge (DEFAULT for most scenes)
   - "cinematic" = slightly pulled back (~88% scale) with a styled background visible behind the footage

   USE "fullscreen" FOR (MOST scenes should be this):
   - Generic B-roll: cityscapes, nature, actions, establishing shots
   - Stock video footage — it's already 16:9, looks best filling the frame
   - Any scene where the visual works as a full-bleed background

   USE "cinematic" ONLY FOR these specific cases:
   - Web images of REAL PEOPLE (portraits, headshots) — gives breathing room, looks polished
   - Screenshots, charts, data images, infographics — important content at edges would be cropped
   - News footage with on-screen graphics/tickers — don't crop out the lower-third
   - Historical photos, archival images — respect the original framing
   - Any image where the subject is CENTERED and cropping edges would lose important detail

   IMPORTANT: Do NOT overuse "cinematic"! Most scenes (70%+) should be "fullscreen".
   Only use "cinematic" when there's a clear reason the edges matter.

10. BACKGROUND ID (only when framing is "cinematic"):
   When framing is "cinematic", choose a background that shows behind the pulled-back footage.
   - "blur" = blurred duplicate of same footage (good default)
   - Or pick from the available gradient backgrounds:
${_buildBackgroundList(theme)}
   Pick the background that best matches the scene mood. Use "blur" as safe default if unsure.
   When framing is "fullscreen", set backgroundId to "none".

OUTPUT FORMAT (one line per scene):

SCENE 0: keyword: <searchable keyword phrase> | mediaType: <video|image> | sourceHint: <stock|youtube|web-image> | framing: <fullscreen|cinematic> | backgroundId: <none|blur|gradient-id> | visualIntent: <detailed shot description>
SCENE 1: keyword: <searchable keyword phrase> | mediaType: <video|image> | sourceHint: <stock|youtube|web-image> | framing: <fullscreen|cinematic> | backgroundId: <none|blur|gradient-id> | visualIntent: <detailed shot description>
...

CRITICAL: YOU MUST OUTPUT EXACTLY ${scenes.length} LINES (one per scene).
Each keyword must be UNIQUE and SEARCHABLE.`;

    return prompt;
}

// ============================================================
// RESPONSE PARSING
// ============================================================

/**
 * Parse the batch visual plan response.
 * Extracts keyword, mediaType, sourceHint, visualIntent for each scene.
 */
function parseBatchResponse(rawText, scenes) {
    const enrichedScenes = [];
    const lines = rawText.trim().split('\n').filter(line => {
        const lower = line.toLowerCase().trim();
        return lower.startsWith('scene ') && lower.includes(':');
    });

    for (let i = 0; i < scenes.length; i++) {
        const scene = { ...scenes[i] };

        // Find the matching line (may not be in perfect order)
        let matchedLine = lines.find(line => {
            const match = line.match(/scene\s+(\d+)/i);
            return match && parseInt(match[1]) === i;
        });

        if (!matchedLine && lines[i]) {
            matchedLine = lines[i]; // Fallback to positional match
        }

        if (matchedLine) {
            // Remove "SCENE N: " prefix first
            let content = matchedLine.substring(matchedLine.indexOf(':') + 1).trim();

            // Parse: keyword: X | mediaType: Y | sourceHint: Z | visualIntent: W
            const parts = content.split('|').map(p => p.trim());

            for (const part of parts) {
                const lower = part.toLowerCase();

                if (lower.startsWith('keyword:')) {
                    scene.keyword = part.substring(part.indexOf(':') + 1).trim();
                }
                if (lower.startsWith('mediatype:') || lower.startsWith('media type:')) {
                    const val = part.substring(part.indexOf(':') + 1).trim().toLowerCase();
                    scene.mediaType = val === 'video' ? 'video' : 'image';
                }
                if (lower.startsWith('sourcehint:') || lower.startsWith('source hint:')) {
                    const val = part.substring(part.indexOf(':') + 1).trim().toLowerCase();
                    if (['stock', 'youtube', 'web-image'].includes(val)) {
                        scene.sourceHint = val;
                    }
                }
                if (lower.startsWith('visualintent:') || lower.startsWith('visual intent:')) {
                    scene.visualIntent = part.substring(part.indexOf(':') + 1).trim();
                }
                if (lower.startsWith('background:')) {
                    const val = part.substring(part.indexOf(':') + 1).trim().toLowerCase();
                    if (['blur', 'none'].includes(val)) {
                        scene.background = val;
                    }
                }
                if (lower.startsWith('framing:')) {
                    const val = part.substring(part.indexOf(':') + 1).trim().toLowerCase();
                    if (['fullscreen', 'cinematic'].includes(val)) {
                        scene.framing = val;
                    }
                }
                if (lower.startsWith('backgroundid:') || lower.startsWith('background id:')) {
                    const val = part.substring(part.indexOf(':') + 1).trim().toLowerCase();
                    scene.backgroundId = val;
                }
            }
        }

        // Fallback: Generate keyword from scene text if missing
        if (!scene.keyword || scene.keyword.length < 3) {
            scene.keyword = extractFallbackKeyword(scene.text);
        }

        // Default values
        scene.mediaType = scene.mediaType || 'video';
        scene.sourceHint = scene.sourceHint || 'stock';
        scene.framing = scene.framing || 'fullscreen';
        // Derive background from framing + backgroundId
        if (!scene.background) {
            if (scene.framing === 'cinematic') {
                const bgId = scene.backgroundId || 'blur';
                if (bgId === 'blur') {
                    scene.background = 'blur';
                } else if (bgId === 'none') {
                    scene.background = 'none';
                } else if (BACKGROUND_LIBRARY[bgId]) {
                    scene.background = `gradient:${bgId}`;
                } else {
                    scene.background = 'blur'; // Unknown ID, fall back to blur
                }
            } else {
                scene.background = 'none';
            }
        }
        scene.visualIntent = scene.visualIntent || scene.keyword;

        enrichedScenes.push(scene);
    }

    return enrichedScenes;
}

/**
 * Extract a fallback keyword from scene text (used when AI fails).
 * Takes the most important nouns/verbs from the scene.
 */
function extractFallbackKeyword(text) {
    // Remove common words
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their']);

    const words = text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));

    // Take first 3-4 meaningful words
    const keyword = words.slice(0, 4).join(' ');
    return keyword.length > 0 ? keyword : text.substring(0, 50);
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Plan visuals for ALL scenes in one batch AI call.
 * Uses scriptContext from ai-director.js for intelligent planning.
 *
 * @param {Array} scenes - Scenes from ai-director.js
 * @param {Object} scriptContext - Director's analysis
 * @param {Object} directorsBrief - Quality tier, format, audience
 * @returns {Promise<Array>} Enriched scenes with visual planning
 */
async function planVisuals(scenes, scriptContext, directorsBrief) {
    console.log(`\n🎨 Visual Planner — Step 4`);
    console.log(`📡 Provider: ${config.aiProvider.toUpperCase()}`);
    console.log(`🎬 Planning visuals for ${scenes.length} scenes`);
    console.log(`🧠 Using director's context: theme=${scriptContext.theme}, mood=${scriptContext.mood}, pacing=${scriptContext.pacing}`);
    console.log('');

    // Ollama (local models) can't handle large batches — chunk into groups of 8
    const isOllama = (config.aiProvider || 'ollama') === 'ollama';
    const OLLAMA_CHUNK_SIZE = 8;

    if (isOllama && scenes.length > OLLAMA_CHUNK_SIZE) {
        return await _planVisualsChunked(scenes, scriptContext, directorsBrief, OLLAMA_CHUNK_SIZE);
    }

    try {
        const prompt = buildBatchPrompt(scenes, scriptContext, directorsBrief);

        // Batch call for ALL scenes
        const maxTokens = Math.max(800, scenes.length * 80); // ~80 tokens per scene
        const rawText = await callAI(prompt, { maxTokens });

        if (!rawText) throw new Error('Empty AI response');

        console.log(`   [AI Response Preview]:\n${rawText.substring(0, 400)}${rawText.length > 400 ? '...' : ''}\n`);

        const enrichedScenes = parseBatchResponse(rawText, scenes);

        // Log results
        console.log(`   ✅ Visual plan created for ${enrichedScenes.length} scenes:\n`);
        for (const scene of enrichedScenes.slice(0, 5)) { // Show first 5
            console.log(`      Scene ${scene.index}: "${scene.keyword}" [${scene.mediaType}, ${scene.sourceHint}]`);
        }
        if (enrichedScenes.length > 5) {
            console.log(`      ... and ${enrichedScenes.length - 5} more scenes`);
        }
        console.log('');

        return enrichedScenes;

    } catch (error) {
        console.log(`   ❌ Batch visual planning failed: ${error.message}`);
        console.log('   ↩️ Falling back to per-scene planning...\n');

        // Fallback: Plan each scene individually
        return await planVisualsPerScene(scenes, scriptContext, directorsBrief);
    }
}

/**
 * Chunked batch planning for Ollama — splits scenes into smaller groups
 * so the local model can handle each batch without timing out.
 * Only used when provider is Ollama and scene count exceeds chunk size.
 */
async function _planVisualsChunked(scenes, scriptContext, directorsBrief, chunkSize) {
    const chunks = [];
    for (let i = 0; i < scenes.length; i += chunkSize) {
        chunks.push(scenes.slice(i, i + chunkSize));
    }

    console.log(`   🔀 Ollama mode: splitting ${scenes.length} scenes into ${chunks.length} batches of ~${chunkSize}\n`);

    const allEnriched = [];

    for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];
        console.log(`   📦 Batch ${c + 1}/${chunks.length} (scenes ${chunk[0].index}-${chunk[chunk.length - 1].index})...`);

        try {
            const prompt = buildBatchPrompt(chunk, scriptContext, directorsBrief);
            const maxTokens = Math.max(800, chunk.length * 80);
            const rawText = await callAI(prompt, { maxTokens });

            if (!rawText) throw new Error('Empty AI response');

            const enriched = parseBatchResponse(rawText, chunk);
            allEnriched.push(...enriched);

            for (const scene of enriched) {
                console.log(`      Scene ${scene.index}: "${scene.keyword}" [${scene.mediaType}, ${scene.sourceHint}]`);
            }
        } catch (error) {
            console.log(`      ⚠️ Batch ${c + 1} failed: ${error.message}, falling back to per-scene...`);
            // Fallback: do this chunk's scenes one by one
            for (const scene of chunk) {
                try {
                    const prompt = buildSingleScenePrompt(scene, scriptContext, directorsBrief);
                    const rawText = await callAI(prompt, { maxTokens: 100 });
                    const parsed = parseSingleSceneResponse(rawText, scene);
                    allEnriched.push(parsed);
                    console.log(`      Scene ${scene.index}: "${parsed.keyword}" [${parsed.mediaType}]`);
                } catch (err) {
                    allEnriched.push({
                        ...scene,
                        keyword: extractFallbackKeyword(scene.text),
                        mediaType: 'video',
                        sourceHint: 'stock',
                        visualIntent: scene.text
                    });
                    console.log(`      Scene ${scene.index}: fallback keyword`);
                }
            }
        }
    }

    console.log(`\n   ✅ Visual plan created for ${allEnriched.length} scenes\n`);
    return allEnriched;
}

// ============================================================
// FALLBACK: PER-SCENE PLANNING
// ============================================================

/**
 * Fallback to old per-scene approach if batch fails.
 * Still uses scriptContext for smarter decisions than old ai-keywords.js.
 */
async function planVisualsPerScene(scenes, scriptContext, directorsBrief) {
    const enrichedScenes = [];

    for (const scene of scenes) {
        const prompt = buildSingleScenePrompt(scene, scriptContext, directorsBrief);

        try {
            const rawText = await callAI(prompt, { maxTokens: 100 });
            const parsed = parseSingleSceneResponse(rawText, scene);
            enrichedScenes.push(parsed);
            console.log(`   Scene ${scene.index}: "${parsed.keyword}" [${parsed.mediaType}]`);
        } catch (error) {
            // Ultimate fallback: extract from text
            enrichedScenes.push({
                ...scene,
                keyword: extractFallbackKeyword(scene.text),
                mediaType: 'video',
                sourceHint: 'stock',
                visualIntent: scene.text
            });
            console.log(`   Scene ${scene.index}: fallback keyword`);
        }
    }

    console.log('');
    return enrichedScenes;
}

/**
 * Build prompt for a single scene (fallback mode).
 */
function buildSingleScenePrompt(scene, scriptContext, directorsBrief) {
    const { theme, mood, entities } = scriptContext;
    const { tier } = directorsBrief;

    return `You are planning B-ROLL for a ${theme || 'general'} video with ${mood || 'neutral'} mood.

SCENE TEXT: "${scene.text}"
${entities.length > 0 ? `KEY ENTITIES: ${entities.join(', ')}` : ''}

OUTPUT FORMAT (one line):
keyword: <searchable keyword> | mediaType: <${tier.allowVideo ? 'video|image' : 'image'}> | sourceHint: <stock|youtube|web-image>`;
}

/**
 * Parse single scene response.
 */
function parseSingleSceneResponse(rawText, scene) {
    const enriched = { ...scene };
    const parts = rawText.split('|').map(p => p.trim());

    for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower.startsWith('keyword:')) {
            enriched.keyword = part.substring(part.indexOf(':') + 1).trim();
        }
        if (lower.startsWith('mediatype:')) {
            enriched.mediaType = part.substring(part.indexOf(':') + 1).trim().toLowerCase() === 'video' ? 'video' : 'image';
        }
        if (lower.startsWith('sourcehint:')) {
            const val = part.substring(part.indexOf(':') + 1).trim().toLowerCase();
            if (['stock', 'youtube', 'web-image'].includes(val)) enriched.sourceHint = val;
        }
    }

    enriched.keyword = enriched.keyword || extractFallbackKeyword(scene.text);
    enriched.mediaType = enriched.mediaType || 'video';
    enriched.sourceHint = enriched.sourceHint || 'stock';
    enriched.framing = enriched.framing || 'fullscreen';
    if (!enriched.background) {
        enriched.background = enriched.framing === 'cinematic' ? 'blur' : 'none';
    }
    enriched.visualIntent = enriched.visualIntent || enriched.keyword;

    return enriched;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    planVisuals,
    buildBatchPrompt,
    parseBatchResponse,
    extractFallbackKeyword
};

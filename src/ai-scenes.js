const axios = require('axios');
const config = require('./config');
const { parseContextResponse } = require('./ai-context');
const { postNvidiaChatCompletion } = require('./nvidia-client');

/**
 * AI-driven scene creation module.
 * Reads the full narration script and intelligently splits it into scenes
 * based on meaning, pacing, and user instructions.
 * Also extracts script context (summary, theme, mood, etc.) in the same call.
 *
 * Replaces the old "1 Whisper segment = 1 scene" approach.
 */

// ============ PROMPT ============

function buildScenePrompt(fullScript, audioDuration, aiInstructions) {
    let prompt = `You are a video director. Read this narration script and:
1. Analyze its content (topic, theme, mood, visual style)
2. Split it into SCENES — each scene = one visual moment (one shot/image on screen)

SCRIPT:
"${fullScript}"

AUDIO DURATION: ${audioDuration.toFixed(1)} seconds`;

    if (aiInstructions) {
        prompt += `\n\nUSER INSTRUCTIONS (follow these closely):
${aiInstructions}`;
    }

    prompt += `\n
SCENE SPLITTING RULES:
- Each scene = ONE visual idea. Cut when the topic changes, a new person is mentioned, a new event starts, or a new visual is needed.
- Think like a film editor: where would you CUT to a new shot?
- Typical scene length: 3-7 seconds. Scenes shorter than 2s feel rushed. Scenes longer than 10s are boring.
- For fast-paced content (news, action): aim for 3-4 second scenes
- For slow-paced content (mystery, documentary, emotional): aim for 5-8 second scenes
- Scene boundaries should fall at natural sentence or clause breaks — NEVER mid-word or mid-phrase
- The FIRST scene starts at the beginning of the script
- ALL scenes together must cover the ENTIRE script — no gaps, no missing text
- Each scene should have enough text for the viewer to understand what's being shown

IMPORTANT: For each scene, write the EXACT first 5-6 words as they appear in the script. These words will be used to find the precise timestamp, so they must EXACTLY match the script text.

Reply in EXACTLY this format:
summary: <1 sentence, max 20 words, what this video is about>
theme: <one of: technology|history|finance|science|health|travel|politics|entertainment|education|sports|nature|business|lifestyle|motivation|crime|mystery>
tone: <one of: informative|dramatic|casual|urgent|inspirational|educational|serious|lighthearted|emotional|suspenseful>
mood: <one of: dark|uplifting|tense|calm|energetic|nostalgic|hopeful|mysterious|intense|playful>
pacing: <one of: fast|moderate|slow>
visualStyle: <one of: cinematic|documentary|corporate|lifestyle|abstract|nature|urban|tech|vintage|minimalist>
entities: <comma-separated key people, companies, places, or "none">
stats: <comma-separated key numbers/statistics mentioned, or "none">
scenes: <total number of scenes>
---
SCENE 1: <exact first 5-6 words from the script>
SCENE 2: <exact first 5-6 words from the script>
SCENE 3: <exact first 5-6 words from the script>
...`;

    return prompt;
}

// ============ WORD MATCHING ============

/**
 * Normalize text for comparison — lowercase, remove punctuation, collapse spaces
 */
function normalize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Find the index in allWords where the anchor text starts.
 * Uses sliding window matching with fuzzy tolerance.
 *
 * @param {string} anchorText - The first few words of a scene (from AI output)
 * @param {Array} allWords - All words with timestamps from Whisper
 * @param {number} searchFrom - Start searching from this index (scenes are sequential)
 * @returns {number} Index in allWords where this scene starts, or -1 if not found
 */
function findWordIndex(anchorText, allWords, searchFrom) {
    const anchorParts = normalize(anchorText).split(/\s+/).filter(Boolean);
    if (anchorParts.length === 0) return -1;

    let bestIndex = -1;
    let bestScore = 0;
    const windowSize = anchorParts.length;

    // Search from searchFrom to end of words
    for (let i = searchFrom; i <= allWords.length - Math.min(windowSize, 2); i++) {
        let matchCount = 0;
        const maxCheck = Math.min(windowSize, allWords.length - i);

        for (let j = 0; j < maxCheck; j++) {
            const wordNorm = normalize(allWords[i + j].word);
            const anchorNorm = anchorParts[j];
            if (wordNorm === anchorNorm) {
                matchCount++;
            } else if (wordNorm.includes(anchorNorm) || anchorNorm.includes(wordNorm)) {
                matchCount += 0.7; // Partial match (Whisper might transcribe slightly differently)
            }
        }

        const score = matchCount / anchorParts.length;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }

        // Perfect or near-perfect match — stop early
        if (score >= 0.85) break;
    }

    // Require at least 50% match to accept
    return bestScore >= 0.5 ? bestIndex : -1;
}

// ============ RESPONSE PARSING ============

/**
 * Parse the AI response into script context + scene boundaries,
 * then map scene boundaries to exact word timestamps.
 */
function parseSceneResponse(aiText, allWords, audioDuration, fps) {
    if (!aiText) return null;

    // Split on the --- separator
    const parts = aiText.split('---');
    const contextPart = parts[0] || '';
    const scenesPart = parts[1] || '';

    // Parse context using the existing ai-context parser
    const scriptContext = parseContextResponse(contextPart);

    // Also extract scene count from context part
    const scenesCountMatch = contextPart.match(/scenes:\s*(\d+)/i);
    const expectedScenes = scenesCountMatch ? parseInt(scenesCountMatch[1]) : 0;

    // Parse scene boundaries
    const sceneLines = scenesPart.trim().split('\n').filter(line => {
        const lower = line.toLowerCase().trim();
        return lower.startsWith('scene ') && lower.includes(':');
    });

    if (sceneLines.length === 0) {
        console.log('   ⚠️ AI returned no scene boundaries');
        return null;
    }

    // Extract anchor text for each scene
    const sceneAnchors = sceneLines.map(line => {
        // "SCENE 1: federal agents cut through the" → "federal agents cut through the"
        const colonIndex = line.indexOf(':');
        return colonIndex >= 0 ? line.substring(colonIndex + 1).trim() : '';
    }).filter(Boolean);

    console.log(`   📊 AI planned ${sceneAnchors.length} scenes (expected: ${expectedScenes || '?'})`);

    // Map each anchor to word timestamps
    const scenes = [];
    let searchFrom = 0;

    for (let i = 0; i < sceneAnchors.length; i++) {
        const anchor = sceneAnchors[i];
        const wordIdx = findWordIndex(anchor, allWords, searchFrom);

        if (wordIdx >= 0) {
            scenes.push({ wordIndex: wordIdx, anchor });
            searchFrom = wordIdx + 1; // Next scene must start after this one
            console.log(`   ✅ Scene ${i}: "${anchor}" → word #${wordIdx} @${allWords[wordIdx].start.toFixed(2)}s`);
        } else {
            console.log(`   ⚠️ Scene ${i}: "${anchor}" → no match found, will interpolate`);
            scenes.push({ wordIndex: -1, anchor });
        }
    }

    // Fix unmatched scenes by interpolation
    for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].wordIndex === -1) {
            // Find nearest matched scenes before and after
            const prevIdx = i > 0 ? scenes[i - 1].wordIndex : 0;
            const nextIdx = findNextMatched(scenes, i, allWords.length - 1);
            // Place evenly between prev and next
            const stepsToNext = countUnmatched(scenes, i);
            const step = Math.floor((nextIdx - prevIdx) / (stepsToNext + 1));
            scenes[i].wordIndex = Math.min(prevIdx + step, allWords.length - 1);
            console.log(`   🔧 Interpolated Scene ${i} → word #${scenes[i].wordIndex} @${allWords[scenes[i].wordIndex].start.toFixed(2)}s`);
        }
    }

    // Build final scene objects
    const finalScenes = [];
    for (let i = 0; i < scenes.length; i++) {
        const startWordIdx = scenes[i].wordIndex;
        const endWordIdx = i < scenes.length - 1 ? scenes[i + 1].wordIndex : allWords.length;

        const startTime = allWords[startWordIdx].start;
        const endTime = i < scenes.length - 1
            ? allWords[scenes[i + 1].wordIndex].start
            : audioDuration;

        // Collect words for this scene
        const sceneWords = allWords.slice(startWordIdx, endWordIdx);
        const text = sceneWords.map(w => w.word).join(' ').trim();

        finalScenes.push({
            index: i,
            text: text,
            startTime: startTime,
            endTime: endTime,
            duration: Math.round((endTime - startTime) * fps),
            words: sceneWords
        });
    }

    // Ensure last scene extends to audio end
    if (finalScenes.length > 0) {
        const last = finalScenes[finalScenes.length - 1];
        if (audioDuration > last.endTime + 0.3) {
            last.endTime = audioDuration;
            last.duration = Math.round((last.endTime - last.startTime) * fps);
        }
    }

    return { scenes: finalScenes, scriptContext };
}

/**
 * Find the next matched scene's word index after position i
 */
function findNextMatched(scenes, fromIdx, maxWordIdx) {
    for (let j = fromIdx + 1; j < scenes.length; j++) {
        if (scenes[j].wordIndex >= 0) return scenes[j].wordIndex;
    }
    return maxWordIdx;
}

/**
 * Count consecutive unmatched scenes starting from position i
 */
function countUnmatched(scenes, fromIdx) {
    let count = 0;
    for (let j = fromIdx; j < scenes.length; j++) {
        if (scenes[j].wordIndex === -1) count++;
        else break;
    }
    return count;
}

// ============ FALLBACK: OLD WHISPER-BASED SCENES ============

function createScenesFromWhisper(transcription) {
    const fps = config.video.fps;
    const segments = transcription.segments || [];
    const audioDuration = transcription.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);

    const scenes = segments.map((segment, index) => ({
        index: index,
        text: segment.text,
        startTime: segment.start,
        endTime: segment.end,
        duration: Math.round((segment.end - segment.start) * fps),
        words: segment.words || []
    }));

    // Extend last scene to cover full audio
    if (scenes.length > 0) {
        const lastSegEnd = segments[segments.length - 1].end;
        if (audioDuration > lastSegEnd + 0.5) {
            scenes[scenes.length - 1].endTime = audioDuration;
            scenes[scenes.length - 1].duration = Math.round((audioDuration - scenes[scenes.length - 1].startTime) * fps);
        }
    }

    return scenes;
}

// ============ AI PROVIDER DISPATCH ============

async function callAI(prompt) {
    switch (config.aiProvider) {
        case 'ollama':   return await callOllama(prompt);
        case 'claude':   return await callClaude(prompt);
        case 'openai':   return await callOpenAI(prompt);
        case 'deepseek': return await callDeepSeek(prompt);
        case 'qwen':     return await callQwen(prompt);
        case 'nvidia':   return await callNvidia(prompt);
        case 'gemini':   return await callGemini(prompt);
        default:         return await callOllama(prompt);
    }
}

// Token budget: ~500 for context + ~20 per scene line. 800 is generous for most videos.
const MAX_TOKENS = 800;

async function callOllama(prompt) {
    const response = await axios.post(`${config.ollama.baseUrl}/api/generate`, {
        model: config.ollama.model, prompt, stream: false
    });
    return response.data.response;
}

async function callClaude(prompt) {
    if (!config.claude.apiKey) throw new Error('Claude API key not set');
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: config.claude.model, max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }]
    }, {
        headers: { 'x-api-key': config.claude.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    });
    return response.data.content[0].text;
}

async function callOpenAI(prompt) {
    if (!config.openai.apiKey) throw new Error('OpenAI API key not set');
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: config.openai.model, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS
    }, {
        headers: { 'Authorization': `Bearer ${config.openai.apiKey}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
}

async function callDeepSeek(prompt) {
    if (!config.deepseek.apiKey) throw new Error('DeepSeek API key not set');
    const response = await axios.post('https://api.deepseek.com/chat/completions', {
        model: config.deepseek.model, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS
    }, {
        headers: { 'Authorization': `Bearer ${config.deepseek.apiKey}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
}

async function callQwen(prompt) {
    if (!config.qwen.apiKey) throw new Error('Qwen API key not set');
    const response = await axios.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        model: config.qwen.model, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS
    }, {
        headers: { 'Authorization': `Bearer ${config.qwen.apiKey}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
}

async function callGemini(prompt) {
    if (!config.gemini.apiKey) throw new Error('Gemini API key not set');
    const response = await axios.post(`${config.gemini.baseUrl}/chat/completions`, {
        model: config.gemini.model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 2048
    }, {
        headers: { 'Authorization': `Bearer ${config.gemini.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });
    const choice = response.data.choices && response.data.choices[0];
    return choice?.message?.content || '';
}

async function callNvidia(prompt) {
    const response = await postNvidiaChatCompletion({
        model: config.nvidia.model, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS
    });
    return response.data.choices[0].message.content;
}

// ============ MAIN EXPORT ============

/**
 * Main entry point: AI reads the full script and creates intelligent scenes.
 * Falls back to Whisper segments if AI fails.
 *
 * @param {Object} transcription - Whisper output: { text, duration, segments: [{ text, start, end, words }] }
 * @param {string} aiInstructions - User's AI instructions (optional)
 * @returns {{ scenes: Array, scriptContext: Object }}
 */
async function createScenesFromAI(transcription, aiInstructions) {
    const fps = config.video.fps;
    const segments = transcription.segments || [];
    const audioDuration = transcription.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);

    // Collect all words with timestamps from all segments
    const allWords = [];
    for (const seg of segments) {
        if (seg.words && seg.words.length > 0) {
            allWords.push(...seg.words);
        }
    }

    const fullScript = allWords.length > 0
        ? allWords.map(w => w.word).join(' ').trim()
        : segments.map(s => s.text).join(' ').trim();

    console.log(`\n🎬 AI Scene Director`);
    console.log(`📡 Using: ${config.aiProvider.toUpperCase()}`);
    console.log(`📝 Script: ${fullScript.length} chars, ${audioDuration.toFixed(1)}s, ${allWords.length} words\n`);

    // If no word-level timestamps, fall back to Whisper segments
    if (allWords.length === 0) {
        console.log('   ⚠️ No word-level timestamps available — falling back to Whisper segments');
        const scenes = createScenesFromWhisper(transcription);
        const basicContext = { summary: fullScript.substring(0, 80).trim(), theme: '', tone: '', mood: '', pacing: 'moderate', visualStyle: 'cinematic', entities: [], keyStats: [], mainPoints: [], targetAudience: '', emotionalArc: '' };
        return { scenes, scriptContext: basicContext };
    }

    try {
        const prompt = buildScenePrompt(fullScript, audioDuration, aiInstructions);
        const rawText = await callAI(prompt);

        if (!rawText) throw new Error('Empty AI response');

        console.log(`   [AI raw response]:\n${rawText.substring(0, 500)}${rawText.length > 500 ? '...' : ''}\n`);

        const result = parseSceneResponse(rawText, allWords, audioDuration, fps);

        if (!result || !result.scenes || result.scenes.length === 0) {
            throw new Error('AI returned no valid scenes');
        }

        // Log context
        const ctx = result.scriptContext;
        console.log(`\n   📌 Context:`);
        console.log(`      Summary: "${ctx.summary || 'unknown'}"`);
        console.log(`      Theme: ${ctx.theme || '?'} | Tone: ${ctx.tone || '?'} | Mood: ${ctx.mood || '?'}`);
        console.log(`      Pacing: ${ctx.pacing || '?'} | Style: ${ctx.visualStyle || '?'}`);
        if (ctx.entities && ctx.entities.length > 0) console.log(`      Entities: ${ctx.entities.join(', ')}`);

        // Log scenes
        console.log(`\n   🎬 Scenes created: ${result.scenes.length}`);
        for (const s of result.scenes) {
            const dur = (s.endTime - s.startTime).toFixed(1);
            console.log(`      Scene ${s.index}: ${s.startTime.toFixed(2)}s - ${s.endTime.toFixed(2)}s (${dur}s) "${s.text.substring(0, 50)}..."`);
        }
        console.log('');

        return result;

    } catch (error) {
        console.log(`   ❌ AI scene creation failed: ${error.message}`);
        console.log('   ↩️ Falling back to Whisper segments...\n');

        const scenes = createScenesFromWhisper(transcription);

        // Try to get at least basic context
        let basicContext = { summary: fullScript.substring(0, 80).trim(), theme: '', tone: '', mood: '', pacing: 'moderate', visualStyle: 'cinematic', entities: [], keyStats: [], mainPoints: [], targetAudience: '', emotionalArc: '' };

        return { scenes, scriptContext: basicContext };
    }
}

module.exports = {
    createScenesFromAI,
    createScenesFromWhisper,
    buildScenePrompt,
    parseSceneResponse,
    findWordIndex,
    normalize
};

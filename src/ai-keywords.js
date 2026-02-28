const axios = require('axios');
const config = require('./config');
const { postNvidiaChatCompletion } = require('./nvidia-client');

// Track used keywords across scenes to avoid repetition
let usedKeywords = [];
let videoContext = '';
let scriptContextRef = null;
let aiInstructionsRef = '';

function buildPrompt(sceneText) {
    let prompt = `You are choosing footage for a video. Pick a search keyword that will find the BEST matching video clip on a stock footage site.\n`;

    // Feed all available context from ai-context.js
    if (scriptContextRef) {
        if (scriptContextRef.summary) prompt += `\nVIDEO TOPIC: ${scriptContextRef.summary}`;
        if (scriptContextRef.theme) prompt += `\nTHEME: ${scriptContextRef.theme}`;
        if (scriptContextRef.visualStyle) prompt += `\nVISUAL STYLE: ${scriptContextRef.visualStyle}`;
        if (scriptContextRef.mood) prompt += `\nMOOD: ${scriptContextRef.mood}`;
        const entities = (scriptContextRef.entities || []).slice(0, 5).join(', ');
        if (entities) prompt += `\nKEY SUBJECTS: ${entities}`;
    } else if (videoContext) {
        prompt += `\nVIDEO TOPIC: ${videoContext}`;
    }

    // User instructions come BEFORE the scene — they set the overall direction
    if (aiInstructionsRef) {
        prompt += `\n\nUSER INSTRUCTIONS — HIGHEST PRIORITY, override all other rules below:
${aiInstructionsRef}
(If the user says "use images and videos" → you MUST actively use BOTH types, roughly 50/50. If they say "only videos" → all video. Always obey user instructions first.)`;
    }

    prompt += `\n\nNARRATION: "${sceneText}"

YOUR TASK: Pick a search keyword (1-5 words MAX) that will find the BEST visual to SHOW ON SCREEN while this narration plays.

STEP 1 — UNDERSTAND THE STORY:
Read the VIDEO TOPIC and NARRATION together. Understand what the video is ABOUT — the subject, the setting, the people, the events.
The keyword must show something that ILLUSTRATES the narration, NOT just repeat words from it.

STEP 2 — VISUALIZE THE SCENE:
Ask yourself: "If I were a film director, what would I show the viewer right now?"
- If the narrator says "they cut through the locks" → show: FBI raid on mansion, agents breaking into estate
- If the narrator says "thermal cameras picked up a heat signature" → show: thermal imaging scan building
- If the narrator says "a time capsule of impossible secrets" → show: dark underground room documents
- The keyword describes what you SEE, not what you HEAR

STEP 3 — MAKE IT SPECIFIC TO THIS VIDEO:
Your keywords should be GROUNDED in the video's topic. Use the VIDEO TOPIC, THEME, and KEY SUBJECTS.
- Crime investigation in Santa Fe → keywords should mention: FBI, investigation, mansion, Santa Fe, evidence, forensic
- California coastline collapse → keywords should mention: California, cliffs, Highway 1, Pacific Ocean
- EV market analysis → keywords should mention: electric vehicles, charging, Tesla, battery
NEVER pick generic keywords that could apply to any video. Every keyword must feel like it BELONGS in THIS specific video.

CHOOSING type: video vs type: image:
Use a MIX of both. The default is video, but images add variety.

USE IMAGE (type: image) when:
A) HARD DATA — narration has SPECIFIC numbers/percentages + year → chart/infographic
B) SPECIFIC PERSON — narration names someone by name → their photo
C) LOCATION/MAP — narration describes a place, geography, aerial view → satellite/map image
D) REAL NEWS ARTICLE — narration references a published report or news story → news screenshot
E) USER INSTRUCTIONS say to use images

USE VIDEO (type: video) when:
F) TELLING A STORY — narration describes events, actions, scenes unfolding → cinematic B-roll or YouTube footage
G) NEWS/EVENTS — announcements, policies, real-world happenings → YouTube news footage
H) PHYSICAL ACTION — destruction, construction, movement, investigation → YouTube footage
I) ATMOSPHERE/MOOD — setting the tone, general descriptions → stock B-roll

If USER INSTRUCTIONS say "use images and videos" or similar → actively mix BOTH types.

KEYWORD RULES:
- MAXIMUM 5 words. 2-4 words is ideal.
- NEVER just copy words from the narration. TRANSLATE the narration into a VISUAL SCENE.
  BAD: "finally cracked seal" (copying narration words — not searchable)
  GOOD: "opening hidden underground room" (describes what you'd SEE)
  BAD: "waiting dark wasnt" (meaningless fragments)
  GOOD: "dark secret underground bunker" (visual, searchable)
- Think: "what would a stock footage site or YouTube have that matches this?"
- For DATA images: include subject + "chart"/"data" + year
- If a person is named, use their name: "Elon Musk", "Biden press conference"
- DO NOT pick abstract words: "impact", "growth", "innovation", "anomaly"
- DO NOT pick opposite-meaning keywords (layoffs ≠ job fair)
- When specific YEARS or NUMBERS are in the narration, INCLUDE THEM in the keyword`;

    if (usedKeywords.length > 0) {
        prompt += `\nALREADY USED (pick something DIFFERENT): ${usedKeywords.join(', ')}`;
    }

    prompt += `\n\nReply with these 4 lines:
thinking: <1 sentence: what VISUAL SCENE should the viewer see right now? Describe the image/footage you want to find.>
keyword: <your search term, 1-5 words MAX>
type: <video OR image>
source: <pick ONE: stock | youtube | web-image>

SOURCE OPTIONS:
- stock: Cinematic B-roll footage. Nature, landscapes, cityscapes, lifestyle, technology.
- youtube: Real-world footage. News clips, disasters, events, factory tours, protests.
- web-image: Static images. Charts, data visualizations, maps, satellite imagery, person photos.

CRITICAL RULES:
- SPECIFIC NUMBER + YEAR in narration → type: image, source: web-image (chart/data keyword)
- Named PERSON as main subject → type: image, source: web-image (their name)
- Geography/location description → type: image, source: web-image (satellite/map) OR type: video (drone footage)
- News event/real-world happening → type: video, source: youtube
- General atmosphere/trend → type: video, source: stock
- Physical action/destruction → type: video, source: youtube

EXAMPLES — notice: keywords describe what you'd SEE, not what you HEAR. They're specific to the video topic:

[Crime investigation video — FBI raids mansion in Santa Fe]
"Federal agents cut through the locks of a $4 million estate" → keyword: FBI agents raiding mansion, type: video, source: youtube
"They were looking for answers regarding the sudden passing" → keyword: crime scene investigation house, type: video, source: stock
"Thermal cameras picked up a heat signature under the foundation" → keyword: thermal imaging building scan, type: video, source: stock
"A massive void that shouldn't exist" → keyword: underground bunker discovery, type: video, source: youtube
"It was a time capsule of impossible secrets" → keyword: hidden room old documents, type: video, source: stock
"This investigation started on February 26" → keyword: Santa Fe mansion aerial view, type: image, source: web-image

[News video — California coastline collapse]
"Highway One is literally falling into the ocean" → keyword: highway one landslide california, type: video, source: youtube
"Over a dozen locations along the coast are affected" → keyword: california coastline aerial map, type: image, source: web-image
"Residents have been forced to evacuate" → keyword: coastal home evacuation california, type: video, source: youtube

[Data video — electric vehicles]
"Global EV sales hit 14 million units in 2023" → keyword: global EV sales 2023 chart, type: image, source: web-image
"Tesla CEO Elon Musk announced record profits" → keyword: Elon Musk Tesla, type: image, source: web-image
"The electric vehicle revolution is spreading worldwide" → keyword: electric car charging station, type: video, source: stock`;

    return prompt;
}

async function getKeywordsFromAI(sceneText, sceneIndex) {
    const prompt = buildPrompt(sceneText);

    try {
        let result;
        // Log raw AI response for debugging
        switch (config.aiProvider) {
            case 'ollama':
                result = await callOllama(prompt);
                break;
            case 'claude':
                result = await callClaude(prompt);
                break;
            case 'openai':
                result = await callOpenAI(prompt);
                break;
            case 'deepseek':
                result = await callDeepSeek(prompt);
                break;
            case 'qwen':
                result = await callQwen(prompt);
                break;
            case 'nvidia':
                result = await callNvidia(prompt);
                break;
            case 'gemini':
                result = await callGemini(prompt);
                break;
            default:
                console.log(`⚠️ Unknown AI provider: ${config.aiProvider}, using Ollama`);
                result = await callOllama(prompt);
        }

        return result;
    } catch (error) {
        console.error(`❌ AI error for scene ${sceneIndex}:`, error.message);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Details:`, error.response.data);
        }
        return { keyword: '', mediaType: 'video', sourceHint: '' };
    }
}

// ============ OLLAMA (Free, Local) ============
async function callOllama(prompt, rawMode = false) {
    const response = await axios.post(`${config.ollama.baseUrl}/api/generate`, {
        model: config.ollama.model,
        prompt: prompt,
        stream: false
    });

    const text = response.data.response;
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ CLAUDE (Anthropic) ============
async function callClaude(prompt, rawMode = false) {
    if (!config.claude.apiKey) {
        throw new Error('Claude API key not set in .env file');
    }

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: config.claude.model,
        max_tokens: rawMode ? 200 : 150,
        messages: [{ role: 'user', content: prompt }]
    }, {
        headers: {
            'x-api-key': config.claude.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        }
    });

    const text = response.data.content[0].text;
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ OPENAI (GPT) ============
async function callOpenAI(prompt, rawMode = false) {
    if (!config.openai.apiKey) {
        throw new Error('OpenAI API key not set in .env file');
    }

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: config.openai.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: rawMode ? 200 : 150
    }, {
        headers: {
            'Authorization': `Bearer ${config.openai.apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    const text = response.data.choices[0].message.content;
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ DEEPSEEK ============
async function callDeepSeek(prompt, rawMode = false) {
    if (!config.deepseek.apiKey) {
        throw new Error('DeepSeek API key not set in .env file');
    }

    const response = await axios.post('https://api.deepseek.com/chat/completions', {
        model: config.deepseek.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: rawMode ? 200 : 150
    }, {
        headers: {
            'Authorization': `Bearer ${config.deepseek.apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    const text = response.data.choices[0].message.content;
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ QWEN (Alibaba) ============
async function callQwen(prompt, rawMode = false) {
    if (!config.qwen.apiKey) {
        throw new Error('Qwen API key not set in .env file');
    }

    const response = await axios.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        model: config.qwen.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: rawMode ? 200 : 150
    }, {
        headers: {
            'Authorization': `Bearer ${config.qwen.apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    const text = response.data.choices[0].message.content;
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ GEMINI (Google AI Studio, OpenAI-compatible) ============
async function callGemini(prompt, rawMode = false) {
    if (!config.gemini.apiKey) {
        throw new Error('Gemini API key not set in .env file');
    }

    const response = await axios.post(`${config.gemini.baseUrl}/chat/completions`, {
        model: config.gemini.model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: rawMode ? 1024 : 512
    }, {
        headers: {
            'Authorization': `Bearer ${config.gemini.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    // Gemini 2.5+ thinking models may return null content - extract from choices
    const choice = response.data.choices && response.data.choices[0];
    const text = choice?.message?.content || '';
    if (!text) console.log('  [Gemini] Warning: empty response content, raw:', JSON.stringify(response.data));
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ NVIDIA (OpenAI-compatible) ============
async function callNvidia(prompt, rawMode = false) {
    const response = await postNvidiaChatCompletion({
        model: config.nvidia.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: rawMode ? 200 : 150
    });

    const text = response.data.choices[0].message.content;
    return rawMode ? { raw: text } : parseAIResponse(text);
}

// ============ HELPERS ============

// Extract a meaningful keyword from narration text as fallback
function extractFallbackKeyword(sceneText) {
    if (!sceneText) return 'cinematic landscape';

    // Remove common stop words, keep nouns/verbs that are filmable
    const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
        'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'but', 'and', 'or',
        'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each',
        'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
        'than', 'too', 'very', 'just', 'also', 'now', 'then', 'here', 'there',
        'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'this',
        'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we',
        'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'about',
        'up', 'out', 'if', 'because', 'until', 'while', 'although', 'though',
        'since', 'unless', 'over', 'under', 'again', 'further', 'once', 'like',
        'even', 'still', 'already', 'almost', 'enough', 'quite', 'rather',
        'really', 'say', 'says', 'said', 'according', 'going', 'get', 'got',
        'make', 'made', 'take', 'took', 'much', 'many'
    ]);

    const words = sceneText.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    // Take the first 2-3 meaningful words
    const keyword = words.slice(0, 3).join(' ');
    return keyword || 'cinematic landscape';
}

function parseAIResponse(text) {
    if (!text) return { keyword: '', mediaType: 'video', sourceHint: '', thinking: '' };
    // Log raw AI response for debugging keyword quality
    console.log(`  [RAW AI]: ${text.trim().replace(/\n/g, ' | ')}`);
    const lines = text.trim().split('\n');

    let keyword = '';
    let mediaType = 'video';
    let sourceHint = '';
    let thinking = '';

    for (const line of lines) {
        const lower = line.toLowerCase().trim()
            .replace(/^\*+/, '').replace(/\*+$/, '')
            .replace(/^-\s*/, '')
            .trim();

        // Parse "thinking: ..."
        if (lower.startsWith('thinking:')) {
            thinking = line.substring(line.indexOf(':') + 1).trim();
        }

        // Parse "keyword: ocean waves"
        if (lower.startsWith('keyword:')) {
            keyword = line.substring(line.indexOf(':') + 1).trim();
            keyword = keyword.replace(/^["'*]+|["'*]+$/g, '');
            keyword = keyword.toLowerCase();
        }

        // Parse "type: video" or "type: image"
        if (lower.startsWith('type:')) {
            const val = lower.substring(lower.indexOf(':') + 1).trim().toLowerCase();
            if (val === 'image' || val === 'video') {
                mediaType = val;
            }
        }

        // Parse "source: youtube" or "source: stock" or "source: web-image"
        if (lower.startsWith('source:')) {
            const val = lower.substring(lower.indexOf(':') + 1).trim().toLowerCase().replace(/['"]/g, '');
            const validSources = ['stock', 'youtube', 'web-image'];
            if (validSources.includes(val)) {
                sourceHint = val;
            }
        }
    }

    // If the response didn't match the format, try to extract just a keyword
    if (!keyword && lines.length > 0) {
        const firstLine = lines[0].trim().replace(/^["'*]+|["'*]+$/g, '').toLowerCase();
        if (firstLine.length > 0 && firstLine.length < 50 && !firstLine.includes(':')) {
            keyword = firstLine;
        }
    }

    // Smart source defaults based on what AI chose
    if (!sourceHint) {
        if (mediaType === 'image') {
            // If AI chose image type, it's almost certainly web-image
            sourceHint = 'web-image';
        } else if (keyword) {
            // If keyword contains chart/graph/infographic terms, override to web-image
            const kw = keyword.toLowerCase();
            if (/\bchart\b|\bgraph\b|\binfographic\b/.test(kw)) {
                sourceHint = 'web-image';
                mediaType = 'image';
            }
        }
    }

    return { keyword, mediaType, sourceHint, thinking };
}

// Process all scenes and get keywords + media types
async function processScenes(scenes, scriptContext, aiInstructions) {
    console.log('\n🤖 AI is analyzing scenes for keywords + media type...');
    console.log(`📡 Using: ${config.aiProvider.toUpperCase()}\n`);

    // Reset state for fresh build
    usedKeywords = [];
    scriptContextRef = scriptContext || null;
    aiInstructionsRef = aiInstructions || '';
    // Use externally provided context from ai-context.js
    videoContext = scriptContext ? scriptContext.summary : '';
    if (scriptContextRef) {
        console.log(`📌 Video context:`);
        if (scriptContextRef.summary) console.log(`   Topic: ${scriptContextRef.summary}`);
        if (scriptContextRef.theme) console.log(`   Theme: ${scriptContextRef.theme}`);
        if (scriptContextRef.visualStyle) console.log(`   Visual style: ${scriptContextRef.visualStyle}`);
        if (scriptContextRef.mood) console.log(`   Mood: ${scriptContextRef.mood}`);
        const entities = (scriptContextRef.entities || []).slice(0, 5).join(', ');
        if (entities) console.log(`   Key subjects: ${entities}`);
        console.log('');
    } else if (videoContext) {
        console.log(`📌 Using video context: "${videoContext}"\n`);
    }
    if (aiInstructionsRef) {
        console.log(`📝 User instructions: "${aiInstructionsRef}"\n`);
    }

    const results = [];

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        console.log(`Scene ${i}: "${scene.text.substring(0, 40)}..."`);

        let { keyword, mediaType, sourceHint, thinking } = await getKeywordsFromAI(scene.text, i);

        // Log AI thinking for debugging
        if (thinking) {
            console.log(`  💭 AI thinking: ${thinking}`);
        }

        // Validate keyword — if empty or too short, extract from narration
        if (!keyword || keyword.trim().length < 2) {
            keyword = extractFallbackKeyword(scene.text);
            console.log(`  ⚠️ AI returned empty keyword, fallback: "${keyword}"`);
        } else {
            // Enforce max 5 words — truncate if AI ignored the rule
            const words = keyword.trim().split(/\s+/);
            if (words.length > 5) {
                keyword = words.slice(0, 5).join(' ');
                console.log(`  ⚠️ Keyword too long, truncated to: "${keyword}"`);
            }
            console.log(`  ✅ AI picked: "${keyword}" (${mediaType})${sourceHint ? ` [source: ${sourceHint}]` : ''}`);
        }

        // Track keyword to prevent repetition
        usedKeywords.push(keyword);

        results.push({
            ...scene,
            keyword: keyword,
            mediaType: mediaType,
            sourceHint: sourceHint || ''
        });
    }

    return { scenes: results, context: videoContext };
}

module.exports = { getKeywordsFromAI, processScenes };

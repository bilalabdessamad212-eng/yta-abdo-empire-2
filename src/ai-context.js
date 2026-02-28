const axios = require('axios');
const config = require('./config');
const { postNvidiaChatCompletion } = require('./nvidia-client');

/**
 * Deep script context analysis module.
 * Analyzes the full narration script and extracts structured information
 * that helps downstream modules (keywords, vision, motion graphics) make better decisions.
 */

function buildContextPrompt(fullScript, aiInstructions) {
    let prompt = `You are a video director analyzing a narration script. Your analysis will directly control:
- What footage to search for (so be specific about the visual world)
- What visual effects to apply (grain, vignette, light leaks, etc.)
- What motion graphics to place (charts, titles, callouts, etc.)
- The overall style and mood of the final video

Analyze deeply — your understanding determines the quality of the entire video.

SCRIPT:
"${fullScript}"`;

    if (aiInstructions) {
        prompt += `\n\nUSER INSTRUCTIONS (these override defaults — follow them closely):
${aiInstructions}`;
    }

    prompt += `\n\nReply in EXACTLY this format (one value per line, no extra text):
summary: <1 sentence, max 20 words, what this video is about>
theme: <one word: technology|history|finance|science|health|travel|politics|entertainment|education|sports|nature|business|lifestyle|motivation>
tone: <one word: informative|dramatic|casual|urgent|inspirational|educational|serious|lighthearted|emotional|suspenseful>
mood: <one word: dark|uplifting|tense|calm|energetic|nostalgic|hopeful|mysterious|intense|playful>
pacing: <one word: fast|moderate|slow>
visualStyle: <one word: cinematic|documentary|corporate|lifestyle|abstract|nature|urban|tech|vintage|minimalist>
entities: <comma-separated key people, companies, places, organizations mentioned, or "none">
stats: <comma-separated key numbers or statistics mentioned, or "none">
points: <comma-separated 3-5 main arguments or points made>
audience: <short phrase, who this video is for>
arc: <short phrase, emotional progression from start to end>`;
    return prompt;
}

function parseContextResponse(text) {
    const result = {
        summary: '',
        theme: '',
        tone: '',
        mood: '',
        pacing: '',
        visualStyle: '',
        entities: [],
        keyStats: [],
        mainPoints: [],
        targetAudience: '',
        emotionalArc: ''
    };

    const lines = text.trim().split('\n');

    for (const line of lines) {
        const lower = line.toLowerCase().trim()
            .replace(/^\*+/, '').replace(/\*+$/, '')  // strip markdown bold
            .replace(/^-\s*/, '')                      // strip list prefix
            .trim();

        const extractValue = () => line.substring(line.indexOf(':') + 1).trim().replace(/^["'*]+|["'*]+$/g, '');

        if (lower.startsWith('summary:')) {
            result.summary = extractValue();
            if (result.summary.length > 120) result.summary = result.summary.substring(0, 120);
        }
        if (lower.startsWith('theme:')) {
            result.theme = extractValue().toLowerCase();
        }
        if (lower.startsWith('tone:')) {
            result.tone = extractValue().toLowerCase();
        }
        if (lower.startsWith('mood:')) {
            result.mood = extractValue().toLowerCase();
        }
        if (lower.startsWith('pacing:')) {
            result.pacing = extractValue().toLowerCase();
        }
        if (lower.startsWith('visualstyle:') || lower.startsWith('visual style:') || lower.startsWith('visual_style:')) {
            result.visualStyle = extractValue().toLowerCase();
        }
        if (lower.startsWith('entities:')) {
            const val = extractValue();
            if (val.toLowerCase() !== 'none') {
                result.entities = val.split(',').map(s => s.trim()).filter(Boolean);
            }
        }
        if (lower.startsWith('stats:')) {
            const val = extractValue();
            if (val.toLowerCase() !== 'none') {
                result.keyStats = val.split(',').map(s => s.trim()).filter(Boolean);
            }
        }
        if (lower.startsWith('points:')) {
            const val = extractValue();
            result.mainPoints = val.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (lower.startsWith('audience:')) {
            result.targetAudience = extractValue();
        }
        if (lower.startsWith('arc:')) {
            result.emotionalArc = extractValue();
        }
    }

    return result;
}

// ============ PROVIDER DISPATCH ============

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

// ============ PROVIDERS (max_tokens: 300 for rich structured response) ============

async function callOllama(prompt) {
    const response = await axios.post(`${config.ollama.baseUrl}/api/generate`, {
        model: config.ollama.model,
        prompt: prompt,
        stream: false
    });
    return response.data.response;
}

async function callClaude(prompt) {
    if (!config.claude.apiKey) throw new Error('Claude API key not set');
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: config.claude.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
    }, {
        headers: {
            'x-api-key': config.claude.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        }
    });
    return response.data.content[0].text;
}

async function callOpenAI(prompt) {
    if (!config.openai.apiKey) throw new Error('OpenAI API key not set');
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: config.openai.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300
    }, {
        headers: {
            'Authorization': `Bearer ${config.openai.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    return response.data.choices[0].message.content;
}

async function callDeepSeek(prompt) {
    if (!config.deepseek.apiKey) throw new Error('DeepSeek API key not set');
    const response = await axios.post('https://api.deepseek.com/chat/completions', {
        model: config.deepseek.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300
    }, {
        headers: {
            'Authorization': `Bearer ${config.deepseek.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    return response.data.choices[0].message.content;
}

async function callQwen(prompt) {
    if (!config.qwen.apiKey) throw new Error('Qwen API key not set');
    const response = await axios.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        model: config.qwen.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300
    }, {
        headers: {
            'Authorization': `Bearer ${config.qwen.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    return response.data.choices[0].message.content;
}

async function callGemini(prompt) {
    if (!config.gemini.apiKey) throw new Error('Gemini API key not set');
    const response = await axios.post(`${config.gemini.baseUrl}/chat/completions`, {
        model: config.gemini.model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 2048
    }, {
        headers: {
            'Authorization': `Bearer ${config.gemini.apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });
    const choice = response.data.choices && response.data.choices[0];
    return choice?.message?.content || '';
}

async function callNvidia(prompt) {
    const response = await postNvidiaChatCompletion({
        model: config.nvidia.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300
    });
    return response.data.choices[0].message.content;
}

// ============ MAIN EXPORT ============

async function analyzeScriptContext(fullScript, scenes, aiInstructions) {
    console.log('\n🧠 Analyzing full script for deep context understanding...');
    console.log(`📡 Using: ${config.aiProvider.toUpperCase()}\n`);

    try {
        const prompt = buildContextPrompt(fullScript, aiInstructions);
        const rawText = await callAI(prompt);
        const context = parseContextResponse(rawText);

        // Ensure we have at least a summary
        if (!context.summary && fullScript.length > 0) {
            context.summary = fullScript.substring(0, 80).trim() + '...';
        }

        console.log(`   Summary: "${context.summary}"`);
        console.log(`   Theme: ${context.theme || 'unknown'} | Tone: ${context.tone || 'unknown'} | Mood: ${context.mood || 'unknown'}`);
        console.log(`   Pacing: ${context.pacing || 'moderate'} | Visual Style: ${context.visualStyle || 'cinematic'}`);
        if (context.entities.length > 0) {
            console.log(`   Entities: ${context.entities.join(', ')}`);
        }
        if (context.keyStats.length > 0) {
            console.log(`   Key stats: ${context.keyStats.join(', ')}`);
        }
        if (context.emotionalArc) {
            console.log(`   Arc: ${context.emotionalArc}`);
        }
        console.log('');

        return context;
    } catch (error) {
        console.log(`   ⚠️ Script context analysis failed: ${error.message}`);
        console.log('   ℹ️ Continuing with basic context...\n');

        return {
            summary: fullScript.substring(0, 80).trim(),
            theme: '',
            tone: '',
            mood: '',
            pacing: '',
            visualStyle: '',
            entities: [],
            keyStats: [],
            mainPoints: [],
            targetAudience: '',
            emotionalArc: ''
        };
    }
}

module.exports = { analyzeScriptContext, parseContextResponse };

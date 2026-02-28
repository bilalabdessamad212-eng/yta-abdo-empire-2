const axios = require('axios');
const config = require('./config');

/**
 * Research specific media sources for scenes using Perplexity Sonar.
 * Finds refined keywords and real-world sources to improve footage quality.
 *
 * @param {Array} scenes - Scenes with keywords from visual planner
 * @param {Object} scriptContext - Script context with theme, entities, summary
 * @returns {Array} Scenes enriched with researchHint and researchKeyword
 */
async function researchSceneMedia(scenes, scriptContext) {
    if (!config.perplexity?.apiKey) {
        return scenes;
    }

    console.log('\n🔬 Researching media sources with Perplexity Sonar...\n');

    try {
        const prompt = buildResearchPrompt(scenes, scriptContext);

        const response = await axios.post('https://api.perplexity.ai/chat/completions', {
            model: config.perplexity.model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a media researcher for video production. Find specific, real visual media sources. Respond only with JSON.'
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 1500
        }, {
            headers: {
                'Authorization': `Bearer ${config.perplexity.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const text = response.data?.choices?.[0]?.message?.content || '';
        return parseResearchResults(scenes, text);
    } catch (error) {
        console.log(`   ⚠️ Perplexity research failed: ${error.message}`);
        console.log('   ℹ️ Continuing with original keywords...\n');
        return scenes;
    }
}

function buildResearchPrompt(scenes, scriptContext) {
    const topic = scriptContext?.summary || 'unknown topic';
    const theme = scriptContext?.theme || 'general';
    const entities = scriptContext?.entities?.join(', ') || '';

    const sceneList = scenes.map((s, i) =>
        `Scene ${i}: "${s.keyword}" (${s.mediaType || 'video'}) — narration: "${(s.text || '').substring(0, 60)}"`
    ).join('\n');

    return `I'm producing a ${theme} video about: "${topic}"
${entities ? `Key entities: ${entities}` : ''}

For each scene below, suggest a better search keyword that would find more specific, relevant footage on stock sites (Pexels, Pixabay) or YouTube. Focus on visual specificity — what would actually appear in the frame.

Scenes:
${sceneList}

Respond as a JSON array: [{"scene": 0, "refinedKeyword": "more specific search term", "youtubeHint": "specific video title or channel if relevant"}]
Return ONLY the JSON array, no explanation.`;
}

function parseResearchResults(scenes, text) {
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.log('   ⚠️ Could not parse research response\n');
            return scenes;
        }

        const hints = JSON.parse(jsonMatch[0]);
        let enriched = 0;

        for (const hint of hints) {
            const i = hint.scene;
            if (i < 0 || i >= scenes.length) continue;

            if (hint.refinedKeyword && hint.refinedKeyword.length > 3) {
                scenes[i].researchKeyword = hint.refinedKeyword;
                scenes[i].researchHint = {
                    youtubeHint: hint.youtubeHint || '',
                    refinedKeyword: hint.refinedKeyword
                };
                enriched++;
                console.log(`   Scene ${i}: "${scenes[i].keyword}" → "${hint.refinedKeyword}"`);
            }
        }

        console.log(`\n   ✅ Research enriched ${enriched}/${scenes.length} scenes\n`);
    } catch (e) {
        console.log(`   ⚠️ Research parse failed: ${e.message}\n`);
    }
    return scenes;
}

module.exports = { researchSceneMedia };

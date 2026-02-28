/**
 * Test script for Step 4: AI Visual Planner
 *
 * Usage: node test-step4.js
 *
 * Runs:
 *   Step 2: Whisper transcription
 *   Step 3: AI Director (scenes + context)
 *   Step 4: AI Visual Planner (batch keywords)
 *
 * Then prints the full visual plan so you can see how the AI
 * uses the director's context to make smart visual decisions.
 */

const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const { transcribeAudio } = require('./src/transcribe');
const { analyzeAndCreateScenes } = require('./src/ai-director');
const { planVisuals } = require('./src/ai-visual-planner');
const { createDirectorsBrief } = require('./src/directors-brief');

async function main() {
    // Find audio file
    const inputDir = config.paths.input;
    const files = fs.readdirSync(inputDir).filter(f => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f));

    if (files.length === 0) {
        console.log('❌ No audio file found in input/ folder');
        process.exit(1);
    }

    const audioFile = files[0];
    const audioPath = path.join(inputDir, audioFile);
    console.log(`\n🎵 Audio: ${audioFile}\n`);

    // Read AI instructions from settings if available
    const settingsPath = path.join(config.paths.input, '..', 'settings.json');
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            if (settings.aiInstructions) process.env.AI_INSTRUCTIONS = settings.aiInstructions;
        } catch (e) {}
    }

    // Create Director's Brief
    const brief = createDirectorsBrief();
    console.log(`📋 Director's Brief:`);
    console.log(`   Format: ${brief.format} | Quality: ${brief.qualityTier} | Density: ${brief.tier.sceneDensity}/min`);
    if (brief.freeInstructions) console.log(`   Instructions: "${brief.freeInstructions}"`);
    if (brief.audienceHint) console.log(`   Audience: "${brief.audienceHint}"`);
    console.log('');

    // Step 2: Transcribe
    console.log('🎙️ Step 2: Transcribing...');
    const transcription = await transcribeAudio(audioPath);
    const audioDuration = transcription.duration || transcription.segments[transcription.segments.length - 1].end;
    console.log(`   ✅ Duration: ${audioDuration.toFixed(1)}s, Segments: ${transcription.segments.length}\n`);

    // Step 3: AI Director
    console.log('═'.repeat(60));
    console.log('  STEP 3: AI DIRECTOR');
    console.log('═'.repeat(60));

    const { scenes, scriptContext } = await analyzeAndCreateScenes(transcription, brief);

    // Step 4: Visual Planner
    console.log('═'.repeat(60));
    console.log('  STEP 4: VISUAL PLANNER');
    console.log('═'.repeat(60));

    const enrichedScenes = await planVisuals(scenes, scriptContext, brief);

    // Print results
    console.log('\n' + '═'.repeat(60));
    console.log('  VISUAL PLAN RESULTS');
    console.log('═'.repeat(60));

    console.log('\n🧠 DIRECTOR\'S CONTEXT (used by planner):');
    console.log(`   Theme: ${scriptContext.theme || '?'} | Tone: ${scriptContext.tone || '?'} | Mood: ${scriptContext.mood || '?'}`);
    console.log(`   Pacing: ${scriptContext.pacing || '?'} | Style: ${scriptContext.visualStyle || '?'}`);
    console.log(`   Format: ${scriptContext.format} | Background: ${scriptContext.backgroundCanvas}`);
    if (scriptContext.entities.length > 0) console.log(`   Entities: ${scriptContext.entities.join(', ')}`);
    if (scriptContext.hookEndTime) console.log(`   Hook ends: ~${scriptContext.hookEndTime}s`);
    if (scriptContext.ctaDetected) console.log(`   CTA at: ~${scriptContext.ctaStartTime}s`);

    console.log(`\n🎨 VISUAL PLAN: ${enrichedScenes.length} scenes\n`);

    for (const scene of enrichedScenes) {
        const dur = (scene.endTime - scene.startTime).toFixed(1);
        const hookMarker = scene.startTime < (scriptContext.hookEndTime || 15) ? ' [HOOK]' : '';
        const ctaMarker = scriptContext.ctaDetected && scene.startTime >= scriptContext.ctaStartTime ? ' [CTA]' : '';

        console.log(`  ┌─ Scene ${scene.index} ${hookMarker}${ctaMarker} ─────────────────────────────────`);
        console.log(`  │ Time:   ${scene.startTime.toFixed(1)}s → ${scene.endTime.toFixed(1)}s (${dur}s)`);
        console.log(`  │ Text:   "${scene.text.substring(0, 60)}${scene.text.length > 60 ? '...' : ''}"`);
        console.log(`  │`);
        console.log(`  │ 🎬 Keyword:  "${scene.keyword}"`);
        console.log(`  │ 📹 Media:    ${scene.mediaType.toUpperCase()} (source: ${scene.sourceHint})`);
        console.log(`  │ 🎯 Intent:   "${scene.visualIntent}"`);
        console.log(`  └${'─'.repeat(50)}`);
    }

    // Analysis
    console.log('\n📊 VISUAL PLAN ANALYSIS:\n');

    const videoCount = enrichedScenes.filter(s => s.mediaType === 'video').length;
    const imageCount = enrichedScenes.filter(s => s.mediaType === 'image').length;
    console.log(`   Media types: ${videoCount} video clips, ${imageCount} images`);

    const stockCount = enrichedScenes.filter(s => s.sourceHint === 'stock').length;
    const youtubeCount = enrichedScenes.filter(s => s.sourceHint === 'youtube').length;
    const webImageCount = enrichedScenes.filter(s => s.sourceHint === 'web-image').length;
    console.log(`   Source hints: ${stockCount} stock, ${youtubeCount} youtube, ${webImageCount} web-image`);

    // Check for keyword variety
    const uniqueKeywords = new Set(enrichedScenes.map(s => s.keyword.toLowerCase()));
    if (uniqueKeywords.size < enrichedScenes.length) {
        console.log(`   ⚠️ Some duplicate keywords: ${uniqueKeywords.size} unique out of ${enrichedScenes.length} scenes`);
    } else {
        console.log(`   ✅ All keywords are unique (visual variety)`);
    }

    // Check hook period
    const hookScenes = enrichedScenes.filter(s => s.startTime < (scriptContext.hookEndTime || 15));
    if (hookScenes.length > 0) {
        const hookVideoCount = hookScenes.filter(s => s.mediaType === 'video').length;
        console.log(`   🪝 Hook period: ${hookScenes.length} scenes, ${hookVideoCount} are video (strong visuals)`);
    }

    console.log('\n✅ Test complete.\n');
}

main().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    if (err.response) {
        console.error('   Status:', err.response.status);
        console.error('   Data:', JSON.stringify(err.response.data).substring(0, 200));
    }
    console.error('\n   Stack:', err.stack);
    process.exit(1);
});

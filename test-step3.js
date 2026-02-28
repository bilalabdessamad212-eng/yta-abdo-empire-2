/**
 * Test script for Step 3: AI Director (Scene Creation + Context Analysis)
 *
 * Usage: node test-step3.js
 *
 * Runs ONLY:
 *   Step 2: Whisper transcription
 *   Step 3: AI Director (scenes + context + format/CTA/hook detection)
 *
 * Then prints the full results so you can see exactly what the AI decided.
 * No footage download, no MGs, no rendering — just analysis and scene splitting.
 */

const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const { transcribeAudio } = require('./src/transcribe');
const { analyzeAndCreateScenes } = require('./src/ai-director');
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

    // Create Director's Brief (reads env vars)
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

    // Print results
    console.log('\n' + '═'.repeat(60));
    console.log('  RESULTS');
    console.log('═'.repeat(60));

    console.log('\n📌 SCRIPT CONTEXT:');
    console.log(`   Summary:      ${scriptContext.summary || '(none)'}`);
    console.log(`   Theme:        ${scriptContext.theme || '(none)'}`);
    console.log(`   Tone:         ${scriptContext.tone || '(none)'}`);
    console.log(`   Mood:         ${scriptContext.mood || '(none)'}`);
    console.log(`   Pacing:       ${scriptContext.pacing || '(none)'}`);
    console.log(`   Visual Style: ${scriptContext.visualStyle || '(none)'}`);
    console.log(`   Entities:     ${(scriptContext.entities || []).join(', ') || '(none)'}`);
    console.log(`   Key Stats:    ${(scriptContext.keyStats || []).join(', ') || '(none)'}`);
    console.log(`   Audience:     ${scriptContext.targetAudience || '(none)'}`);
    console.log(`   Arc:          ${scriptContext.emotionalArc || '(none)'}`);

    // NEW fields
    console.log('\n🆕 NEW ANALYSIS:');
    console.log(`   Format:       ${scriptContext.format}`);
    console.log(`   Background:   ${scriptContext.backgroundCanvas}`);
    console.log(`   Hook End:     ${scriptContext.hookEndTime ? scriptContext.hookEndTime + 's' : '(not detected)'}`);
    console.log(`   CTA Detected: ${scriptContext.ctaDetected ? `yes, at ~${scriptContext.ctaStartTime}s` : 'no'}`);
    console.log(`   Density:      ${scriptContext.densityTarget} scenes/min`);
    if (scriptContext.sections.length > 0) {
        console.log(`   Sections:     ${scriptContext.sections.map(s => typeof s === 'string' ? s : s.title).join(' | ')}`);
    }

    console.log(`\n🎬 SCENES: ${scenes.length} total (${audioDuration.toFixed(1)}s audio)\n`);

    for (const scene of scenes) {
        const dur = (scene.endTime - scene.startTime).toFixed(1);
        console.log(`  ┌─ Scene ${scene.index} ─────────────────────────────────`);
        console.log(`  │ Time:  ${scene.startTime.toFixed(2)}s → ${scene.endTime.toFixed(2)}s (${dur}s)`);
        console.log(`  │ Words: ${scene.words.length}`);
        console.log(`  │ Text:  "${scene.text}"`);
        console.log(`  └${'─'.repeat(50)}`);
    }

    // Sanity checks
    console.log('\n🔍 SANITY CHECKS:');

    const totalCoverage = scenes.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
    console.log(`   Total coverage: ${totalCoverage.toFixed(1)}s / ${audioDuration.toFixed(1)}s audio`);

    const gaps = [];
    for (let i = 1; i < scenes.length; i++) {
        const gap = scenes[i].startTime - scenes[i - 1].endTime;
        if (Math.abs(gap) > 0.1) {
            gaps.push({ between: `${i-1}→${i}`, gap: gap.toFixed(2) });
        }
    }
    if (gaps.length > 0) {
        console.log(`   ⚠️ Gaps/overlaps: ${JSON.stringify(gaps)}`);
    } else {
        console.log(`   ✅ No gaps or overlaps between scenes`);
    }

    const shortScenes = scenes.filter(s => (s.endTime - s.startTime) < 1.5);
    if (shortScenes.length > 0) {
        console.log(`   ⚠️ Very short scenes (<1.5s): ${shortScenes.map(s => `Scene ${s.index} (${(s.endTime - s.startTime).toFixed(1)}s)`).join(', ')}`);
    } else {
        console.log(`   ✅ All scenes are >= 1.5s`);
    }

    const longScenes = scenes.filter(s => (s.endTime - s.startTime) > 12);
    if (longScenes.length > 0) {
        console.log(`   ⚠️ Very long scenes (>12s): ${longScenes.map(s => `Scene ${s.index} (${(s.endTime - s.startTime).toFixed(1)}s)`).join(', ')}`);
    } else {
        console.log(`   ✅ No scenes longer than 12s`);
    }

    const emptyScenes = scenes.filter(s => !s.text || s.text.trim().length < 3);
    if (emptyScenes.length > 0) {
        console.log(`   ⚠️ Empty scenes: ${emptyScenes.map(s => `Scene ${s.index}`).join(', ')}`);
    } else {
        console.log(`   ✅ All scenes have text`);
    }

    const avgDuration = scenes.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / scenes.length;
    console.log(`   📊 Average scene: ${avgDuration.toFixed(1)}s (target density: ${brief.tier.sceneDensity}/min)`);

    console.log('\n✅ Test complete.\n');
}

main().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    if (err.response) {
        console.error('   Status:', err.response.status);
        console.error('   Data:', JSON.stringify(err.response.data).substring(0, 200));
    }
    process.exit(1);
});

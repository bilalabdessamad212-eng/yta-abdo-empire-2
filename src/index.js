const fs = require('fs');
const path = require('path');
const config = require('./config');
const { transcribeAudio } = require('./transcribe');
const { processScenes } = require('./ai-keywords');
const { downloadAllVideos } = require('./download-videos');

async function main() {
    console.log('🎬 ========================================');
    console.log('🎬  FACELESS VIDEO GENERATOR');
    console.log('🎬 ========================================\n');

    // Step 1: Find voiceover file in input folder
    const inputFiles = fs.readdirSync(config.paths.input);
    const audioFile = inputFiles.find(f => f.endsWith('.mp3') || f.endsWith('.wav'));

    if (!audioFile) {
        console.error('❌ No audio file found in /input folder!');
        console.log('💡 Add your voiceover.mp3 to the input folder and try again.');
        process.exit(1);
    }

    const audioPath = path.join(config.paths.input, audioFile);
    console.log(`📁 Found audio: ${audioFile}\n`);

    // Step 2: Transcribe audio with Whisper
    const transcription = await transcribeAudio(audioPath);

    // Step 3: Convert to scenes
    const scenes = transcription.segments.map((segment, index) => ({
        index: index,
        text: segment.text,
        startTime: segment.start,
        endTime: segment.end,
        duration: Math.round((segment.end - segment.start) * config.video.fps)
    }));

    // Step 4: AI picks keywords for each scene
    const scenesWithKeywords = await processScenes(scenes);

    // Step 5: Download videos from Pexels
    const scenesWithVideos = await downloadAllVideos(scenesWithKeywords);

    // Step 6: Save the video plan
    const videoPlan = {
        audio: audioFile,
        totalDuration: transcription.segments[transcription.segments.length - 1].end,
        fps: config.video.fps,
        width: config.video.width,
        height: config.video.height,
        scenes: scenesWithVideos
    };

    const planPath = path.join(config.paths.temp, 'video-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(videoPlan, null, 2));

    // Done!
    console.log('🎬 ========================================');
    console.log('✅ VIDEO PLAN READY!');
    console.log('🎬 ========================================\n');
    console.log(`📋 Plan saved: ${planPath}`);
    console.log(`🎵 Audio: ${audioFile}`);
    console.log(`⏱️  Duration: ${videoPlan.totalDuration.toFixed(2)} seconds`);
    console.log(`🎬 Scenes: ${scenes.length}`);
    console.log('\n📊 Keywords used:');
    scenesWithVideos.forEach((scene, i) => {
        console.log(`   Scene ${i}: "${scene.keyword}"`);
    });

    console.log('\n✨ Next step: Run Remotion to render the video!');
}

// Run the app
main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
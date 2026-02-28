const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function transcribeAudio(audioPath) {
    console.log('🎙️ Transcribing audio with Whisper...\n');

    // Check if audio file exists
    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    // Ensure temp directory exists
    if (!fs.existsSync(config.paths.temp)) {
        fs.mkdirSync(config.paths.temp, { recursive: true });
    }

    // Output path for transcription
    const outputPath = path.join(config.paths.temp, 'transcription.json');
    const scriptPath = path.join(config.paths.temp, 'run_whisper.py');

    try {
        // Run Whisper with word-level timestamps
        console.log('⏳ Running Whisper (this may take a minute)...');

        // Python script content
        // Use double-quoted raw strings for paths — single quotes break on
        // filenames containing apostrophes (e.g. "Florida's ...")
        const safePath = audioPath.replace(/\\/g, '/');
        const safeOutput = outputPath.replace(/\\/g, '/');
        const pythonScript = `
import whisper
import json
import os
import sys

AUDIO_PATH = r"${safePath}"
OUTPUT_PATH = r"${safeOutput}"

try:
    print("Loading model...")
    model = whisper.load_model('base')

    print(f"Transcribing: {AUDIO_PATH}")
    result = model.transcribe(AUDIO_PATH, word_timestamps=True)

    # Get actual audio duration
    audio = whisper.load_audio(AUDIO_PATH)
    audio_duration = len(audio) / whisper.audio.SAMPLE_RATE

    output = {
        'text': result['text'],
        'duration': audio_duration,
        'segments': []
    }

    for segment in result['segments']:
        words = []
        if 'words' in segment:
            for w in segment['words']:
                words.append({
                    'word': w.get('word', '').strip(),
                    'start': round(w.get('start', 0), 3),
                    'end': round(w.get('end', 0), 3)
                })
        output['segments'].append({
            'text': segment['text'].strip(),
            'start': segment['start'],
            'end': segment['end'],
            'words': words
        })

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'Done! Audio duration: {audio_duration:.2f}s')

except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`;

        // Write python script to file
        fs.writeFileSync(scriptPath, pythonScript);

        // Execute python script
        execSync(`python "${scriptPath}"`, { stdio: 'inherit' });

        // Read and return the transcription
        if (!fs.existsSync(outputPath)) {
            throw new Error('Transcription output file was not created by Python script.');
        }

        const transcription = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

        console.log(`\n✅ Transcription complete!`);
        console.log(`📝 Found ${transcription.segments.length} segments`);
        console.log(`⏱️ Total duration: ${transcription.segments[transcription.segments.length - 1]?.end.toFixed(2) || 0}s\n`);

        return transcription;

    } catch (error) {
        console.error('❌ Transcription failed:', error.message);
        console.log('\n💡 Make sure Whisper is installed:');
        console.log('   pip install openai-whisper');
        throw error;
    } finally {
        // Cleanup script
        if (fs.existsSync(scriptPath)) {
            try {
                fs.unlinkSync(scriptPath);
            } catch (e) {
                // Ignore cleanup error
            }
        }
    }
}

module.exports = { transcribeAudio };
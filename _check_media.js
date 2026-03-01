const fs = require('fs');
const path = require('path');
const projectDir = 'C:\\Users\\user\\Downloads\\test canvas new mgs';
const plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'public', 'video-plan.json'), 'utf8'));
const publicDir = path.join(projectDir, 'public');

function resolveMediaPath(mediaFile, publicDir) {
    if (!mediaFile) return null;
    if (fs.existsSync(mediaFile)) return mediaFile;
    const basename = path.basename(mediaFile);
    const inPublic = path.join(publicDir, basename);
    if (fs.existsSync(inPublic)) return inPublic;
    return null;
}

const scenes = plan.scenes.filter(s => !s.isMGScene);
scenes.forEach((s, i) => {
    const resolved = resolveMediaPath(s.mediaFile, publicDir);
    const dur = s.endTime && s.startTime ? (s.endTime - s.startTime).toFixed(2) : '?';
    console.log(`Scene ${i}: mediaFile="${s.mediaFile || 'EMPTY'}" → resolved=${resolved ? path.basename(resolved) : 'NULL'} dur=${dur}s offset=${s.mediaOffset||0}`);
});

// Also check if prep files exist from last render
const prepDir = path.join(projectDir, 'temp', 'ffmpeg-prep');
if (fs.existsSync(prepDir)) {
    const files = fs.readdirSync(prepDir);
    console.log(`\nPrep dir has ${files.length} files: ${files.join(', ')}`);
    files.filter(f => f.startsWith('prep-')).forEach(f => {
        const size = (fs.statSync(path.join(prepDir, f)).size / 1024).toFixed(0);
        console.log(`  ${f}: ${size}KB`);
    });
}

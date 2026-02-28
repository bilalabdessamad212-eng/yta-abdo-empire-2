const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Track downloaded videos to avoid duplicates
const downloadedIds = new Set();

async function downloadVideo(keyword, filename) {
    try {
        console.log(`  🔍 Searching: "${keyword}"...`);

        // Search Pexels for videos
        const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=15&orientation=landscape`;

        const response = await axios.get(searchUrl, {
            headers: { Authorization: config.pexels.apiKey }
        });

        if (response.data.videos.length === 0) {
            console.log(`  ⚠️ No videos found for "${keyword}"`);
            return null;
        }

        // Find first video we haven't used yet
        let selectedVideo = null;
        for (const video of response.data.videos) {
            if (!downloadedIds.has(video.id)) {
                selectedVideo = video;
                downloadedIds.add(video.id);
                break;
            }
        }

        // If all were duplicates, use first anyway
        if (!selectedVideo) {
            selectedVideo = response.data.videos[0];
            console.log(`  ⚠️ All results used, reusing video`);
        }

        // Get HD video URL
        const videoUrl = selectedVideo.video_files.find(f => f.quality === 'hd')?.link
            || selectedVideo.video_files[0].link;

        // Download the video
        const outputPath = path.join(config.paths.temp, filename);
        const writer = fs.createWriteStream(outputPath);

        const videoResponse = await axios({
            url: videoUrl,
            method: 'GET',
            responseType: 'stream'
        });

        videoResponse.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`  ✅ Downloaded: ${filename}`);
                resolve(outputPath);
            });
            writer.on('error', reject);
        });

    } catch (error) {
        console.error(`  ❌ Download error: ${error.message}`);
        return null;
    }
}

async function downloadAllVideos(scenes) {
    console.log('\n🎥 Downloading stock footage...\n');

    // Reset tracker for new batch
    downloadedIds.clear();

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const filename = `scene-${i}.mp4`;

        console.log(`\nScene ${i}:`);
        const filePath = await downloadVideo(scene.keyword, filename);
        scene.videoFile = filePath;
    }

    console.log('\n✅ All videos downloaded!\n');
    return scenes;
}

module.exports = { downloadVideo, downloadAllVideos };
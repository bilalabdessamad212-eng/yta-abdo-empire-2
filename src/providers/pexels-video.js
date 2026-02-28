const axios = require('axios');
const config = require('../config');
const BaseProvider = require('./base-provider');

class PexelsVideoProvider extends BaseProvider {
    constructor() {
        super('Pexels Videos', 'video');
    }

    isAvailable() {
        return !!config.pexels.apiKey;
    }

    async search(keyword) {
        const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=15&orientation=landscape`;

        const response = await axios.get(url, {
            headers: { Authorization: config.pexels.apiKey },
            timeout: 15000
        });

        if (!response.data.videos || response.data.videos.length === 0) {
            return [];
        }

        return response.data.videos.map(video => {
            const hdFile = video.video_files.find(f => f.quality === 'hd');
            return {
                id: String(video.id),
                url: hdFile?.link || video.video_files[0].link,
                width: video.width,
                height: video.height
            };
        });
    }
}

module.exports = PexelsVideoProvider;

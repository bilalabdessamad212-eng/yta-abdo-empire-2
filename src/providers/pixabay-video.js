const axios = require('axios');
const config = require('../config');
const BaseProvider = require('./base-provider');

class PixabayVideoProvider extends BaseProvider {
    constructor() {
        super('Pixabay Videos', 'video');
    }

    isAvailable() {
        return !!config.pixabay.apiKey;
    }

    async search(keyword) {
        const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(config.pixabay.apiKey)}&q=${encodeURIComponent(keyword)}&per_page=15&orientation=horizontal`;

        const response = await axios.get(url, { timeout: 15000 });

        if (!response.data.hits || response.data.hits.length === 0) {
            return [];
        }

        return response.data.hits.map(hit => {
            // Prefer large video, fall back to medium or small
            const videoData = hit.videos.large || hit.videos.medium || hit.videos.small;
            return {
                id: String(hit.id),
                url: videoData.url,
                width: videoData.width,
                height: videoData.height
            };
        });
    }
}

module.exports = PixabayVideoProvider;

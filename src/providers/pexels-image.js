const axios = require('axios');
const config = require('../config');
const BaseProvider = require('./base-provider');

class PexelsImageProvider extends BaseProvider {
    constructor() {
        super('Pexels Images', 'image');
    }

    isAvailable() {
        return !!config.pexels.apiKey;
    }

    async search(keyword) {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=15&orientation=landscape`;

        const response = await axios.get(url, {
            headers: { Authorization: config.pexels.apiKey },
            timeout: 15000
        });

        if (!response.data.photos || response.data.photos.length === 0) {
            return [];
        }

        return response.data.photos.map(photo => ({
            id: String(photo.id),
            url: photo.src.large2x || photo.src.large || photo.src.original,
            width: photo.width,
            height: photo.height
        }));
    }
}

module.exports = PexelsImageProvider;

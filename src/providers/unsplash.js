const axios = require('axios');
const config = require('../config');
const BaseProvider = require('./base-provider');

class UnsplashProvider extends BaseProvider {
    constructor() {
        super('Unsplash', 'image');
    }

    isAvailable() {
        return !!config.unsplash.accessKey;
    }

    async search(keyword) {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=15&orientation=landscape`;

        const response = await axios.get(url, {
            headers: { Authorization: `Client-ID ${config.unsplash.accessKey}` },
            timeout: 15000
        });

        if (!response.data.results || response.data.results.length === 0) {
            return [];
        }

        return response.data.results.map(photo => ({
            id: photo.id,
            url: photo.urls.regular || photo.urls.full,
            width: photo.width,
            height: photo.height
        }));
    }
}

module.exports = UnsplashProvider;

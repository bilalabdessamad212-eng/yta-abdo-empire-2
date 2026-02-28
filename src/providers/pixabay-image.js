const axios = require('axios');
const config = require('../config');
const BaseProvider = require('./base-provider');

class PixabayImageProvider extends BaseProvider {
    constructor() {
        super('Pixabay Images', 'image');
    }

    isAvailable() {
        return !!config.pixabay.apiKey;
    }

    async search(keyword) {
        const url = `https://pixabay.com/api/?key=${encodeURIComponent(config.pixabay.apiKey)}&q=${encodeURIComponent(keyword)}&per_page=15&orientation=horizontal&image_type=photo&min_width=1280`;

        const response = await axios.get(url, { timeout: 15000 });

        if (!response.data.hits || response.data.hits.length === 0) {
            return [];
        }

        return response.data.hits.map(hit => ({
            id: String(hit.id),
            url: hit.largeImageURL || hit.webformatURL,
            width: hit.imageWidth,
            height: hit.imageHeight
        }));
    }
}

module.exports = PixabayImageProvider;

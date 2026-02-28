const axios = require('axios');
const BaseProvider = require('./base-provider');
const config = require('../config');

class BingImagesProvider extends BaseProvider {
    constructor() {
        super('Bing Images', 'image');
    }

    isAvailable() {
        return !!config.bing.apiKey;
    }

    async search(keyword) {
        try {
            const response = await axios.get('https://api.bing.microsoft.com/v7.0/images/search', {
                headers: {
                    'Ocp-Apim-Subscription-Key': config.bing.apiKey
                },
                params: {
                    q: keyword,
                    count: 15,
                    imageType: 'Photo',
                    size: 'Large',
                    aspect: 'Wide',
                    safeSearch: 'Moderate'
                },
                timeout: 15000
            });

            if (!response.data.value || response.data.value.length === 0) {
                return [];
            }

            return response.data.value.map((item, idx) => ({
                id: `bing-${item.imageId || idx}`,
                url: item.contentUrl,
                width: item.width || 0,
                height: item.height || 0
            }));
        } catch (error) {
            if (error.response?.status === 401) {
                console.log(`  ⚠️ [Bing Images] Invalid API key`);
            } else if (error.response?.status === 429) {
                console.log(`  ⚠️ [Bing Images] Rate limit exceeded`);
            } else {
                console.log(`  ⚠️ [Bing Images] Search failed: ${error.message}`);
            }
            return [];
        }
    }
}

module.exports = BingImagesProvider;

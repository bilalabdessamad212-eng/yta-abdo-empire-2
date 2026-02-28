const axios = require('axios');
const BaseProvider = require('./base-provider');

// Keywords that need less restrictive size filtering
const UNFILTERED_KEYWORDS = [
    'chart', 'graph', 'data', 'infographic', 'statistics', 'market share',
    'news', 'article', 'headline', 'report', 'announcement',
    'logo', 'screenshot', 'map', 'diagram', 'comparison',
    'sales', 'revenue', 'profit', 'gdp', 'price',
];

class DuckDuckGoImagesProvider extends BaseProvider {
    constructor() {
        super('DuckDuckGo Images', 'image');
    }

    isAvailable() {
        return true; // No API key needed
    }

    async search(keyword) {
        // Truncate very long keywords
        let query = keyword;
        const words = query.trim().split(/\s+/);
        if (words.length > 8) {
            query = words.slice(0, 8).join(' ');
        }

        // Retry with backoff if rate-limited (403)
        const MAX_RETRIES = 2;
        for (let retry = 0; retry <= MAX_RETRIES; retry++) {
            try {
                if (retry > 0) {
                    // Wait before retry (1s, then 3s)
                    const delay = retry * 2000;
                    await new Promise(r => setTimeout(r, delay));
                }

                // Step 1: Get vqd token from DuckDuckGo search page
                const tokenResponse = await axios.get('https://duckduckgo.com/', {
                    params: {
                        q: query,
                        iax: 'images',
                        ia: 'images'
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                    },
                    timeout: 10000
                });

                // Extract vqd token from response (multiple patterns — DDG changes format)
                const html = tokenResponse.data;
                const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/)
                    || html.match(/vqd=([^&"']+)/)
                    || html.match(/vqd\\x3d([^&"'\\]+)/);
                if (!vqdMatch) {
                    console.log(`  ⚠️ [DuckDuckGo] Could not extract vqd token`);
                    return [];
                }
                const vqd = vqdMatch[1];

                // For data/news keywords, use Medium+ size (charts/screenshots may not be "Large")
                const kwLower = query.toLowerCase();
                const needsFlexibleSize = UNFILTERED_KEYWORDS.some(uk => kwLower.includes(uk));
                const sizeFilter = needsFlexibleSize ? 'size:Medium' : 'size:Large';

                // Step 2: Query the image API with vqd token
                const imageResponse = await axios.get('https://duckduckgo.com/i.js', {
                    params: {
                        l: 'us-en',
                        o: 'json',
                        q: query,
                        vqd: vqd,
                        f: sizeFilter,
                        p: '1'
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://duckduckgo.com/',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    timeout: 10000
                });

                const results = imageResponse.data?.results;
                if (!results || results.length === 0) {
                    return [];
                }

                return results.slice(0, 15).map((item, idx) => ({
                    id: `ddg-${idx}-${item.image?.substring(0, 50)}`,
                    url: item.image,
                    width: item.width || 0,
                    height: item.height || 0
                })).filter(r => r.url && r.url.startsWith('http'));
            } catch (error) {
                if (error.response?.status === 403 && retry < MAX_RETRIES) {
                    console.log(`  ⚠️ [DuckDuckGo] Rate limited, retrying in ${(retry + 1) * 2}s...`);
                    continue;
                }
                console.log(`  ⚠️ [DuckDuckGo] Search failed: ${error.response?.status || error.message}`);
                return [];
            }
        }
        return [];
    }
}

module.exports = DuckDuckGoImagesProvider;

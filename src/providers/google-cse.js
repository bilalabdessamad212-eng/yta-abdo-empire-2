const BaseProvider = require('./base-provider');
const { searchGoogleCSE, hasCredentials: hasGoogleCSECredentials } = require('../google-cse-client');

// Keywords where imgType:photo would filter out valid results (charts, maps, etc.)
const SKIP_PHOTO_FILTER = [
    'chart', 'graph', 'data', 'infographic', 'statistics', 'map', 'diagram',
    'screenshot', 'logo', 'comparison', 'report', 'document', 'satellite',
    'expenditure', 'budget', 'spending', 'military', 'gdp', 'trade',
];

class GoogleCSEProvider extends BaseProvider {
    constructor() {
        super('Google CSE', 'image');
    }

    isAvailable() {
        return hasGoogleCSECredentials();
    }

    async search(keyword) {
        try {
            // Truncate long keywords; CSE can reject overly long/complex queries.
            let query = String(keyword || '').trim();
            const words = query.split(/\s+/).filter(Boolean);
            if (words.length > 8) {
                query = words.slice(0, 8).join(' ');
            }
            if (!query) {
                return [];
            }

            // Skip imgType=photo for data/chart/map keywords (not photo-like queries).
            const kwLower = query.toLowerCase();
            const usePhotoFilter = !SKIP_PHOTO_FILTER.some((kw) => kwLower.includes(kw));

            const params = {
                q: query,
                searchType: 'image',
                imgSize: 'large',
                num: 10,
                safe: 'active',
            };
            if (usePhotoFilter) {
                params.imgType = 'photo';
            }

            const { items } = await searchGoogleCSE(params, { timeout: 15000 });
            if (!items || items.length === 0) {
                return [];
            }

            return items.map((item, idx) => ({
                id: `gcse-${item.link}-${idx}`,
                url: item.link,
                width: item.image?.width || 0,
                height: item.image?.height || 0,
            }));
        } catch (error) {
            console.log(`  ⚠️ [Google CSE] ${error.message}`);
            return [];
        }
    }
}

module.exports = GoogleCSEProvider;


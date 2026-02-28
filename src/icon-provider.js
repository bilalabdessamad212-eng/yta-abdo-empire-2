/**
 * Icon Provider — Downloads SVG icons from Iconify API
 * Free, no API key required, 100k+ icons from Material Design, FontAwesome, etc.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ICONIFY_SEARCH_URL = 'https://api.iconify.design/search';
const ICONIFY_ICON_URL = 'https://api.iconify.design';

// Preferred icon sets (clean, consistent style)
const PREFERRED_PREFIXES = ['mdi', 'ph', 'lucide', 'tabler', 'carbon', 'solar', 'ic'];

/**
 * Simple HTTPS GET that returns a string
 */
function httpGet(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                httpGet(res.headers.location, timeout).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

/**
 * Search Iconify for icons matching a keyword
 * @param {string} keyword - Search term (e.g. "brain", "gear", "rocket")
 * @param {number} limit - Max results
 * @returns {Promise<string[]>} Array of icon IDs like ['mdi:brain', 'ph:brain-fill']
 */
async function searchIcons(keyword, limit = 10) {
    try {
        const url = `${ICONIFY_SEARCH_URL}?query=${encodeURIComponent(keyword)}&limit=${limit}`;
        const data = await httpGet(url);
        const result = JSON.parse(data);

        if (!result.icons || result.icons.length === 0) return [];

        // Sort: prefer icons from our preferred sets
        const icons = result.icons.sort((a, b) => {
            const prefA = a.split(':')[0];
            const prefB = b.split(':')[0];
            const idxA = PREFERRED_PREFIXES.indexOf(prefA);
            const idxB = PREFERRED_PREFIXES.indexOf(prefB);
            const scoreA = idxA >= 0 ? idxA : 100;
            const scoreB = idxB >= 0 ? idxB : 100;
            return scoreA - scoreB;
        });

        return icons;
    } catch (e) {
        console.warn(`Icon search failed for "${keyword}":`, e.message);
        return [];
    }
}

/**
 * Download a single icon SVG from Iconify
 * @param {string} iconId - e.g. 'mdi:brain'
 * @param {string} outputPath - Where to save the SVG file
 * @returns {Promise<boolean>} Success
 */
async function downloadIcon(iconId, outputPath) {
    try {
        const [prefix, name] = iconId.split(':');
        if (!prefix || !name) return false;

        const url = `${ICONIFY_ICON_URL}/${prefix}/${name}.svg?height=auto`;
        const svgData = await httpGet(url);

        if (!svgData || !svgData.includes('<svg')) {
            console.warn(`Invalid SVG data for ${iconId}`);
            return false;
        }

        fs.writeFileSync(outputPath, svgData);
        return true;
    } catch (e) {
        console.warn(`Failed to download icon ${iconId}:`, e.message);
        return false;
    }
}

/**
 * Download all icons for animatedIcons MGs
 * @param {Array} motionGraphics - Array of MG objects (only processes type=animatedIcons)
 * @param {string} tempDir - Temp directory to save icon SVGs
 * @returns {Promise<number>} Number of icons successfully downloaded
 */
async function downloadAllIcons(motionGraphics, tempDir) {
    const iconMGs = motionGraphics.filter(mg => mg.type === 'animatedIcons');
    if (iconMGs.length === 0) return 0;

    let downloaded = 0;
    const usedIconIds = new Set(); // Avoid duplicate downloads

    for (const mg of iconMGs) {
        if (!mg.icons || mg.icons.length === 0) continue;

        for (const icon of mg.icons) {
            const keyword = icon.keyword;
            if (!keyword) continue;

            try {
                // Search for matching icons
                const results = await searchIcons(keyword, 5);
                if (results.length === 0) {
                    console.log(`  No icons found for "${keyword}", skipping`);
                    continue;
                }

                // Pick best unused icon
                let picked = null;
                for (const iconId of results) {
                    if (!usedIconIds.has(iconId)) {
                        picked = iconId;
                        break;
                    }
                }
                if (!picked) picked = results[0]; // Fallback to first if all used

                // Download SVG
                const filename = icon.file || `icon-${mg.sceneIndex || 0}-${mg.icons.indexOf(icon)}.svg`;
                const outputPath = path.join(tempDir, filename);

                const success = await downloadIcon(picked, outputPath);
                if (success) {
                    icon.file = filename;
                    icon._iconId = picked;
                    usedIconIds.add(picked);
                    downloaded++;
                    console.log(`  ✓ ${keyword} → ${picked} → ${filename}`);
                }
            } catch (e) {
                console.warn(`  Failed to get icon for "${keyword}":`, e.message);
            }
        }

        // Remove icons that failed to download
        mg.icons = mg.icons.filter(icon => icon.file);
    }

    return downloaded;
}

module.exports = { searchIcons, downloadIcon, downloadAllIcons };

const axios = require('axios');
const config = require('./config');

let cseDisabledReason = '';

function clean(value) {
    return String(value || '')
        .trim()
        .replace(/^["']+|["']+$/g, '');
}

function getCredentials() {
    const key = clean(config.googleCSE?.apiKey || process.env.GOOGLE_CSE_API_KEY);
    const cx = clean(config.googleCSE?.cx || process.env.GOOGLE_CSE_CX);
    return { key, cx };
}

function hasCredentials() {
    const { key, cx } = getCredentials();
    return !!(key && cx);
}

function classifyError(error) {
    const status = error?.response?.status;
    const apiMessage = error?.response?.data?.error?.message || '';
    const reasons = (error?.response?.data?.error?.errors || [])
        .map((e) => e?.reason)
        .filter(Boolean);
    const text = `${apiMessage} ${reasons.join(' ')}`.toLowerCase();

    if (status === 403 && text.includes('does not have the access to custom search json api')) {
        return {
            permanent: true,
            message: 'This Google Cloud project is not eligible for Custom Search JSON API access (Google has closed it to new customers).',
        };
    }

    if (status === 400 && text.includes('api key not valid')) {
        return {
            permanent: true,
            message: 'Google CSE key is invalid. Update GOOGLE_CSE_API_KEY in .env.',
        };
    }

    if ((status === 400 || status === 403) && (text.includes('cx') || text.includes('search engine id') || text.includes('invalid value'))) {
        return {
            permanent: true,
            message: 'Google CSE engine ID (GOOGLE_CSE_CX) is invalid or misconfigured.',
        };
    }

    if (status === 429 || text.includes('quota') || text.includes('rate limit')) {
        return {
            permanent: false,
            message: 'Google CSE quota/rate limit reached.',
        };
    }

    return {
        permanent: false,
        message: apiMessage || error?.message || 'Google CSE request failed',
    };
}

async function searchGoogleCSE(params, options = {}) {
    if (cseDisabledReason) {
        return { items: [], skipped: true, reason: cseDisabledReason };
    }

    const { key, cx } = getCredentials();
    if (!key || !cx) {
        return { items: [], skipped: true, reason: 'Google CSE credentials are not configured.' };
    }

    try {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { key, cx, ...params },
            timeout: options.timeout || 15000,
        });
        return { items: response.data?.items || [], skipped: false, reason: '' };
    } catch (error) {
        const classified = classifyError(error);
        if (classified.permanent) {
            cseDisabledReason = classified.message;
        }
        throw new Error(classified.message);
    }
}

module.exports = {
    searchGoogleCSE,
    hasCredentials,
};

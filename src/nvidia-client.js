const axios = require('axios');
const config = require('./config');

let keyCursor = 0;

function getNvidiaApiKeys() {
    if (Array.isArray(config.nvidia?.apiKeys) && config.nvidia.apiKeys.length > 0) {
        return config.nvidia.apiKeys.filter(Boolean);
    }
    return config.nvidia?.apiKey ? [config.nvidia.apiKey] : [];
}

function classifyStatus(err) {
    return err?.response?.status || 0;
}

async function postNvidiaChatCompletion(body, { timeout = 120000 } = {}) {
    const keys = getNvidiaApiKeys();
    if (!keys.length) {
        throw new Error('NVIDIA API key not set in .env file');
    }

    const start = keyCursor % keys.length;
    let lastError = null;

    for (let i = 0; i < keys.length; i++) {
        const idx = (start + i) % keys.length;
        const key = keys[idx];

        try {
            const response = await axios.post(`${config.nvidia.baseUrl}/chat/completions`, body, {
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                timeout,
            });

            keyCursor = (idx + 1) % keys.length;
            if (i > 0 && keys.length > 1) {
                console.log(`  🔁 [nvidia] Switched to backup key (${idx + 1}/${keys.length})`);
            }
            return response;
        } catch (error) {
            lastError = error;
            const status = classifyStatus(error);
            const canTryNextKey = i < keys.length - 1;
            const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'));
            const switchable = status === 429 || status === 401 || status === 403 || isTimeout;

            if (switchable && canTryNextKey) {
                const reason = isTimeout ? 'timed out' : status === 429 ? 'rate-limited' : 'unauthorized';
                console.log(`  ⚠️ [nvidia] Key ${idx + 1}/${keys.length} ${reason}${status ? ` (${status})` : ''}, trying next key...`);
                continue;
            }

            throw error;
        }
    }

    if (keys.length > 1) {
        const isTimeout = lastError?.code === 'ECONNABORTED' || lastError?.message?.includes('timeout');
        if (lastError?.response?.status === 429) {
            throw new Error(`All ${keys.length} NVIDIA keys are rate-limited (429).`);
        }
        if (isTimeout) {
            throw new Error(`All ${keys.length} NVIDIA keys timed out.`);
        }
    }

    throw lastError || new Error('NVIDIA request failed');
}

module.exports = {
    postNvidiaChatCompletion,
    getNvidiaApiKeys,
};


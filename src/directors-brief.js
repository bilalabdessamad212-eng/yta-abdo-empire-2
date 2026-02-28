/**
 * Director's Brief Module
 *
 * Structured user input inspired by VidRush's Four-Pillar Framework.
 * Reads from environment variables and provides a clean, validated brief
 * that all pipeline steps can consume.
 *
 * Exports:
 *   createDirectorsBrief() — reads env vars, returns validated brief
 *   QUALITY_TIERS         — tier definitions for downstream steps
 */

const { getThemeIds } = require('./themes');

// ============================================================
// QUALITY TIER DEFINITIONS
// ============================================================

// NOTE: Scene density is higher than typical documentary because FACELESS VIDEOS
// need frequent B-roll cuts (every 3-7s) to keep viewers engaged.
const QUALITY_TIERS = {
    mini: {
        name: 'Mini (Fast)',
        mediaDefault: 'image',        // Images only by default
        allowVideo: false,             // Skip video providers
        maxMGs: 3,                     // Fewer motion graphics
        skipVisionAI: true,            // Skip vision analysis
        skipOverlays: true,            // Skip overlay downloads
        transitionRatio: 0,            // All cuts, no transitions
        sceneDensity: 5,               // Fast cuts: ~1 scene every 12s
    },
    standard: {
        name: 'Standard',
        mediaDefault: 'mixed',         // Video + image mix
        allowVideo: true,
        maxMGs: Infinity,              // No limit
        skipVisionAI: false,
        skipOverlays: false,
        transitionRatio: 0.3,          // 70/30 rule (30% transitions)
        sceneDensity: 4,               // Balanced: ~1 scene every 15s
    },
    pro: {
        name: 'Pro (Best)',
        mediaDefault: 'video',         // Video-heavy
        allowVideo: true,
        maxMGs: Infinity,
        skipVisionAI: false,
        skipOverlays: false,
        transitionRatio: 0.4,          // 60/40 (more transitions)
        sceneDensity: 3.5,             // Cinematic but frequent: ~1 scene every 17s
    }
};

// ============================================================
// CREATE DIRECTOR'S BRIEF
// ============================================================

/**
 * Create a validated Director's Brief from environment variables.
 * Falls back to sensible defaults for every field.
 *
 * Environment variables:
 *   AI_INSTRUCTIONS    — Free-text instructions (existing)
 *   BUILD_FORMAT       — 'auto' | 'documentary' | 'listicle'
 *   BUILD_QUALITY_TIER — 'mini' | 'standard' | 'pro'
 *   BUILD_AUDIENCE     — Optional target audience description
 *   BUILD_THEME        — 'auto' | 'tech' | 'nature' | 'crime' | 'corporate' | 'luxury' | 'sport' | 'neutral'
 *   BUILD_RECIPE       — Optional genre recipe name (e.g., 'politics', 'tech', 'crime')
 *
 * @returns {DirectorsBrief}
 */
function createDirectorsBrief() {
    const freeInstructions = (process.env.AI_INSTRUCTIONS || '').trim();
    const rawFormat = (process.env.BUILD_FORMAT || 'auto').trim().toLowerCase();
    const rawTier = (process.env.BUILD_QUALITY_TIER || 'standard').trim().toLowerCase();
    const audienceHint = (process.env.BUILD_AUDIENCE || '').trim() || null;
    const rawTheme = (process.env.BUILD_THEME || 'auto').trim().toLowerCase();
    const recipeOverride = (process.env.BUILD_RECIPE || '').trim().toLowerCase() || null;

    // Validate format
    const validFormats = ['auto', 'documentary', 'listicle'];
    const format = validFormats.includes(rawFormat) ? rawFormat : 'auto';

    // Validate quality tier
    const validTiers = ['mini', 'standard', 'pro'];
    const qualityTier = validTiers.includes(rawTier) ? rawTier : 'standard';

    // Validate theme (auto = let AI decide, or specific theme ID)
    const validThemes = ['auto', ...getThemeIds()];
    const themeOverride = validThemes.includes(rawTheme) ? rawTheme : 'auto';

    const brief = {
        freeInstructions,
        format,
        qualityTier,
        audienceHint,
        themeOverride, // 'auto' = AI decides, or specific theme ID
        recipeOverride, // explicit genre recipe name, or null for auto-detect
        // Resolved tier config for easy access
        tier: QUALITY_TIERS[qualityTier]
    };

    return brief;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = { createDirectorsBrief, QUALITY_TIERS };

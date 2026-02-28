/**
 * Smart Transition Planning Module
 *
 * Implements VidRush's 70/30 transition rule:
 * - 70% cuts (instant), 30% transitions (fade, dissolve, wipe, zoom)
 * - Quality tier adjusts ratio: Mini = all cuts, Standard = 70/30, Pro = 60/40
 * - Always transition at structural boundaries (hook→body, sections, body→CTA)
 * - Always cut between adjacent fullscreen MGs (they provide visual break)
 * - Documentary → more dissolves/fades (smooth, cinematic)
 * - Listicle → more wipes/zooms (energetic, segmented)
 *
 * Pure algorithmic (no AI calls) — fast, deterministic, cost-free.
 */

const config = require('./config');
const { getTheme, TRANSITION_LIBRARY } = require('./themes');

// Fullscreen MG types that provide natural visual breaks
const FULLSCREEN_MG_TYPES = new Set([
    'barChart', 'donutChart', 'rankingList', 'timeline',
    'comparisonCard', 'bulletList', 'mapChart', 'articleHighlight'
]);

// Build duration map from TRANSITION_LIBRARY
const TRANSITION_DURATIONS = {};
for (const [key, trans] of Object.entries(TRANSITION_LIBRARY)) {
    TRANSITION_DURATIONS[key] = trans.duration;
}

// Fallback categories (if theme not available)
const TRANSITION_TYPES = {
    smooth: ['fade', 'dissolve', 'crossfade', 'crossBlur', 'blur', 'luma', 'ripple', 'reveal', 'morph', 'dreamFade', 'filmBurn'],
    energetic: ['wipe', 'slide', 'zoom', 'push', 'swipe', 'whip', 'bounce', 'shutterSlice', 'zoomBlur', 'splitWipe'],
    cinematic: ['flare', 'lightLeak', 'vignetteBlink', 'shadowWipe', 'filmGrain', 'ink', 'prismShift', 'cameraFlash'],
    dramatic: ['flash', 'directionalBlur', 'colorFade', 'spin', 'cameraFlash', 'vignetteBlink'],
    glitchy: ['glitch', 'pixelate', 'mosaic', 'dataMosh', 'scanline', 'rgbSplit', 'static']
};

/**
 * Main export: Plan transitions between all scenes
 * @param {Array} scenes - Scene objects with timing info
 * @param {Object} scriptContext - AI Director's analysis (format, hookEndTime, ctaStartTime, etc.)
 * @param {Array} motionGraphics - Placed MGs (to detect fullscreen types)
 * @param {Object} directorsBrief - Quality tier and format settings
 * @returns {Array} Transition plan: [{ fromSceneIndex, toSceneIndex, type, duration }]
 */
function planTransitions(scenes, scriptContext, motionGraphics, directorsBrief) {
    if (!scenes || scenes.length < 2) return [];

    const tier = directorsBrief.tier;
    const format = scriptContext?.format || 'documentary';

    // Mini tier = all cuts (fastest render, no transitions)
    if (directorsBrief.qualityTier === 'mini') {
        return createAllCuts(scenes);
    }

    // Determine target transition ratio based on tier
    const transitionRatio = tier.transitionRatio; // 0.3 for standard, 0.4 for pro

    // Identify structural boundaries (hook, sections, CTA)
    const boundaries = identifyBoundaries(scenes, scriptContext);

    // Identify fullscreen MG adjacencies (always cut between them)
    const mgCutPoints = identifyMGCutPoints(scenes, motionGraphics);

    // Build transition plan
    const transitions = [];

    for (let i = 0; i < scenes.length - 1; i++) {
        const fromScene = scenes[i];
        const toScene = scenes[i + 1];

        // Check if this is a forced transition point (structural boundary)
        const isBoundary = boundaries.includes(i);

        // Check if this is a forced cut point (adjacent fullscreen MGs)
        const isMGCut = mgCutPoints.includes(i);

        let transitionType = 'cut';
        let duration = 0;

        if (isMGCut) {
            // Always cut between fullscreen MGs
            transitionType = 'cut';
        } else if (isBoundary) {
            // Always transition at structural boundaries
            transitionType = pickTransitionType(format, 'boundary', i, scenes.length, scriptContext);
            duration = TRANSITION_DURATIONS[transitionType] || 500;
        } else {
            // Regular scene transition: use 70/30 (or 60/40 for pro)
            // Seeded by scene index so result is deterministic across builds
            const shouldTransition = seededRandom(i * 7 + scenes.length) < transitionRatio;

            if (shouldTransition) {
                transitionType = pickTransitionType(format, 'regular', i, scenes.length, scriptContext);
                duration = TRANSITION_DURATIONS[transitionType] || 500;
            } else {
                transitionType = 'cut';
            }
        }

        transitions.push({
            fromSceneIndex: i,
            toSceneIndex: i + 1,
            type: transitionType,
            duration
        });
    }

    return transitions;
}

/**
 * Create all cuts (for mini tier or fallback)
 */
function createAllCuts(scenes) {
    const transitions = [];
    for (let i = 0; i < scenes.length - 1; i++) {
        transitions.push({
            fromSceneIndex: i,
            toSceneIndex: i + 1,
            type: 'cut',
            duration: 0
        });
    }
    return transitions;
}

/**
 * Identify structural boundaries where transitions should always occur
 * Returns array of scene indices that mark boundaries
 */
function identifyBoundaries(scenes, scriptContext) {
    const boundaries = [];

    // Hook → Body transition (around 15-30s)
    if (scriptContext?.hookEndTime) {
        const hookEndTime = scriptContext.hookEndTime;
        for (let i = 0; i < scenes.length - 1; i++) {
            const sceneEnd = scenes[i].endTime;
            const nextStart = scenes[i + 1].startTime;
            // If hook ends between these two scenes, mark as boundary
            if (sceneEnd <= hookEndTime && nextStart > hookEndTime) {
                boundaries.push(i);
                break;
            }
        }
    }

    // Section boundaries (listicle format)
    if (scriptContext?.sections && scriptContext.sections.length > 0) {
        for (const section of scriptContext.sections) {
            // Transition at the START of each section (dramatic entry)
            if (section.startSceneIndex > 0) {
                boundaries.push(section.startSceneIndex - 1);
            }
        }
    }

    // Body → CTA transition
    if (scriptContext?.ctaDetected && scriptContext.ctaStartTime) {
        const ctaStart = scriptContext.ctaStartTime;
        for (let i = 0; i < scenes.length - 1; i++) {
            const sceneEnd = scenes[i].endTime;
            const nextStart = scenes[i + 1].startTime;
            // If CTA starts between these two scenes, mark as boundary
            if (sceneEnd <= ctaStart && nextStart >= ctaStart) {
                boundaries.push(i);
                break;
            }
        }
    }

    return boundaries;
}

/**
 * Identify scene transitions where we should ALWAYS cut (adjacent fullscreen MGs)
 * Returns array of scene indices where cuts are forced
 */
function identifyMGCutPoints(scenes, motionGraphics) {
    if (!motionGraphics || motionGraphics.length === 0) return [];

    const cutPoints = [];

    for (let i = 0; i < scenes.length - 1; i++) {
        const currentScene = scenes[i];
        const nextScene = scenes[i + 1];

        // Check if current scene has fullscreen MG
        const currentHasFullscreen = motionGraphics.some(mg =>
            mg.sceneIndex === i && FULLSCREEN_MG_TYPES.has(mg.type)
        );

        // Check if next scene has fullscreen MG
        const nextHasFullscreen = motionGraphics.some(mg =>
            mg.sceneIndex === i + 1 && FULLSCREEN_MG_TYPES.has(mg.type)
        );

        // If both adjacent scenes have fullscreen MGs, force a cut
        if (currentHasFullscreen && nextHasFullscreen) {
            cutPoints.push(i);
        }
    }

    return cutPoints;
}

/**
 * Pick a specific transition type based on theme, format, context, and position
 * @param {string} format - 'documentary' or 'listicle'
 * @param {string} context - 'boundary' (structural) or 'regular'
 * @param {number} index - Current scene index
 * @param {number} totalScenes - Total number of scenes
 * @param {Object} scriptContext - For additional context (tone, mood, themeId)
 * @returns {string} Transition type name
 */
function pickTransitionType(format, context, index, totalScenes, scriptContext) {
    // Get theme-specific transition preferences
    let transitionPool = [];

    if (scriptContext && scriptContext.themeId) {
        const theme = getTheme(scriptContext.themeId);

        if (theme.transitions) {
            // Build pool from theme preferences
            if (context === 'boundary') {
                // Boundaries: use primary transitions (strongest, most thematic)
                transitionPool = [...theme.transitions.primary];
            } else {
                // Regular: mix of primary (70%) and secondary (30%) for variety
                const usePrimary = seededRandom(index * 13 + 3) < 0.7;
                transitionPool = usePrimary
                    ? [...theme.transitions.primary]
                    : [...theme.transitions.secondary];
            }

            // Filter out avoided transitions
            if (theme.transitions.avoid && theme.transitions.avoid.length > 0) {
                transitionPool = transitionPool.filter(t => !theme.transitions.avoid.includes(t));
            }

            // Ensure pool has valid transitions
            if (transitionPool.length > 0) {
                return seededChoice(transitionPool, index * 17 + 11);
            }
        }
    }

    // FALLBACK: No theme or theme has no transition preferences
    // Use format-based selection (original behavior)
    if (context === 'boundary') {
        if (format === 'listicle') {
            // Listicle sections: dramatic wipes/slides
            return seededChoice(['wipe', 'slide', 'zoom', 'push', 'swipe'], index * 19 + 5);
        } else {
            // Documentary boundaries: smooth but noticeable
            return seededChoice(['dissolve', 'fade', 'crossfade', 'crossBlur'], index * 19 + 5);
        }
    }

    // Regular transitions: match format style
    if (format === 'listicle') {
        // Listicle: energetic, variety
        return seededChoice(TRANSITION_TYPES.energetic, index * 23 + 7);
    } else {
        // Documentary: smooth, cinematic
        return seededChoice(TRANSITION_TYPES.smooth, index * 23 + 7);
    }
}

/**
 * Seeded random number generator (deterministic)
 * Same seed always produces the same result (0-1 float)
 */
function seededRandom(seed) {
    let t = (seed | 0) + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Utility: Pick item from array using deterministic seed
 */
function seededChoice(arr, seed) {
    return arr[Math.floor(seededRandom(seed) * arr.length)];
}

/**
 * Get transition statistics (for debugging/logging)
 */
function analyzeTransitionPlan(transitions) {
    const counts = {};
    let cutCount = 0;

    for (const t of transitions) {
        if (t.type === 'cut') {
            cutCount++;
        } else {
            counts[t.type] = (counts[t.type] || 0) + 1;
        }
    }

    const totalTransitions = transitions.length;
    const actualTransitions = totalTransitions - cutCount;
    const ratio = totalTransitions > 0 ? (actualTransitions / totalTransitions * 100).toFixed(1) : 0;

    return {
        total: totalTransitions,
        cuts: cutCount,
        transitions: actualTransitions,
        transitionRatio: `${ratio}%`,
        typeBreakdown: counts
    };
}

module.exports = {
    planTransitions,
    analyzeTransitionPlan,
    TRANSITION_TYPES,
    TRANSITION_DURATIONS,
    TRANSITION_LIBRARY // Export full library for Remotion
};

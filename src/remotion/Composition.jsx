import { AbsoluteFill, Audio, Img, OffthreadVideo, Video, Sequence, staticFile, useVideoConfig, useCurrentFrame, interpolate, Easing, delayRender, continueRender } from 'remotion';
import React, { useEffect, useState, useRef } from 'react';
import { MotionGraphic, STYLES } from './MotionGraphics';
import { VisualEffect } from './VisualEffects';

// Error boundary: catches failed media loads and shows black frame instead of crashing
class MediaErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error) { console.warn('Media load failed:', error.message); }
    render() {
        if (this.state.hasError) return <div style={{ width: '100%', height: '100%', backgroundColor: 'black' }} />;
        return this.props.children;
    }
}

// Full-screen MG background gradients per style
const MG_BACKGROUNDS = {
    clean:    'radial-gradient(ellipse at center, #0a0a2e, #000000)',
    bold:     'radial-gradient(ellipse at center, #1a0000, #0a0a0a)',
    minimal:  'radial-gradient(ellipse at center, #1a1a2e, #0f0f0f)',
    neon:     'radial-gradient(ellipse at center, #000020, #000008)',
    cinematic:'radial-gradient(ellipse at center, #1a1500, #000000)',
    elegant:  'radial-gradient(ellipse at center, #0a0020, #050010)',
};

// All available transition types (legacy UI dropdown)
const TRANSITIONS = ['fade', 'slideLeft', 'slideRight', 'slideUp', 'zoom', 'blur', 'wipe', 'dissolve', 'flash', 'filmBurn'];

// Map UI dropdown values to Remotion transition arrays
// When user picks a specific type from dropdown, it maps to render implementation(s)
const STYLE_MAP = {
    fade: ['fade'],
    slide: ['slideLeft', 'slideRight', 'slideUp'],
    zoom: ['zoom'],
    blur: ['blur'],
    wipe: ['wipe'],
    dissolve: ['dissolve'],
    flash: ['flash'],
    filmBurn: ['filmBurn'],
    random: TRANSITIONS,
    // New dropdown values map through PLANNED_TYPE_MAP via resolveTransition
    auto: TRANSITIONS,
};

// Map planned transition types (from ai-transitions.js TRANSITION_LIBRARY) to Remotion render types
const PLANNED_TYPE_MAP = {
    // Smooth
    'fade': 'fade',
    'dissolve': 'dissolve',
    'crossfade': 'dissolve',
    'crossBlur': 'blur',
    'blur': 'blur',
    'luma': 'lumaWipe',
    'ripple': 'ripple',
    'reveal': 'irisReveal',
    'filmBurn': 'filmBurn',
    'morph': 'morph',
    'dreamFade': 'dreamFade',
    // Energetic
    'wipe': 'wipe',
    'slide': 'slideLeft',
    'zoom': 'zoom',
    'push': 'push',
    'swipe': 'slideRight',
    'whip': 'whip',
    'bounce': 'bounce',
    'shutterSlice': 'shutterSlice',
    'zoomBlur': 'zoomBlur',
    'splitWipe': 'splitWipe',
    // Dramatic / Cinematic
    'flash': 'flash',
    'cameraFlash': 'cameraFlash',
    'flare': 'flare',
    'lightLeak': 'lightLeak',
    'vignetteBlink': 'vignetteBlink',
    'shadowWipe': 'shadowWipe',
    'filmGrain': 'filmGrain',
    'ink': 'ink',
    'directionalBlur': 'directionalBlur',
    'colorFade': 'colorFade',
    'spin': 'spin',
    'prismShift': 'prismShift',
    // Glitchy
    'glitch': 'glitch',
    'pixelate': 'pixelate',
    'mosaic': 'mosaic',
    'dataMosh': 'dataMosh',
    'scanline': 'scanline',
    'rgbSplit': 'rgbSplit',
    'static': 'tvStatic',
};

// Google Fonts URL mapping for theme fonts
const GOOGLE_FONTS_MAP = {
    'Orbitron': 'Orbitron:wght@400;700;900',
    'Roboto': 'Roboto:wght@400;500;600;700;900',
    'Merriweather': 'Merriweather:wght@400;700;900',
    'Open Sans': 'Open+Sans:wght@400;500;600;700',
    'Oswald': 'Oswald:wght@400;500;600;700',
    'Lato': 'Lato:wght@400;700;900',
    'Montserrat': 'Montserrat:wght@400;500;600;700;800;900',
    'Inter': 'Inter:wght@400;500;600;700',
    'Playfair Display': 'Playfair+Display:wght@400;700;900',
    'Cormorant': 'Cormorant:wght@400;500;600;700',
    'Bebas Neue': 'Bebas+Neue',
    'Roboto Condensed': 'Roboto+Condensed:wght@400;500;700',
};

function getGoogleFontsUrl(themeId) {
    if (!themeId) return null;
    try {
        const theme = require('../themes.js').getTheme(themeId);
        const fonts = new Set();
        // Extract primary font name (before fallbacks)
        for (const fontStack of [theme.fonts.heading, theme.fonts.body]) {
            const primary = fontStack.split(',')[0].trim().replace(/["']/g, '');
            if (GOOGLE_FONTS_MAP[primary]) fonts.add(GOOGLE_FONTS_MAP[primary]);
        }
        if (fonts.size === 0) return null;
        return `https://fonts.googleapis.com/css2?${[...fonts].map(f => `family=${f}`).join('&')}&display=swap`;
    } catch { return null; }
}

export const VideoComposition = () => {
    const [plan, setPlan] = useState(null);
    const { fps, width, height } = useVideoConfig();
    const frame = useCurrentFrame();
    const [handle] = useState(() => delayRender('Loading video plan...'));

    useEffect(() => {
        fetch(staticFile('video-plan.json'))
            .then(res => res.json())
            .then(async (data) => {
                // Assign file indices and verify each scene file actually exists
                // This prevents 404 crashes when the plan has more scenes than files
                let fileIdx = 0;
                const checks = [];
                for (const scene of data.scenes) {
                    if (!scene.isMGScene) {
                        scene._fileIdx = fileIdx++;
                        const ext = scene.mediaExtension || (scene.mediaType === 'image' ? '.jpg' : '.mp4');
                        const url = staticFile(`scene-${scene._fileIdx}${ext}`);
                        checks.push(
                            fetch(url, { method: 'HEAD' })
                                .then(r => { scene._fileExists = r.ok; })
                                .catch(() => { scene._fileExists = false; })
                        );
                    }
                }
                await Promise.all(checks);

                // Merge full-screen MG scenes into the scenes array for V3 rendering
                if (data.mgScenes && data.mgScenes.length > 0) {
                    data.scenes = [
                        ...data.scenes,
                        ...data.mgScenes.map(mg => ({
                            ...mg,
                            isMGScene: true,
                            trackId: mg.trackId || 'video-track-3',
                            endTime: mg.endTime || (mg.startTime + mg.duration),
                        }))
                    ];
                }
                return data;
            })
            .then(data => {
                setPlan(data);
                continueRender(handle);
            })
            .catch(err => {
                console.error('Failed to load plan:', err);
                continueRender(handle);
            });
    }, []);

    if (!plan) {
        return <AbsoluteFill style={{ backgroundColor: 'black' }} />;
    }

    // Load Google Fonts for theme
    const fontsUrl = getGoogleFontsUrl(plan.scriptContext?.themeId);

    const defaultTransitionDuration = 20; // frames (~0.67s at 30fps)

    // ========================================
    // Build a lookup from planned transitions (ai-transitions.js output)
    // ========================================
    const plannedTransitionMap = {};
    if (plan.transitions && Array.isArray(plan.transitions)) {
        for (const t of plan.transitions) {
            plannedTransitionMap[t.toSceneIndex] = t;
        }
    }

    // ========================================
    // Resolve which transition type + duration a scene uses
    // Priority: per-scene UI override > planned transition > legacy style dropdown
    // ========================================
    const resolveTransition = (sceneIdx) => {
        const scene = plan.scenes[sceneIdx];

        // 1. Per-scene transition set via the timeline UI takes priority
        const perScene = scene?.transitionType;
        if (perScene && perScene !== 'random' && perScene !== 'auto' && perScene !== 'cut') {
            const mapped = PLANNED_TYPE_MAP[perScene] || STYLE_MAP[perScene]?.[0] || perScene;
            return { type: mapped, durationFrames: defaultTransitionDuration };
        }

        // 2. Explicit 'cut' set by user on this scene = no transition
        if (perScene === 'cut') {
            return { type: 'cut', durationFrames: 0 };
        }

        // 3. Check planned transitions from ai-transitions.js
        const planned = plannedTransitionMap[sceneIdx];
        if (planned && planned.type !== 'cut') {
            const renderType = PLANNED_TYPE_MAP[planned.type] || 'fade';
            const durationFrames = planned.duration ? Math.round((planned.duration / 1000) * fps) : defaultTransitionDuration;
            return { type: renderType, durationFrames };
        }

        // 4. Use dropdown style (planned 'cut' falls through to here so dropdown can override)
        const style = plan.transitionStyle || 'random';
        if (style !== 'random' && style !== 'auto' && PLANNED_TYPE_MAP[style]) {
            return { type: PLANNED_TYPE_MAP[style], durationFrames: defaultTransitionDuration };
        }
        const pool = STYLE_MAP[style] || TRANSITIONS;
        const seed = sceneIdx * 7 + 3;
        const type = pool.length === 1 ? pool[0] : pool[seed % pool.length];
        return { type, durationFrames: defaultTransitionDuration };
    };

    // ========================================
    // Find all scenes active at the current frame (multi-track)
    // ========================================
    const findActiveScenes = () => {
        const activeScenes = [];
        for (let i = 0; i < plan.scenes.length; i++) {
            if (plan.scenes[i].disabled) continue; // Skip disabled clips
            const startFrame = Math.round(plan.scenes[i].startTime * fps);
            const endFrame = Math.round(plan.scenes[i].endTime * fps);
            if (frame >= startFrame && frame < endFrame) {
                activeScenes.push({ scene: plan.scenes[i], index: i });
            }
        }
        // Sort by track (lower track = render first = lower z-index)
        return activeScenes.sort((a, b) => {
            const trackA = parseInt(a.scene.trackId?.match(/\d+/)?.[0] || '1');
            const trackB = parseInt(b.scene.trackId?.match(/\d+/)?.[0] || '1');
            return trackA - trackB;
        });
    };

    const activeScenes = findActiveScenes();

    const mutedTracks = plan.mutedTracks || {};
    const voiceVolume = mutedTracks['audio-track'] ? 0 : 1;

    // During gaps between scenes, show black
    if (activeScenes.length === 0) {
        return (
            <AbsoluteFill style={{ backgroundColor: 'black' }}>
                <Audio src={staticFile(plan.audio)} volume={voiceVolume} />
            </AbsoluteFill>
        );
    }

    // ========================================
    // Transition style helpers (per-track transitions)
    // Enter: how the incoming scene appears (progress 0→1)
    // Exit: how the outgoing scene disappears (progress 0→1)
    // ========================================
    const getEnterStyle = (type, rawProgress) => {
        const p = Easing.out(Easing.cubic)(rawProgress);
        switch (type) {
            // === SMOOTH ===
            case 'fade': return { opacity: p };
            case 'dissolve': return { opacity: Easing.ease(p), transform: `scale(${1.05 - p * 0.05})` };
            case 'blur': return { opacity: p, filter: `blur(${(1 - p) * 20}px)` };
            case 'wipe': return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
            case 'lumaWipe': return { clipPath: `polygon(0 0, ${p * 120}% 0, ${p * 100}% 100%, 0 100%)` };
            case 'ripple': return { opacity: p, transform: `scale(${1 + (1 - p) * 0.08})`, filter: `blur(${(1 - p) * 4}px)` };
            case 'irisReveal': return { clipPath: `circle(${p * 75}% at 50% 50%)` };
            case 'morph': return { opacity: p, transform: `scale(${0.95 + p * 0.05})`, filter: `blur(${(1 - p) * 6}px) brightness(${1 + (1 - p) * 0.2})` };
            case 'dreamFade': return { opacity: p, filter: `blur(${(1 - p) * 12}px) brightness(${1 + (1 - p) * 0.4}) saturate(${0.5 + p * 0.5})` };
            case 'filmBurn': return { opacity: p, filter: `brightness(${1 + (1 - p) * 1.5}) saturate(${1 + (1 - p) * 1}) sepia(${(1 - p) * 0.8})` };
            // === ENERGETIC ===
            case 'slideLeft': return { transform: `translateX(${(1 - p) * width}px)` };
            case 'slideRight': return { transform: `translateX(${-(1 - p) * width}px)` };
            case 'slideUp': return { transform: `translateY(${(1 - p) * height}px)` };
            case 'zoom': return { opacity: p, transform: `scale(${0.5 + p * 0.5})` };
            case 'push': return { transform: `translateX(${(1 - p) * width}px)` };
            case 'whip': return { transform: `translateX(${(1 - p) * width * 1.2}px)`, filter: `blur(${(1 - p) * 25}px)` };
            case 'bounce': {
                const bp = p < 0.6 ? Easing.out(Easing.cubic)(p / 0.6) : 1 + Math.sin((p - 0.6) / 0.4 * Math.PI * 2) * 0.04 * (1 - p);
                return { transform: `scale(${0.3 + bp * 0.7}) translateY(${(1 - bp) * 60}px)`, opacity: p > 0.1 ? 1 : 0 };
            }
            case 'shutterSlice': {
                const slices = 5;
                const revealed = p * 100;
                return { clipPath: `inset(0 0 ${Math.max(0, 100 - revealed)}% 0)`, transform: `scaleY(${0.8 + p * 0.2})` };
            }
            case 'zoomBlur': return { opacity: p, transform: `scale(${2 - p})`, filter: `blur(${(1 - p) * 20}px)` };
            case 'splitWipe': return { clipPath: `inset(${(1 - p) * 50}% 0)` };
            // === DRAMATIC / CINEMATIC ===
            case 'flash': return { opacity: p };
            case 'cameraFlash': return { opacity: p };
            case 'flare': return { opacity: p, filter: `brightness(${1 + (1 - p) * 2}) contrast(${1 + (1 - p) * 0.3})` };
            case 'lightLeak': return { opacity: p, filter: `brightness(${1 + (1 - p) * 1.2}) saturate(${1 + (1 - p) * 0.5})` };
            case 'vignetteBlink': return { opacity: p > 0.15 ? 1 : 0, clipPath: `circle(${p * 70 + 5}% at 50% 50%)` };
            case 'shadowWipe': return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, filter: `brightness(${0.4 + p * 0.6})` };
            case 'filmGrain': return { opacity: p, filter: `contrast(${1 + (1 - p) * 0.3}) sepia(${(1 - p) * 0.4})` };
            case 'ink': return { clipPath: `circle(${p * 85}% at ${50 + (1 - p) * 10}% ${50 - (1 - p) * 10}%)`, filter: `brightness(${0.7 + p * 0.3})` };
            case 'directionalBlur': return { opacity: p, filter: `blur(${(1 - p) * 15}px)`, transform: `translateX(${(1 - p) * 40}px)` };
            case 'colorFade': return { opacity: p };
            case 'spin': return { opacity: p, transform: `scale(${0.3 + p * 0.7}) rotate(${(1 - p) * 90}deg)` };
            case 'prismShift': return { opacity: p, filter: `hue-rotate(${(1 - p) * 60}deg) brightness(${1 + (1 - p) * 0.5})`, transform: `scale(${1.05 - p * 0.05})` };
            // === GLITCHY ===
            case 'glitch': {
                const go = (1 - p) * 20;
                const s = Math.floor((1 - p) * 5);
                return { opacity: p > 0.1 ? 1 : 0, transform: `translateX(${s % 2 === 0 ? go : -go}px)`, filter: `hue-rotate(${(1 - p) * 90}deg)` };
            }
            case 'pixelate': return { opacity: p, filter: `blur(${(1 - p) * 8}px) contrast(${1 + (1 - p) * 0.5})` };
            case 'mosaic': return { opacity: p, filter: `contrast(${1 + (1 - p) * 0.5})` };
            case 'dataMosh': {
                const dm = (1 - p) * 30;
                return { opacity: p > 0.05 ? 1 : 0, transform: `translateX(${Math.sin(p * 20) * dm}px) skewX(${(1 - p) * 8}deg)`, filter: `hue-rotate(${(1 - p) * 120}deg) saturate(${1 + (1 - p) * 2})` };
            }
            case 'scanline': return { opacity: p, filter: `contrast(${1 + (1 - p) * 0.6}) brightness(${1 - (1 - p) * 0.3})` };
            case 'rgbSplit': return { opacity: p, filter: `hue-rotate(${(1 - p) * 60}deg) saturate(${1 + (1 - p) * 2})`, transform: `translateX(${(1 - p) * 8}px)` };
            case 'tvStatic': return { opacity: p > 0.15 ? p : 0, filter: `contrast(${1 + (1 - p) * 1}) brightness(${1 + (1 - p) * 0.5}) grayscale(${(1 - p) * 0.6})` };
            default: return { opacity: p };
        }
    };

    const getExitStyle = (type, rawProgress) => {
        const p = Easing.in(Easing.cubic)(rawProgress);
        switch (type) {
            // === SMOOTH ===
            case 'dissolve': return { opacity: 1 - Easing.ease(p), transform: `scale(${1 + p * 0.05})` };
            case 'blur': return { opacity: 1 - p, filter: `blur(${p * 20}px)` };
            case 'lumaWipe': return {};
            case 'ripple': return { opacity: 1 - p, transform: `scale(${1 - p * 0.05})`, filter: `blur(${p * 4}px)` };
            case 'morph': return { opacity: 1 - p, transform: `scale(${1 + p * 0.05})`, filter: `blur(${p * 6}px)` };
            case 'dreamFade': return { opacity: 1 - p, filter: `blur(${p * 12}px) brightness(${1 + p * 0.3})` };
            case 'filmBurn': return { opacity: 1 - p, filter: `brightness(${1 + p * 2}) saturate(${1 + p * 1.5}) sepia(${p})` };
            // === ENERGETIC ===
            case 'slideLeft': return { transform: `translateX(${-p * width}px)` };
            case 'slideRight': return { transform: `translateX(${p * width}px)` };
            case 'slideUp': return { transform: `translateY(${-p * height}px)` };
            case 'zoom': return { opacity: 1 - p, transform: `scale(${1 + p * 0.5})` };
            case 'push': return { transform: `translateX(${-p * width}px)` };
            case 'whip': return { transform: `translateX(${-p * width * 1.2}px)`, filter: `blur(${p * 25}px)` };
            case 'bounce': return { opacity: 1 - p, transform: `scale(${1 - p * 0.3})` };
            case 'shutterSlice': return { clipPath: `inset(${p * 100}% 0 0 0)` };
            case 'zoomBlur': return { opacity: 1 - p, transform: `scale(${1 + p})`, filter: `blur(${p * 20}px)` };
            case 'splitWipe': return { clipPath: `inset(${p * 50}% 0)` };
            // === DRAMATIC / CINEMATIC ===
            case 'flash': return { opacity: 1 - p };
            case 'cameraFlash': return { opacity: 1 - p };
            case 'flare': return { opacity: 1 - p, filter: `brightness(${1 + p * 1.5})` };
            case 'lightLeak': return { opacity: 1 - p, filter: `brightness(${1 + p * 1.2})` };
            case 'vignetteBlink': return {}; // Outgoing stays, blink reveals incoming
            case 'irisReveal': return {};
            case 'shadowWipe': return {}; // Outgoing stays, shadow wipes incoming over
            case 'filmGrain': return { opacity: 1 - p, filter: `contrast(${1 + p * 0.3}) sepia(${p * 0.5})` };
            case 'ink': return {}; // Outgoing stays, ink reveals incoming
            case 'directionalBlur': return { opacity: 1 - p, filter: `blur(${p * 15}px)`, transform: `translateX(${-p * 40}px)` };
            case 'colorFade': return { opacity: 1 - p, filter: `saturate(${1 - p * 0.8}) brightness(${1 + p * 0.5})` };
            case 'spin': return { opacity: 1 - p, transform: `scale(${1 + p * 0.5}) rotate(${p * 90}deg)` };
            case 'prismShift': return { opacity: 1 - p, filter: `hue-rotate(${p * 60}deg)`, transform: `scale(${1 + p * 0.05})` };
            // === GLITCHY ===
            case 'glitch': {
                const go = p * 20;
                return { transform: `translateX(${p > 0.5 ? -go : go}px)`, filter: `hue-rotate(${p * 180}deg)`, opacity: 1 - p };
            }
            case 'pixelate': return { opacity: 1 - p, filter: `blur(${p * 8}px) contrast(${1 + p * 0.5})` };
            case 'mosaic': return { opacity: 1 - p, filter: `contrast(${1 + p * 0.5})` };
            case 'dataMosh': {
                return { opacity: 1 - p, transform: `translateX(${Math.sin(p * 20) * p * 30}px) skewX(${p * 8}deg)`, filter: `hue-rotate(${p * 120}deg)` };
            }
            case 'scanline': return { opacity: 1 - p, filter: `contrast(${1 + p * 0.6}) brightness(${1 - p * 0.4})` };
            case 'rgbSplit': return { opacity: 1 - p, filter: `hue-rotate(${p * 60}deg) saturate(${1 + p * 2})`, transform: `translateX(${-p * 8}px)` };
            case 'tvStatic': return { opacity: 1 - p, filter: `contrast(${1 + p * 1}) grayscale(${p * 0.8})` };
            default: return {}; // fade, wipe: outgoing stays, incoming covers
        }
    };

    // Find the previous time-adjacent scene for transitions
    // Scenes may alternate between tracks (video-track-1, video-track-2) so we find
    // the scene that ends right when this one starts, regardless of which video track it's on
    const findPrevSceneOnTrack = (sceneIdx) => {
        const scene = plan.scenes[sceneIdx];
        if (scene.isOverlay || scene.isMGScene) return null;
        const startFrame = Math.round(scene.startTime * fps);
        // Look backwards for the closest scene ending at or near our start
        let best = null;
        for (let i = sceneIdx - 1; i >= 0; i--) {
            const prev = plan.scenes[i];
            if (prev.isOverlay || prev.isMGScene || prev.disabled) continue;
            const prevEndFrame = Math.round(prev.endTime * fps);
            if (Math.abs(startFrame - prevEndFrame) <= 1) {
                best = { scene: prev, index: i };
                break;
            }
            // Stop searching if we've gone too far back in time
            if (prevEndFrame < startFrame - fps) break;
        }
        return best;
    };

    // ========================================
    // Ken Burns animation types for image scenes
    // ========================================
    const KEN_BURNS = [
        'zoomIn',        // slow zoom into center
        'zoomOut',       // start zoomed, slowly pull back
        'panLeft',       // slow pan right to left
        'panRight',      // slow pan left to right
        'panUp',         // slow pan bottom to top
        'panDown',       // slow pan top to bottom
        'zoomPanRight',  // zoom in + drift right
        'zoomPanLeft',   // zoom in + drift left
        'zoomOutPanRight',  // zoom out + drift right
        'zoomOutPanLeft',   // zoom out + drift left
        'driftTopLeftToBottomRight',   // diagonal drift
        'driftBottomRightToTopLeft',   // diagonal drift
        'driftTopRightToBottomLeft',   // diagonal drift
        'driftBottomLeftToTopRight',   // diagonal drift
    ];

    const getKenBurnsStyle = (type, progress, gentle = false) => {
        // Linear motion (no easing) - constant speed feels like endless camera drift
        // gentle mode: reduced values for contain images (charts, infographics)
        const p = progress;
        const s = gentle ? 0.4 : 1; // scale factor for gentle mode
        switch (type) {
            case 'zoomIn':
                return { transform: `scale(${1 + (0.03 + p * 0.12) * s})` };
            case 'zoomOut':
                return { transform: `scale(${1 + (0.15 - p * 0.12) * s})` };
            case 'panLeft':
                return { transform: `scale(${1 + 0.12 * s}) translateX(${(3 - p * 6) * s}%)` };
            case 'panRight':
                return { transform: `scale(${1 + 0.12 * s}) translateX(${(-3 + p * 6) * s}%)` };
            case 'panUp':
                return { transform: `scale(${1 + 0.12 * s}) translateY(${(3 - p * 6) * s}%)` };
            case 'panDown':
                return { transform: `scale(${1 + 0.12 * s}) translateY(${(-3 + p * 6) * s}%)` };
            case 'zoomPanRight':
                return { transform: `scale(${1 + (0.05 + p * 0.1) * s}) translateX(${(-2 + p * 4) * s}%)` };
            case 'zoomPanLeft':
                return { transform: `scale(${1 + (0.05 + p * 0.1) * s}) translateX(${(2 - p * 4) * s}%)` };
            case 'zoomOutPanRight':
                return { transform: `scale(${1 + (0.15 - p * 0.08) * s}) translateX(${(-2 + p * 4) * s}%)` };
            case 'zoomOutPanLeft':
                return { transform: `scale(${1 + (0.15 - p * 0.08) * s}) translateX(${(2 - p * 4) * s}%)` };
            case 'driftTopLeftToBottomRight':
                return { transform: `scale(${1 + 0.15 * s}) translateX(${(-2 + p * 4) * s}%) translateY(${(-2 + p * 4) * s}%)` };
            case 'driftBottomRightToTopLeft':
                return { transform: `scale(${1 + 0.15 * s}) translateX(${(2 - p * 4) * s}%) translateY(${(2 - p * 4) * s}%)` };
            case 'driftTopRightToBottomLeft':
                return { transform: `scale(${1 + 0.15 * s}) translateX(${(2 - p * 4) * s}%) translateY(${(-2 + p * 4) * s}%)` };
            case 'driftBottomLeftToTopRight':
                return { transform: `scale(${1 + 0.15 * s}) translateX(${(-2 + p * 4) * s}%) translateY(${(2 - p * 4) * s}%)` };
            default:
                return { transform: `scale(${1 + (0.03 + p * 0.12) * s})` };
        }
    };

    const resolveKenBurns = (scene, sceneIdx) => {
        const baseIdx = Number.isFinite(scene?.index) ? scene.index : sceneIdx;
        const seed = baseIdx * 13 + 7;
        return KEN_BURNS[seed % KEN_BURNS.length];
    };

    // ========================================
    // Render a scene's media (video or image) + text (used inside a Sequence)
    // startFrom = mediaOffsetFrames (always >= 0, Sequence handles frame offset)
    // ========================================
    const renderScene = (scene, sceneIdx) => {
        // Full-screen MG scene: render MotionGraphic with opaque background
        if (scene.isMGScene) {
            const mgData = {
                type: scene.type,
                text: scene.text,
                subtext: scene.subtext || '',
                style: scene.style || plan.mgStyle || 'clean',
                duration: (scene.endTime - scene.startTime),
                startTime: scene.startTime,
                ...(scene.mgData || {}),
                position: 'center', // Full-screen MGs always centered
            };
            // Pass map visual style for mapChart (scene > mgData > plan-level > default)
            if (mgData.type === 'mapChart') {
                mgData.mapStyle = scene.mapStyle || (scene.mgData && scene.mgData.mapStyle) || plan.mapStyle || 'dark';
            }
            // mapChart renders its own full-frame background (ocean/land) — skip wrapper bg + scale
            if (mgData.type === 'mapChart') {
                return (
                    <AbsoluteFill>
                        <MotionGraphic mg={mgData} scriptContext={plan.scriptContext} />
                    </AbsoluteFill>
                );
            }
            // articleHighlight renders its own card with 3D transforms — uses bg gradient but no scale(1.5)
            if (mgData.type === 'articleHighlight') {
                const bgStyle = MG_BACKGROUNDS[mgData.style] || MG_BACKGROUNDS.clean;
                return (
                    <AbsoluteFill style={{ background: bgStyle }}>
                        <MotionGraphic mg={mgData} scriptContext={plan.scriptContext} />
                    </AbsoluteFill>
                );
            }
            const bgStyle = MG_BACKGROUNDS[mgData.style] || MG_BACKGROUNDS.clean;
            return (
                <AbsoluteFill style={{ background: bgStyle }}>
                    <AbsoluteFill style={{ transform: 'scale(1.5)', transformOrigin: 'center center' }}>
                        <MotionGraphic mg={mgData} scriptContext={plan.scriptContext} />
                    </AbsoluteFill>
                </AbsoluteFill>
            );
        }

        // _fileIdx is precomputed during plan load: sequential position among regular scenes
        const fileIdx = scene._fileIdx !== undefined ? scene._fileIdx : sceneIdx;
        const mediaOffsetFrames = scene.mediaOffset ? Math.round(scene.mediaOffset * fps) : 0;
        const isImage = scene.mediaType === 'image';
        const ext = scene.mediaExtension || (isImage ? '.jpg' : '.mp4');

        // Skip scenes with no media file or missing file — show black instead of crashing
        if (!scene.mediaFile || scene._fileExists === false) {
            return <AbsoluteFill style={{ backgroundColor: 'black' }} />;
        }

        // Compute video audio volume: 0 if track muted, else per-clip volume
        const trackId = scene.trackId || 'video-track-1';
        const trackMuted = mutedTracks[trackId] === true;
        const clipVolume = trackMuted ? 0 : (scene.volume !== undefined ? scene.volume : 1);

        const sceneScale = scene.scale !== undefined ? scene.scale : 1;
        const scenePosX = scene.posX || 0;
        const scenePosY = scene.posY || 0;
        const hasTransform = sceneScale !== 1 || scenePosX !== 0 || scenePosY !== 0;
        const fitMode = scene.fitMode || 'cover';

        // Crop
        const cropTop = scene.cropTop || 0;
        const cropRight = scene.cropRight || 0;
        const cropBottom = scene.cropBottom || 0;
        const cropLeft = scene.cropLeft || 0;
        const hasCrop = cropTop || cropRight || cropBottom || cropLeft;
        const cropStyle = hasCrop ? { clipPath: `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)` } : {};

        // Round corners
        const borderRadius = scene.borderRadius || 0;
        const radiusStyle = borderRadius ? { borderRadius: `${borderRadius}%`, overflow: 'hidden' } : {};

        // Ken Burns animation for images (gentle mode for contain — keeps image mostly visible)
        let kenBurnsStyle = {};
        if (isImage && scene.kenBurnsEnabled !== false) {
            const startFrame = Math.round(scene.startTime * fps);
            const endFrame = Math.round(scene.endTime * fps);
            const sceneDuration = endFrame - startFrame;
            const localFrame = frame - startFrame;
            const progress = sceneDuration > 0 ? Math.max(0, Math.min(1, localFrame / sceneDuration)) : 0;
            const kenBurnsType = resolveKenBurns(scene, sceneIdx);
            kenBurnsStyle = getKenBurnsStyle(kenBurnsType, progress, fitMode === 'contain');
        }

        // Background layer: blur duplicate or pattern behind scaled/repositioned footage
        const bgType = scene.background || 'none';
        const showBackground = bgType !== 'none' && (hasTransform || fitMode === 'contain');
        const mediaSrc = isImage ? staticFile(`scene-${fileIdx}${ext}`) : staticFile(`scene-${fileIdx}.mp4`);

        // Single wrapper div creates a proper containing block for all children.
        // This ensures parent transition transforms (enter/exit styles) work correctly.
        return (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                {/* Background layer: blur duplicate or pattern */}
                {showBackground && bgType === 'blur' && (
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                        <div style={{ width: '100%', height: '100%', filter: 'blur(25px)', transform: 'scale(1.3)', transformOrigin: 'center center' }}>
                            <MediaErrorBoundary>
                                {isImage ? (
                                    <Img src={mediaSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <Video src={mediaSrc} startFrom={mediaOffsetFrames} volume={0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                )}
                            </MediaErrorBoundary>
                        </div>
                    </div>
                )}
                {showBackground && bgType.startsWith('pattern:') && (() => {
                    const bgFilename = bgType.replace('pattern:', '');
                    const bgExt = bgFilename.match(/\.(mp4|webm|mov|jpg|jpeg|png|gif)$/i)?.[0] || '.jpg';
                    const isBgVideo = ['.mp4', '.webm', '.mov'].includes(bgExt.toLowerCase());
                    return (
                        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                            <MediaErrorBoundary>
                                {isBgVideo ? (
                                    <Video src={staticFile(`bg-${bgFilename}`)} volume={0} loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <Img src={staticFile(`bg-${bgFilename}`)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                )}
                            </MediaErrorBoundary>
                        </div>
                    );
                })()}
                {showBackground && bgType.startsWith('gradient:') && (() => {
                    const gradientId = bgType.replace('gradient:', '');
                    try {
                        const bgLib = require('../themes.js').BACKGROUND_LIBRARY;
                        const bg = bgLib[gradientId];
                        if (bg) {
                            return <div style={{ position: 'absolute', inset: 0, background: bg.css }} />;
                        }
                    } catch (e) { /* themes not available */ }
                    return <div style={{ position: 'absolute', inset: 0, background: '#000' }} />;
                })()}
                {/* Main footage layer */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...radiusStyle }}>
                    <MediaErrorBoundary>
                        {isImage ? (
                            <Img src={mediaSrc} style={{
                                width: '100%', height: '100%', objectFit: fitMode,
                                transform: [
                                    hasTransform ? `translate(${scenePosX}%, ${scenePosY}%) scale(${sceneScale})` : '',
                                    kenBurnsStyle.transform || ''
                                ].filter(Boolean).join(' ') || undefined,
                                transformOrigin: 'center center',
                                willChange: 'transform',
                                ...cropStyle,
                            }} />
                        ) : (
                            <OffthreadVideo src={mediaSrc} startFrom={mediaOffsetFrames} volume={clipVolume} style={{
                                width: '100%', height: '100%', objectFit: fitMode,
                                ...(hasTransform ? {
                                    transform: `translate(${scenePosX}%, ${scenePosY}%) scale(${sceneScale})`,
                                    transformOrigin: 'center center',
                                } : {}),
                                ...cropStyle,
                            }} />
                        )}
                    </MediaErrorBoundary>
                </div>
                {/* Subtitles (only when enabled) */}
                {plan.subtitlesEnabled && (
                <div style={{ position: 'absolute', bottom: 80, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ backgroundColor: 'rgba(0,0,0,0.7)', padding: '15px 30px', borderRadius: 10, maxWidth: '80%' }}>
                        <p style={{ color: 'white', fontSize: 32, fontWeight: 'bold', textAlign: 'center', margin: 0 }}>{scene.text}</p>
                    </div>
                </div>
                )}
            </div>
        );
    };

    // ========================================
    // Main render - Multi-track compositing with per-track transitions
    // ========================================
    // Collect extra scenes needed for transitions (outgoing scenes that just ended)
    const transitionExtras = [];
    activeScenes.forEach(({ scene, index }) => {
        const currentStartFrame = Math.round(scene.startTime * fps);
        const prev = findPrevSceneOnTrack(index);
        if (prev) {
            const prevEndFrame = Math.round(prev.scene.endTime * fps);
            const adjacent = Math.abs(currentStartFrame - prevEndFrame) <= 1;
            const resolved = resolveTransition(index);
            const transDur = resolved.durationFrames || defaultTransitionDuration;
            if (adjacent && resolved.type !== 'cut' && frame < currentStartFrame + transDur) {
                // We're in a transition zone - need to render the outgoing scene too
                transitionExtras.push({ scene: prev.scene, index: prev.index, incomingIdx: index, resolved });
            }
        }
    });

    return (
        <AbsoluteFill style={{ backgroundColor: 'black', overflow: 'hidden' }}>
            {/* Load Google Fonts for theme */}
            {fontsUrl && (
                <style dangerouslySetInnerHTML={{
                    __html: `@import url('${fontsUrl}');`
                }} />
            )}
            <Audio src={staticFile(plan.audio)} volume={voiceVolume} />

            {/* SFX clips at transition points */}
            {plan.sfxEnabled !== false && !mutedTracks['sfx-track'] && plan.sfxClips?.map((sfx, i) => {
                const sfxStartFrame = Math.round(sfx.startTime * fps);
                const sfxDurationFrames = Math.max(1, Math.round(sfx.duration * fps));
                return (
                    <Sequence
                        key={`sfx-${i}`}
                        from={sfxStartFrame}
                        durationInFrames={sfxDurationFrames}
                        layout="none"
                    >
                        <Audio
                            src={staticFile(sfx.file)}
                            volume={sfx.volume ?? 0.35}
                        />
                    </Sequence>
                );
            })}

            {/* Render outgoing scenes (transition extras) */}
            {transitionExtras.map(({ scene, index, incomingIdx, resolved }) => {
                const prevStartFrame = Math.round(scene.startTime * fps);
                const prevEndFrame = Math.round(scene.endTime * fps);
                const prevDuration = prevEndFrame - prevStartFrame;
                const incomingStartFrame = Math.round(plan.scenes[incomingIdx].startTime * fps);
                const transDur = resolved.durationFrames || defaultTransitionDuration;
                const transProgress = interpolate(
                    frame,
                    [incomingStartFrame, incomingStartFrame + transDur],
                    [0, 1],
                    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
                );
                const exitStyle = getExitStyle(resolved.type, transProgress);

                return (
                    <Sequence
                        key={`exit-${index}-${scene.trackId}`}
                        from={prevStartFrame}
                        durationInFrames={prevDuration + transDur}
                        layout="none"
                    >
                        <AbsoluteFill style={{
                            zIndex: 1, // outgoing scene always renders below incoming
                            overflow: 'hidden',
                            ...exitStyle,
                            willChange: 'transform, opacity, filter',
                        }}>
                            {renderScene(scene, index)}
                        </AbsoluteFill>
                    </Sequence>
                );
            })}

            {/* Render all active scenes stacked by track */}
            {activeScenes.map(({ scene, index }) => {
                const startFrame = Math.round(scene.startTime * fps);
                const endFrame = Math.round(scene.endTime * fps);
                const duration = endFrame - startFrame;
                const trackNum = parseInt(scene.trackId?.match(/\d+/)?.[0] || '1');

                // Check if this scene is in a transition zone
                const prev = findPrevSceneOnTrack(index);
                let enterStyle = {};
                let overlayType = null;
                let overlayTd = defaultTransitionDuration;
                if (prev) {
                    const prevEndFrame = Math.round(prev.scene.endTime * fps);
                    const adjacent = Math.abs(startFrame - prevEndFrame) <= 1;
                    const resolved = resolveTransition(index);
                    const transDur = resolved.durationFrames || defaultTransitionDuration;
                    if (adjacent && resolved.type !== 'cut' && frame < startFrame + transDur) {
                        overlayType = resolved.type;
                        overlayTd = transDur;
                        const transProgress = interpolate(
                            frame,
                            [startFrame, startFrame + transDur],
                            [0, 1],
                            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
                        );
                        enterStyle = getEnterStyle(resolved.type, transProgress);
                    }
                }

                return (
                    <Sequence
                        key={`${index}-${scene.trackId}`}
                        from={startFrame}
                        durationInFrames={duration}
                        layout="none"
                    >
                        {/* Transition overlay effects (flash, flare, vignette, etc.) */}
                        {overlayType && (() => {
                            const td = overlayTd;
                            const localF = frame - startFrame;
                            const overlayStyles = {
                                flash: { bg: 'white', opacity: interpolate(localF, [td*0.3, td*0.5, td*0.7], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                cameraFlash: { bg: 'white', opacity: interpolate(localF, [0, td*0.15, td*0.3, td*0.6], [0, 1, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                filmBurn: { bg: 'radial-gradient(ellipse at center, rgba(255,160,40,0.5), rgba(255,100,10,0.3))', opacity: interpolate(localF, [0, td*0.4, td*0.6, td], [0, 0.6, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                colorFade: { bg: 'radial-gradient(ellipse at center, rgba(20,20,60,0.7), rgba(0,0,30,0.5))', opacity: interpolate(localF, [0, td*0.3, td*0.7, td], [0, 0.7, 0.6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                flare: { bg: 'radial-gradient(circle at 60% 40%, rgba(255,240,200,0.9), rgba(255,200,100,0.4), transparent 70%)', opacity: interpolate(localF, [0, td*0.3, td*0.7, td], [0, 0.8, 0.6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                lightLeak: { bg: 'linear-gradient(135deg, rgba(255,180,80,0.6), rgba(255,100,50,0.3), transparent)', opacity: interpolate(localF, [0, td*0.35, td*0.65, td], [0, 0.7, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                vignetteBlink: { bg: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.95) 70%)', opacity: interpolate(localF, [0, td*0.2, td*0.4, td*0.6], [0, 1, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                prismShift: { bg: 'linear-gradient(120deg, rgba(255,0,0,0.15), rgba(0,255,0,0.15), rgba(0,0,255,0.15))', opacity: interpolate(localF, [0, td*0.3, td*0.7, td], [0, 0.6, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                filmGrain: { bg: 'rgba(0,0,0,0.1)', opacity: interpolate(localF, [0, td*0.3, td*0.7, td], [0, 0.4, 0.3, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                tvStatic: { bg: 'rgba(200,200,200,0.5)', opacity: interpolate(localF, [0, td*0.2, td*0.5, td], [0, 0.7, 0.4, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                                dataMosh: { bg: 'linear-gradient(90deg, rgba(255,0,50,0.3), rgba(0,255,50,0.2), rgba(50,0,255,0.3))', opacity: interpolate(localF, [0, td*0.2, td*0.6, td], [0, 0.5, 0.3, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) },
                            };
                            const cfg = overlayStyles[overlayType];
                            if (!cfg || cfg.opacity <= 0.01) return null;
                            return (
                                <AbsoluteFill style={{
                                    background: cfg.bg,
                                    opacity: cfg.opacity,
                                    zIndex: trackNum + 10,
                                    pointerEvents: 'none',
                                }} />
                            );
                        })()}
                        <AbsoluteFill style={{
                            zIndex: trackNum + 1,
                            overflow: 'hidden',
                            ...enterStyle,
                            willChange: 'transform, opacity, filter',
                        }}>
                            {renderScene(scene, index)}
                        </AbsoluteFill>
                    </Sequence>
                );
            })}

            {/* Overlay effects (z-index 35: video + image overlays — grain, dust, CRT, scanlines, etc.) */}
            {!mutedTracks['overlay-track'] && plan.overlayScenes?.map((overlay, i) => {
                const startFrame = Math.round(overlay.startTime * fps);
                const endFrame = Math.round(overlay.endTime * fps);
                const duration = endFrame - startFrame;
                if (duration <= 0) return null;
                const isImage = overlay.mediaType === 'image' || ['.jpg', '.jpeg', '.png', '.gif'].includes(overlay.mediaExtension);
                const ext = overlay.mediaExtension || '.mp4';
                const overlayFile = `overlay-${overlay.index}${ext}`;
                return (
                    <Sequence key={`overlay-${i}`} from={startFrame} durationInFrames={duration} layout="none">
                        <AbsoluteFill style={{
                            zIndex: 35, pointerEvents: 'none',
                            mixBlendMode: overlay.blendMode || 'screen',
                            opacity: overlay.overlayIntensity || 0.5,
                        }}>
                            {isImage ? (
                                <Img
                                    src={staticFile(overlayFile)}
                                    style={{
                                        width: '100%', height: '100%', objectFit: 'cover',
                                        transform: overlay.scale && overlay.scale !== 1 ? `scale(${overlay.scale})` : undefined,
                                    }}
                                />
                            ) : (
                                <OffthreadVideo
                                    src={staticFile(overlayFile)}
                                    volume={0}
                                    style={{
                                        width: '100%', height: '100%', objectFit: 'cover',
                                        transform: overlay.scale && overlay.scale !== 1 ? `scale(${overlay.scale})` : undefined,
                                    }}
                                />
                            )}
                        </AbsoluteFill>
                    </Sequence>
                );
            })}

            {/* Code-generated visual effects (z-index 40: vignette, chromatic, letterbox, colorTint) */}
            {plan.visualEffects?.map((vfxEntry, vi) => {
                const scene = plan.scenes?.[vfxEntry.sceneIndex];
                if (!scene || !vfxEntry.effects?.length) return null;
                const vfxStart = Math.round(scene.startTime * fps);
                const vfxEnd = Math.round(scene.endTime * fps);
                const vfxDuration = vfxEnd - vfxStart;
                if (vfxDuration <= 0) return null;
                // Build set of overlay-covered types to avoid duplication
                const overlayCovered = new Set();
                plan.overlayScenes?.forEach(ov => {
                    if (ov.overlayType) overlayCovered.add(ov.overlayType);
                });
                return vfxEntry.effects
                    .filter(e => e.renderMode === 'css' && !overlayCovered.has(e.type))
                    .map((effect, ei) => (
                        <Sequence
                            key={`vfx-${vi}-${ei}`}
                            from={vfxStart}
                            durationInFrames={vfxDuration}
                            layout="none"
                        >
                            <AbsoluteFill style={{ zIndex: 40, pointerEvents: 'none' }}>
                                <VisualEffect effect={effect} />
                            </AbsoluteFill>
                        </Sequence>
                    ));
            })}

            {/* Motion Graphics overlays */}
            {plan.mgEnabled !== false && plan.motionGraphics?.map((mg, i) => {
                const mgStartFrame = Math.round(mg.startTime * fps);
                const mgDurationFrames = Math.max(1, Math.round(mg.duration * fps));
                return (
                    <Sequence
                        key={`mg-${i}`}
                        from={mgStartFrame}
                        durationInFrames={mgDurationFrames}
                        layout="none"
                    >
                        <AbsoluteFill style={{ zIndex: mg.type === 'animatedIcons' ? 4 : 50, pointerEvents: 'none' }}>
                            <MotionGraphic mg={mg} scriptContext={plan.scriptContext} />
                        </AbsoluteFill>
                    </Sequence>
                );
            })}
        </AbsoluteFill>
    );
};

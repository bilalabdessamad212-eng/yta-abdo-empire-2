# VidRush-Inspired Pipeline Implementation Status

## ✅ COMPLETED (Phases 1-5, 3A-3C, 4)

### **Phase 1: Foundation**
✅ **src/ai-provider.js** — Shared AI calling layer
- Eliminated ~300 lines of duplicate code across 6 modules
- Supports 7 providers: Ollama, Claude, OpenAI, DeepSeek, Qwen, Gemini, NVIDIA
- Handles both text and vision AI calls
- 8x token multiplier for Gemini 2.5+ thinking models

✅ **src/directors-brief.js** — Structured user input
- Quality tiers: Mini (fast), Standard (balanced), Pro (best)
- Format selection: Auto, Documentary, Listicle
- Theme override: Auto (AI decides) or manual selection
- Scene density: Mini=5/min, Standard=4/min, Pro=3.5/min

### **Phase 2: Core Intelligence**
✅ **src/ai-director.js** — Scene creation + context analysis
- Replaces old ai-scenes.js + ai-context.js
- Web search integration (Gemini Search Grounding)
- Format detection (documentary vs listicle)
- CTA detection (ctaDetected, ctaStartTime)
- Hook detection (hookEndTime)
- Section detection (for listicle)
- Theme selection (auto or manual override)
- Dynamic scene density based on pacing
- Post-processing auto-split for scenes >8s

✅ **src/ai-visual-planner.js** — Batch keyword generation
- Replaces old ai-keywords.js
- 1 AI call for ALL scenes (instead of N calls)
- Entity awareness (real people → web-image)
- Source variety (stock/YouTube/web-image)
- User instructions have highest priority
- Visual intent field for better planning

### **Phase 3A: Smart Transitions (EXPANDED)**
✅ **src/ai-transitions.js** — 70/30 rule + theme integration
- Algorithmic planning (no AI cost)
- **20 transition types** (up from 6):
  - Smooth (8): fade, dissolve, crossfade, crossBlur, ripple, blur, luma, reveal
  - Energetic (5): wipe, slide, zoom, push, swipe
  - Dramatic (4): flash, directionalBlur, colorFade, spin
  - Glitchy (3): glitch, pixelate, mosaic
- Quality tier control:
  - Mini: 100% cuts
  - Standard: ~70/30 (70% cuts, 30% transitions)
  - Pro: ~60/40 (more cinematic)
- **Theme-aware selection**:
  - Each theme defines primary/secondary/avoid transition lists
  - Boundaries use primary transitions (most thematic)
  - Regular uses 70% primary, 30% secondary mix
  - Avoid lists are strictly respected
- Smart rules:
  - Always transition at: hook→body, sections, body→CTA
  - Always cut at: adjacent fullscreen MGs
- Returns transition plan array with type and duration

✅ **src/themes.js** — Transition library + SFX mapping
- TRANSITION_LIBRARY: All 20 transitions with metadata
  - Category, duration, intensity, SFX file
  - Duration range: 300-700ms (avg 508ms)
- TRANSITION_SFX_SOURCES: 13 sound effects mapped
  - Keywords for downloading from stock audio sites
  - whoosh-soft, whoosh-fast, swipe, slide, push, zoom-in, camera-flash, glitch, digital-glitch, pixelate, water-ripple, spin
- Each theme's transition preferences:
  - Tech: glitch, pixelate, flash (primary)
  - Nature: dissolve, crossBlur, fade, ripple (primary)
  - Crime: flash, wipe, luma, directionalBlur (primary)
  - Corporate: push, slide, fade, crossBlur (primary)
  - Luxury: dissolve, crossBlur, colorFade, luma (primary)
  - Sport: swipe, push, directionalBlur, zoom (primary)
  - Neutral: balanced mix (allows all)

### **Phase 3B: Unified Theme System**
✅ **src/themes.js** — 7 professional themes
- **Tech/Cyberpunk**: neon style, tech-grid bg, cyan/magenta
- **Nature Documentary**: cinematic style, nature bg, earth tones
- **True Crime/Dark**: cinematic style, dark bg, red/gold
- **Corporate/Professional**: clean style, light bg, blue/gray
- **Luxury/Fashion**: elegant style, warm bg, gold/silver
- **Sports/Action**: bold style, dark bg, orange/gold
- **Neutral/Balanced**: clean style, neutral bg (fallback)

Each theme controls:
- Background canvas type
- Motion graphics style
- Color palette (primary, secondary, accent, text)
- Font families (heading, body)

✅ **AI Director theme selection**
- Auto: AI picks best theme based on content keywords
- Manual: User override via BUILD_THEME env var
- Theme flows to all downstream steps

✅ **Background canvas download**
- src/footage-manager.js: downloadBackgroundCanvas()
- Downloads subtle texture videos from Pexels/Pixabay
- Cached in assets/backgrounds/
- Keywords defined per theme in BACKGROUND_SOURCES

✅ **UI settings**
- Build Settings panel added to ui/index.html
- Quality dropdown (Mini/Standard/Pro)
- Format dropdown (Auto/Documentary/Listicle)
- Theme dropdown (Auto + 7 manual themes)
- Wired through main.js and app.js

### **Phase 3C: CTA Subscribe Overlay**
✅ **Auto-insertion logic**
- ai-motion-graphics.js: Auto-inserts when ctaDetected === true
- Type: subscribeCTA
- Position: bottom-right
- Duration: 4 seconds
- Style: Bell icon + pulse animation
- No AI call needed (rule-based)

### **Phase 4: Cleanup**
✅ **Refactored modules** (~300 lines removed)
- ai-vision.js: Now uses shared callVisionAI
- ai-motion-graphics.js: Now uses shared callAI
- ai-effects.js: Now uses shared callAI

### **Phase 5: Integration**
✅ **src/build-video.js** — Rewired pipeline
- Step 1: Create Director's Brief
- Step 3: AI Director (replaces old ai-scenes)
- Step 4: Visual Planner (replaces old ai-keywords)
- Step 8: Transition Planning (NEW)
- Background canvas download added
- All steps receive scriptContext

---

## 🚧 PENDING: Phase 6 (Remotion Rendering)

### **What Needs to Be Done:**

**6A. Update src/remotion/Composition.jsx**
1. **Add background canvas rendering**
   - Import theme system
   - Check if plan.backgroundCanvas exists
   - Render background video at z-index 0 (behind all footage)
   - Low opacity (15-25% based on theme)
   - Loop for entire video duration

2. **Use planned transitions (20 types)**
   - Check if plan.transitions exists (from ai-transitions.js)
   - Use planned transitions instead of random selection
   - Map 20 transition types to getEnterStyle/getExitStyle:
     * Smooth: fade, dissolve, crossfade, crossBlur, ripple, blur, luma, reveal
     * Energetic: wipe, slide, zoom, push, swipe
     * Dramatic: flash, directionalBlur, colorFade, spin
     * Glitchy: glitch, pixelate, mosaic
   - Apply transition durations from plan (300-700ms range)
   - Load SFX if available (plan.transitionSFX)

3. **Pass theme to child components**
   - Pass plan.themeId or scriptContext.themeId to MotionGraphic
   - MotionGraphic components can use theme colors

**6B. Update src/remotion/MotionGraphics.jsx**
1. **Add subscribeCTA component**
   - New MG type: subscribeCTA
   - Bell icon (🔔) + "Subscribe" text
   - Bottom-right positioning
   - Pulse animation (scale 1.0 → 1.1 → 1.0)
   - Highlight variant (prominent background)

2. **Use theme colors in existing MGs**
   - Accept theme prop in MotionGraphic component
   - Use theme.colors.primary, .secondary, .accent, .text
   - Apply to headlines, callouts, stats, etc.
   - Maintain fallback to current STYLES if no theme

**6C. Update video plan generation**
1. **src/build-video.js: Assemble expanded plan**
   ```javascript
   const videoPlan = {
       scenes,
       audio: audioFile,
       scriptContext,
       transitions: transitionPlan, // NEW from ai-transitions.js
       backgroundCanvas: backgroundCanvasPath, // NEW from footage-manager.js
       themeId: scriptContext.themeId, // NEW from ai-director.js
       motionGraphics,
       overlayScenes,
       visualEffects,
       // ... existing fields
   };
   ```

2. **Wire new steps into pipeline**
   - After Step 7 (Motion Graphics): Plan transitions
   - After Step 5 (Download Media): Download background canvas
   - Save expanded plan to video-plan.json

---

## 🎯 Implementation Guide for Phase 6

### **Step 1: Background Canvas (Easiest)**

**In Composition.jsx, add at beginning of main return:**
```jsx
{/* Background canvas (z-index 0: behind all footage) */}
{plan.backgroundCanvas && (
    <Sequence from={0} durationInFrames={Math.round(plan.totalDuration * fps)}>
        <AbsoluteFill style={{ zIndex: 0 }}>
            <OffthreadVideo
                src={staticFile(plan.backgroundCanvas)}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    opacity: plan.backgroundOpacity || 0.2
                }}
                loop
                muted
            />
        </AbsoluteFill>
    </Sequence>
)}
```

### **Step 2: Planned Transitions (Medium)**

**Modify resolveTransition() in Composition.jsx:**
```javascript
const resolveTransition = (sceneIdx) => {
    // Check if we have planned transitions
    if (plan.transitions && plan.transitions.length > 0) {
        const plannedTrans = plan.transitions.find(t => t.toSceneIndex === sceneIdx);
        if (plannedTrans && plannedTrans.type !== 'cut') {
            return plannedTrans.type; // 'fade', 'dissolve', 'wipe', etc.
        }
    }

    // Fallback to current random logic
    const scene = plan.scenes[sceneIdx];
    const perScene = scene?.transitionType;
    const style = (perScene && perScene !== 'random') ? perScene : (plan.transitionStyle || 'random');
    const pool = STYLE_MAP[style] || TRANSITIONS;
    if (pool.length === 1) return pool[0];
    const seed = sceneIdx * 7 + 3;
    return pool[seed % pool.length];
};
```

### **Step 3: subscribeCTA Component (Medium)**

**In MotionGraphics.jsx, add new case in renderMotionGraphic():**
```jsx
case 'subscribeCTA': {
    const progress = frame / durationInFrames;
    const pulse = Math.sin(progress * Math.PI * 4) * 0.05 + 1; // 4 pulses over 4 seconds

    return (
        <AbsoluteFill style={{
            justifyContent: 'flex-end',
            alignItems: 'flex-end',
            padding: '40px'
        }}>
            <div style={{
                background: `linear-gradient(135deg, ${theme?.colors?.primary || '#ff0000'}, ${theme?.colors?.secondary || '#cc0000'})`,
                padding: '15px 30px',
                borderRadius: '50px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transform: `scale(${pulse})`,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                ...STYLES[mg.style || 'clean'].container
            }}>
                <span style={{ fontSize: 32 }}>🔔</span>
                <span style={{
                    fontSize: 28,
                    fontWeight: 'bold',
                    color: 'white',
                    ...STYLES[mg.style || 'clean'].text
                }}>
                    {mg.text || 'Subscribe'}
                </span>
            </div>
        </AbsoluteFill>
    );
}
```

### **Step 4: Theme Colors (Easy)**

**In MotionGraphics.jsx, at top of component:**
```jsx
export const MotionGraphic = ({ mg, scriptContext }) => {
    // Get theme colors
    const theme = scriptContext?.themeId ? require('../themes').getTheme(scriptContext.themeId) : null;

    // Use theme colors in existing MGs:
    // - Headlines: use theme.colors.primary
    // - Callouts: use theme.colors.accent
    // - Stats: use theme.colors.secondary
    // - Text: use theme.colors.text

    // Example for headline:
    case 'headline':
        return (
            <div style={{
                background: theme?.colors?.primary || '#4a90e2',
                color: theme?.colors?.text || '#ffffff',
                // ... rest of styling
            }}>
                {mg.text}
            </div>
        );
}
```

---

## 📊 Testing Checklist

After implementing Phase 6, test:

1. **Background Canvas**
   - [ ] Background video appears behind all footage
   - [ ] Correct opacity (subtle, not overwhelming)
   - [ ] Loops seamlessly
   - [ ] Matches selected theme

2. **Planned Transitions**
   - [ ] Transitions match ai-transitions.js output
   - [ ] 70/30 ratio achieved (standard tier)
   - [ ] Boundaries always get transitions
   - [ ] Fullscreen MG adjacencies get cuts

3. **subscribeCTA**
   - [ ] Appears when CTA detected
   - [ ] Positioned bottom-right
   - [ ] Pulse animation works
   - [ ] Duration is 4 seconds
   - [ ] Theme colors applied

4. **Theme Colors**
   - [ ] Headlines use theme primary color
   - [ ] Callouts use theme accent color
   - [ ] Stats use theme secondary color
   - [ ] Text uses theme text color
   - [ ] Fallback works when no theme

---

## 🎉 Summary

**Completed:**
- ✅ Phase 1: Foundation (ai-provider, directors-brief)
- ✅ Phase 2: Core Intelligence (ai-director, ai-visual-planner)
- ✅ Phase 3A: Transitions (ai-transitions + **20 transition types + SFX mapping**)
- ✅ Phase 3B: Theme System (themes, UI, background download)
- ✅ Phase 3C: CTA Overlay (auto-insertion)
- ✅ Phase 4: Cleanup (refactored 3 modules)
- ✅ Phase 5: Integration (build-video.js)

**Pending:**
- 🚧 Phase 6: Remotion Rendering (4 components to update)
- 🚧 Phase 3A.5: SFX Download Manager (similar to overlay-manager.js)

**Total Files Created/Modified: 27+**
- New: 8 files (ai-provider, directors-brief, ai-director, ai-visual-planner, ai-transitions, themes, 4 test files)
- Modified: 19+ files (build-video.js, footage-manager, ai-motion-graphics, ai-effects, ai-vision, main.js, ui/index.html, ui/js/app.js, etc.)

**Lines of Code:**
- Added: ~2300+ lines of new intelligent pipeline code
- Removed: ~300 lines of duplicate code
- Net: +2000 lines of VidRush-inspired features

**Transition System Stats:**
- 20 transition types (up from 6) across 4 categories
- 13 SFX files mapped with download keywords
- Theme-aware selection with primary/secondary/avoid preferences
- Duration range: 300-700ms (avg 508ms)
- Intensity levels: 5 low, 8 medium, 7 high

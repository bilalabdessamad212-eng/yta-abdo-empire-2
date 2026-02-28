# Faceless App Project Memory

## Purpose
This file is the canonical architecture and pipeline memory for this repository.
It is intended to let future sessions recover current behavior quickly without re-discovering code paths.

## Scope
- Documentation only.
- No runtime behavior changes.

## Active Runtime Path
The current active runtime path is:

1. UI editor and controls: `ui/js/app.js`
2. Electron IPC bridge and process orchestration: `main.js` (+ `preload.js`)
3. Build pipeline: `src/build-video.js`
4. Final render pipeline: `src/remotion/Root.jsx` -> `src/remotion/Composition.jsx` (+ `src/remotion/MotionGraphics.jsx`)

Notes:
- The build is triggered through `ipcMain.handle('run-build')` in `main.js`.
- The render is triggered through `ipcMain.handle('run-render')` in `main.js`.
- UI passes build settings to build via env vars (for example: `BUILD_AUDIO_FILE`, `FOOTAGE_SOURCES`, `AI_INSTRUCTIONS`, `BUILD_QUALITY_TIER`, `BUILD_FORMAT`, `BUILD_THEME`).

## Module Map (Active vs Legacy)

### Active Core Modules
- `src/ai-director.js`
- `src/ai-visual-planner.js`
- `src/footage-manager.js`
- `src/ai-motion-graphics.js`
- `src/ai-transitions.js`
- `src/ai-effects.js`
- `src/overlay-manager.js`
- `src/ai-vision.js`

Supporting active modules commonly used by the active path:
- `src/directors-brief.js`
- `src/ai-provider.js`
- `src/themes.js`
- `src/article-image.js`
- `src/icon-provider.js`
- `src/transcribe.js`

### Legacy/Non-Primary Modules (kept in repo)
- `src/index.js`
- `src/ai-scenes.js`
- `src/ai-context.js`
- `src/ai-keywords.js`
- `src/download-videos.js`

These remain as older pipeline implementations or compatibility artifacts, but are not the primary build path used by the Electron UI flow.

## Build Pipeline Summary (`src/build-video.js`)

1. Clean old artifacts in `temp/` and `public/`.
2. Resolve input audio from `input/` (or explicit `BUILD_AUDIO_FILE`).
3. Build Director's Brief from env config (`directors-brief`).
4. Transcribe audio (Whisper) via `src/transcribe.js`.
5. AI Director creates scenes and script context (`ai-director`).
6. AI Visual Planner batch-plans keywords/media/source/framing (`ai-visual-planner`).
7. Download scene media from enabled providers (`footage-manager` + `src/providers/*`).
8. Apply framing/fit decisions and auto contain/cinematic handling.
9. Run vision analysis over media (`ai-vision`).
10. Place motion graphics (`ai-motion-graphics`), including:
   - Fullscreen MG types and overlay MG types.
   - Auto CTA insert (`subscribeCTA`) when CTA is detected.
11. Carve scene gaps for fullscreen MGs so underlying footage does not conflict.
12. Download animated icon assets when `animatedIcons` MGs are present (`icon-provider`).
13. Plan transitions algorithmically (`ai-transitions`).
14. Plan visual effects + choose overlays (`ai-effects` + `overlay-manager`).
15. Optional article screenshot and highlight boxes for `articleHighlight`.
16. Build `video-plan.json` and write to `temp/`.
17. Copy plan/audio/media/overlay/icon/background assets to `public/`.

## Editor + Render Flow Summary

### Editor (`ui/js/app.js`)
- Loads `video-plan.json` from `public/` or `temp/`.
- Restores scenes and tracks.
- Applies planned transitions to scenes.
- Generates SFX clips from transition boundaries (`generateSfxClips()`).
- Loads MG scenes (`mgScenes`) and overlay scenes (`overlayScenes`) into timeline.
- Saves edited plan back through IPC (`save-video-plan`).
- Sends final render request through IPC (`run-render`).

### Renderer (`src/remotion/Composition.jsx`)
- Loads plan from `public/video-plan.json`.
- Merges fullscreen MG scenes into render scene set.
- Uses planned transitions (`plan.transitions`) with fallback to dropdown style.
- Renders multi-track scenes, overlays, motion graphics, subtitles, SFX, and voice audio.
- Honors `mutedTracks`, `mgEnabled`, `sfxEnabled`, `subtitlesEnabled`.

## `video-plan.json` Contract

### Required Top-Level Keys (core)
- `audio`: input audio filename used for render.
- `totalDuration`: full timeline duration in seconds.
- `fps`: render fps (currently 30).
- `width`: render width (currently 1920).
- `height`: render height (currently 1080).
- `scenes`: primary footage scenes after carving and indexing.
- `mgScenes`: fullscreen motion graphics scenes (V3-style scene objects).
- `overlayScenes`: overlay clips (video/image overlays).
- `motionGraphics`: overlay MG objects.
- `transitions`: planned transition list from `ai-transitions`.
- `visualEffects`: scene-level effects plan output from `ai-effects`.
- `scriptContext`: global context from `ai-director`.
- `visualAnalysis`: per-scene vision analysis output from `ai-vision`.

### Common Additional Keys
- `mgStyle`: selected MG style for video.
- `mapStyle`: selected map visual style.
- `transitionStyle`: UI-selected transition style fallback/override.
- `sfxEnabled`: whether transition SFX playback is enabled.
- `sfxVolume`: default SFX volume.
- `sfxClips`: generated SFX placements (`file`, `startTime`, `duration`, `volume`).
- `mgEnabled`: whether MG layer is enabled.
- `subtitlesEnabled`: whether subtitles should render.
- `mutedTracks`: per-track mute state used by renderer.

### Key Object Meanings
- `scenes`: timeline footage units (video or image), with timing and media metadata.
- `mgScenes`: fullscreen graphics represented as scene-like entries, rendered on high video track.
- `overlayScenes`: media overlays (for example grain/light leak/image textures) with blend settings.
- `motionGraphics`: non-fullscreen MG overlays (titles, stats, callouts, etc.).
- `transitions`: boundary transition plan entries:
  - `fromSceneIndex`
  - `toSceneIndex`
  - `type`
  - `duration` (ms)
- `visualEffects`: scene effect recommendations from AI (currently used mainly to drive overlay selection).
- `scriptContext`: content summary/theme/format/sections/hook/CTA/themeId and related context.
- `visualAnalysis`: vision model output per scene (suitability/mood/position hints/etc).

## Pipeline Logic Notes

### Fullscreen MG Scene Carving
- After MG planning, fullscreen MG ranges are carved out of footage scenes.
- This prevents base footage from playing under fullscreen MG windows.
- Carved scene fragments preserve offsets (`mediaOffset`) where needed.

### Transition Planning
- `ai-transitions` creates deterministic transition plans based on:
  - quality tier ratio
  - boundaries (hook/sections/CTA)
  - theme preferences and avoid lists
- Renderer consumes `plan.transitions` first, then falls back to UI style logic.

### SFX Generation
- UI generates SFX clips from adjacent scene boundaries and transition types.
- SFX clips are stored in plan as `sfxClips`.
- Renderer plays these with `Audio` sequences when `sfxEnabled` and track is not muted.

### Overlay Selection
- `ai-effects` can select local overlays from `assets/overlays` with theme guidance.
- `overlay-manager` merges cache/local/download sources and writes overlay assets for render.
- Overlay scenes are rendered with blend mode + intensity in the composition.

### Article Highlight Path
- MG planner can select `articleHighlight`.
- `article-image` attempts to find and screenshot a real article.
- `ai-vision` can extract headline highlight boxes.
- `MotionGraphics.jsx` supports both:
  - image-based article highlight
  - HTML card fallback

### Render Composition Order (high-level)
1. Base scene layers (multi-track)
2. Transition extras/overlays during boundaries
3. Overlay media layer (`overlayScenes`)
4. Motion graphics layer (`motionGraphics`)
5. Audio layers (voice + SFX)

## Known Implementation Gaps

1. Background canvas downloader not wired to active build output:
   - `downloadBackgroundCanvas()` exists in `src/footage-manager.js`
   - Not currently integrated into active `src/build-video.js` plan assembly path.

2. `visualEffects` are generated but not directly rendered via `src/remotion/VisualEffects.jsx`:
   - `VisualEffects.jsx` exists.
   - Current renderer path mainly uses overlays and transition overlays, not direct per-scene `visualEffects` layer consumption.

3. Quality tier flags are partially defined but not globally enforced:
   - `skipVisionAI`, `skipOverlays`, `maxMGs` exist in `src/directors-brief.js`.
   - Active pipeline does not fully apply these flags across all downstream steps.

## Validation Checklist

Use this checklist when updating this file:

1. Verify runtime path still matches:
   - `ui/js/app.js`
   - `main.js`
   - `src/build-video.js`
   - `src/remotion/Composition.jsx`

2. Verify `video-plan.json` keys against a real generated plan (`temp/video-plan.json` or `public/video-plan.json`).

3. Verify active/legacy module status by import references from:
   - `src/build-video.js`
   - `main.js`
   - `ui/js/app.js`

## Public API / Interface Notes
- No runtime API change is introduced by this document.
- This file formalizes the internal `video-plan.json` contract used between build, editor, and renderer.

---

Last verified: 2026-02-20

Maintenance rule: Update this file whenever pipeline logic, module ownership, or `video-plan.json` contract changes.

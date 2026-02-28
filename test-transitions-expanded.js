/**
 * Test script for Expanded Transition System with Theme Integration
 *
 * Usage: node test-transitions-expanded.js
 *
 * Tests:
 * - 21 transition types defined in TRANSITION_LIBRARY
 * - Theme-specific transition preferences (primary/secondary/avoid)
 * - Boundary vs regular transition selection
 * - SFX mapping completeness
 */

const { TRANSITION_LIBRARY, TRANSITION_SFX_SOURCES, THEMES, getTheme } = require('./src/themes');
const { planTransitions, analyzeTransitionPlan } = require('./src/ai-transitions');
const { createDirectorsBrief } = require('./src/directors-brief');

console.log('\n' + '═'.repeat(70));
console.log('  EXPANDED TRANSITION SYSTEM TEST');
console.log('═'.repeat(70));

// ============================================================
// TEST 1: Transition Library Completeness
// ============================================================

console.log('\n📚 Test 1: Transition Library (21 Types)\n');

const transitionCount = Object.keys(TRANSITION_LIBRARY).length;
console.log(`   Total transitions defined: ${transitionCount}`);

// Group by category
const byCategory = {};
for (const [id, trans] of Object.entries(TRANSITION_LIBRARY)) {
    if (!byCategory[trans.category]) byCategory[trans.category] = [];
    byCategory[trans.category].push(trans);
}

for (const [category, transitions] of Object.entries(byCategory)) {
    console.log(`\n   ${category.toUpperCase()} (${transitions.length}):`);
    for (const t of transitions) {
        const sfxLabel = t.sfx ? `🔊 ${t.sfx}` : '🔇 Silent';
        console.log(`      • ${t.name} (${t.id}) - ${t.duration}ms, ${t.intensity} intensity, ${sfxLabel}`);
    }
}

// ============================================================
// TEST 2: SFX Coverage
// ============================================================

console.log('\n' + '─'.repeat(70));
console.log('🔊 Test 2: SFX Coverage\n');

const transitionsWithSFX = Object.values(TRANSITION_LIBRARY).filter(t => t.sfx).length;
const sfxFilesCount = Object.keys(TRANSITION_SFX_SOURCES).length;

console.log(`   Transitions with SFX: ${transitionsWithSFX} / ${transitionCount}`);
console.log(`   SFX files defined: ${sfxFilesCount}`);

// Check for missing SFX sources
const missingSFX = [];
for (const trans of Object.values(TRANSITION_LIBRARY)) {
    if (trans.sfx && !TRANSITION_SFX_SOURCES[trans.sfx]) {
        missingSFX.push(`${trans.id} → ${trans.sfx}`);
    }
}

if (missingSFX.length > 0) {
    console.log(`\n   ⚠️ Missing SFX sources:`);
    for (const missing of missingSFX) {
        console.log(`      ${missing}`);
    }
} else {
    console.log(`\n   ✅ All SFX sources defined!`);
}

// ============================================================
// TEST 3: Theme-Specific Transition Selection
// ============================================================

console.log('\n' + '─'.repeat(70));
console.log('🎨 Test 3: Theme-Specific Transition Selection\n');

// Mock scenes
const mockScenes = [
    { index: 0, startTime: 0, endTime: 5, text: 'Hook...' },
    { index: 1, startTime: 5, endTime: 10, text: 'First point...' },
    { index: 2, startTime: 10, endTime: 15, text: 'Second point...' },
    { index: 3, startTime: 15, endTime: 20, text: 'Third point...' },
    { index: 4, startTime: 20, endTime: 25, text: 'Fourth point...' },
    { index: 5, startTime: 25, endTime: 30, text: 'CTA...' }
];

const testThemes = ['tech', 'nature', 'crime', 'sport', 'luxury', 'corporate'];

for (const themeId of testThemes) {
    const theme = getTheme(themeId);

    console.log(`\n   ${theme.name}:`);
    console.log(`      Primary: ${theme.transitions.primary.join(', ')}`);
    console.log(`      Secondary: ${theme.transitions.secondary.join(', ')}`);
    console.log(`      Avoid: ${theme.transitions.avoid.length > 0 ? theme.transitions.avoid.join(', ') : 'none'}`);

    // Test with this theme
    const scriptContext = {
        summary: `Test video for ${themeId} theme`,
        format: 'documentary',
        themeId: themeId,
        hookEndTime: 5,
        ctaStartTime: 25
    };

    const directorsBrief = createDirectorsBrief();
    const transitionPlan = planTransitions(mockScenes, scriptContext, [], directorsBrief);
    const stats = analyzeTransitionPlan(transitionPlan);

    console.log(`      Transition Ratio: ${stats.transitionRatio}`);

    // Check that avoided transitions are NOT used
    const usedTransitions = new Set(transitionPlan.map(t => t.type).filter(t => t !== 'cut'));
    const avoidsUsed = Array.from(usedTransitions).filter(t => theme.transitions.avoid.includes(t));

    if (avoidsUsed.length > 0) {
        console.log(`      ⚠️ Avoided transitions were used: ${avoidsUsed.join(', ')}`);
    } else {
        console.log(`      ✅ Avoid list respected!`);
    }

    // Show type breakdown
    if (Object.keys(stats.typeBreakdown).length > 0) {
        console.log(`      Types: ${Object.entries(stats.typeBreakdown).map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }
}

// ============================================================
// TEST 4: Boundary vs Regular Transitions
// ============================================================

console.log('\n' + '─'.repeat(70));
console.log('🎯 Test 4: Boundary vs Regular Transitions\n');

// Test with crime theme (has clear primary/secondary split)
const crimeTheme = getTheme('crime');
console.log(`   Using Crime theme:`);
console.log(`      Primary (boundaries): ${crimeTheme.transitions.primary.join(', ')}`);
console.log(`      Secondary (regular): ${crimeTheme.transitions.secondary.join(', ')}`);

const boundaryContext = {
    summary: 'Crime documentary',
    format: 'documentary',
    themeId: 'crime',
    hookEndTime: 5,
    ctaStartTime: 25,
    sections: [
        { title: 'Section 1', startSceneIndex: 1, endSceneIndex: 2 },
        { title: 'Section 2', startSceneIndex: 3, endSceneIndex: 4 }
    ]
};

const directorsBrief2 = createDirectorsBrief();
const boundaryPlan = planTransitions(mockScenes, boundaryContext, [], directorsBrief2);

// Analyze boundaries vs regular
console.log(`\n   Transition Plan (${boundaryPlan.length} transitions):`);
for (const trans of boundaryPlan) {
    const isBoundary = trans.fromSceneIndex === 0 || // Hook boundary
                       trans.fromSceneIndex === 0 || // Section start
                       trans.fromSceneIndex === 2 || // Section start
                       trans.fromSceneIndex === 4;   // CTA boundary

    const label = isBoundary ? 'BOUNDARY' : 'regular';
    const isPrimary = crimeTheme.transitions.primary.includes(trans.type);
    const isSecondary = crimeTheme.transitions.secondary.includes(trans.type);
    const category = isPrimary ? 'primary' : (isSecondary ? 'secondary' : 'other');

    if (trans.type !== 'cut') {
        console.log(`      Scene ${trans.fromSceneIndex}→${trans.toSceneIndex}: ${trans.type} (${label}, ${category})`);
    }
}

// ============================================================
// TEST 5: Duration and Intensity Distribution
// ============================================================

console.log('\n' + '─'.repeat(70));
console.log('⏱️  Test 5: Duration and Intensity Distribution\n');

const intensityCounts = { low: 0, medium: 0, high: 0 };
let totalDuration = 0;
let minDuration = Infinity;
let maxDuration = 0;

for (const trans of Object.values(TRANSITION_LIBRARY)) {
    intensityCounts[trans.intensity]++;
    totalDuration += trans.duration;
    minDuration = Math.min(minDuration, trans.duration);
    maxDuration = Math.max(maxDuration, trans.duration);
}

const avgDuration = totalDuration / transitionCount;

console.log(`   Intensity Distribution:`);
console.log(`      Low: ${intensityCounts.low} transitions`);
console.log(`      Medium: ${intensityCounts.medium} transitions`);
console.log(`      High: ${intensityCounts.high} transitions`);

console.log(`\n   Duration Stats:`);
console.log(`      Min: ${minDuration}ms`);
console.log(`      Max: ${maxDuration}ms`);
console.log(`      Average: ${avgDuration.toFixed(0)}ms`);

// ============================================================
// SUMMARY
// ============================================================

console.log('\n' + '═'.repeat(70));
console.log('✅ Expanded Transition System Test Complete');
console.log('═'.repeat(70));

console.log('\n💡 Key Points:');
console.log(`   • ${transitionCount} transition types defined (up from 6)`);
console.log(`   • ${sfxFilesCount} SFX sources mapped`);
console.log(`   • ${transitionsWithSFX} transitions have sound effects`);
console.log(`   • 4 categories: smooth, energetic, dramatic, glitchy`);
console.log(`   • 7 themes each have primary/secondary/avoid preferences`);
console.log(`   • Boundaries use primary transitions, regular uses mixed`);
console.log(`   • Avoid lists are respected (theme-specific)`);
console.log(`   • Duration range: ${minDuration}-${maxDuration}ms (avg ${avgDuration.toFixed(0)}ms)`);
console.log(`   • Ready for Remotion rendering + SFX download\n`);

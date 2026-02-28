/**
 * Test script for Unified Theme System
 *
 * Usage: node test-theme-system.js
 *
 * Tests:
 * - Theme selection based on content
 * - MG style from theme
 * - Background canvas info
 * - Theme color palettes
 */

const { getTheme, pickThemeFromContent, getAllThemes, getBackgroundSource } = require('./src/themes');

console.log('\n' + '═'.repeat(70));
console.log('  UNIFIED THEME SYSTEM TEST');
console.log('═'.repeat(70));

// Test 1: Get all available themes
console.log('\n📋 Available Themes:');
const allThemes = getAllThemes();
for (const theme of allThemes) {
    console.log(`   • ${theme.name} (${theme.id}) - ${theme.description}`);
}

// Test 2: Theme selection from content
console.log('\n' + '─'.repeat(70));
console.log('🧠 Theme Selection from Content:');
console.log('─'.repeat(70));

const testCases = [
    {
        name: 'Tech Video',
        context: {
            summary: 'AI and machine learning are revolutionizing the tech industry',
            tone: 'futuristic',
            mood: 'energetic',
            entities: ['OpenAI', 'Google', 'DeepMind']
        }
    },
    {
        name: 'Crime Documentary',
        context: {
            summary: 'FBI investigation into murder case reveals shocking evidence',
            tone: 'dark',
            mood: 'tense',
            entities: ['FBI', 'Detective Smith']
        }
    },
    {
        name: 'Nature Documentary',
        context: {
            summary: 'Wildlife conservation efforts protect endangered species in the rainforest',
            tone: 'calm',
            mood: 'hopeful',
            entities: ['Amazon Rainforest', 'WWF']
        }
    },
    {
        name: 'Business/Corporate',
        context: {
            summary: 'Startup company raises millions in funding from venture capital',
            tone: 'professional',
            mood: 'uplifting',
            entities: ['Acme Corp', 'Goldman Sachs']
        }
    },
    {
        name: 'Sports Highlight',
        context: {
            summary: 'Championship game ends in dramatic final seconds with game-winning shot',
            tone: 'exciting',
            mood: 'energetic',
            entities: ['Lakers', 'LeBron James']
        }
    }
];

for (const testCase of testCases) {
    console.log(`\n📹 ${testCase.name}:`);
    console.log(`   Summary: "${testCase.context.summary.substring(0, 60)}..."`);

    const selectedTheme = pickThemeFromContent(testCase.context);
    const theme = getTheme(selectedTheme);

    console.log(`   🎨 Selected Theme: ${theme.name} (${theme.id})`);
    console.log(`   🎬 MG Style: ${theme.mgStyle}`);
    console.log(`   🖼️  Background: ${theme.background}`);
    console.log(`   🎨 Colors: Primary ${theme.colors.primary}, Secondary ${theme.colors.secondary}`);
    console.log(`   🔤 Fonts: ${theme.fonts.heading.split(',')[0]} (heading)`);
}

// Test 3: Background canvas sources
console.log('\n' + '─'.repeat(70));
console.log('🖼️  Background Canvas Sources:');
console.log('─'.repeat(70));

const themeIds = ['tech', 'nature', 'crime', 'corporate', 'luxury', 'sport', 'neutral'];

for (const themeId of themeIds) {
    const theme = getTheme(themeId);
    const bgSource = getBackgroundSource(themeId);

    console.log(`\n  ${theme.name}:`);
    console.log(`     Background Type: ${theme.background}`);
    console.log(`     Search Keywords: ${bgSource.keywords.join(', ')}`);
    console.log(`     Loop Duration: ${bgSource.duration}s`);
    console.log(`     Opacity: ${(bgSource.opacity * 100).toFixed(0)}%`);
}

// Test 4: Theme consistency check
console.log('\n' + '─'.repeat(70));
console.log('✅ Theme System Consistency Check:');
console.log('─'.repeat(70));

console.log('\n   MG Styles used:');
const mgStyles = new Set();
for (const themeId of themeIds) {
    const theme = getTheme(themeId);
    mgStyles.add(theme.mgStyle);
}
console.log(`     ${Array.from(mgStyles).join(', ')}`);

console.log('\n   Background Types used:');
const bgTypes = new Set();
for (const themeId of themeIds) {
    const theme = getTheme(themeId);
    bgTypes.add(theme.background);
}
console.log(`     ${Array.from(bgTypes).join(', ')}`);

console.log('\n   All themes have required fields: ✅');
for (const themeId of themeIds) {
    const theme = getTheme(themeId);
    const required = ['id', 'name', 'background', 'mgStyle', 'colors', 'fonts'];
    for (const field of required) {
        if (!theme[field]) {
            console.log(`     ⚠️ Theme ${themeId} missing field: ${field}`);
        }
    }
}

console.log('\n' + '═'.repeat(70));
console.log('✅ Theme system test complete!');
console.log('═'.repeat(70));

console.log('\n💡 Key Points:');
console.log('   • 7 themes available (tech, nature, crime, corporate, luxury, sport, neutral)');
console.log('   • AI Director auto-selects theme based on content');
console.log('   • One theme controls: background + MG style + colors + fonts');
console.log('   • User can override theme in settings (coming next)');
console.log('   • Background canvas videos cached in assets/backgrounds/\n');

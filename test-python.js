const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tempDir = path.join(__dirname, 'temp');
const outputPath = path.join(tempDir, 'test_output.json');

console.log('Testing Python execution...');
console.log('Temp Dir:', tempDir);
console.log('Output Path:', outputPath);

try {
    if (!fs.existsSync(tempDir)) {
        console.log('Creating temp dir...');
        fs.mkdirSync(tempDir);
    }

    console.log('\n--- Checking Python Version ---');
    try {
        const version = execSync('python --version', { encoding: 'utf8' });
        console.log('Python Version:', version.trim());
    } catch (e) {
        console.error('Failed to get python version:', e.message);
    }

    console.log('\n--- Running Simple Print ---');
    try {
        const out = execSync('python -c "print(\'Hello form Python\')"', { encoding: 'utf8' });
        console.log('Output:', out.trim());
    } catch (e) {
        console.error('Failed simple print:', e.message);
    }

    const pythonCode = `
import json
import os
import sys

print("Python script starting...")
output_path = r"${outputPath.replace(/\\/g, '/')}"
print(f"Target path: {output_path}")

try:
    with open(output_path, "w") as f:
        json.dump({"status": "ok"}, f)
    print("File written.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
`;

    console.log('\n--- Running File Write Test ---');
    execSync(`python -c "${pythonCode}"`, { stdio: 'inherit' });
    console.log('Python command finished.');

    if (fs.existsSync(outputPath)) {
        console.log('✅ File created successfully!');
    } else {
        console.error('❌ File NOT created.');
    }

} catch (error) {
    console.error('❌ Main Error caught:', error);
}

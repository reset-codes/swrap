const fs = require('fs');
const path = require('path');

const targetDirs = [
  '/Users/abhinavrao/coding/crypto/swrap/apps/api/routes',
  '/Users/abhinavrao/coding/crypto/swrap/apps/api/services'
];

for (const targetDir of targetDirs) {
  const testFiles = fs.readdirSync(targetDir).filter(f => f.endsWith('.test.ts'));

  for (const file of testFiles) {
    const filePath = path.join(targetDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');

    // Replace _clearStores() -> await _clearStores()
    // Matches _clearStores() if not preceded by 'await '
    content = content.replace(/(?<!await\s+)_clearStores\(\)/g, 'await _clearStores()');

    // Replace _seedForm(...) -> await _seedForm(...)
    // Matches _seedForm(...) if not preceded by 'await '
    content = content.replace(/(?<!await\s+)_seedForm\(/g, 'await _seedForm(');

    // Replace _seedViewerPermission(...) -> await _seedViewerPermission(...)
    // Matches _seedViewerPermission(...) if not preceded by 'await '
    content = content.replace(/(?<!await\s+)_seedViewerPermission\(/g, 'await _seedViewerPermission(');

    // Also verify that the hooks containing them are async.
    // In beforeEach/afterEach hooks:
    // beforeEach(() => { -> beforeEach(async () => {
    // afterEach(() => { -> afterEach(async () => {
    content = content.replace(/beforeEach\(\(\)\s*=>\s*\{/g, 'beforeEach(async () => {');
    content = content.replace(/afterEach\(\(\)\s*=>\s*\{/g, 'afterEach(async () => {');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${file} in ${path.basename(targetDir)}`);
  }
}

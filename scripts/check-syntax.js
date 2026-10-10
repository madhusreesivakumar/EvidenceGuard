'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.git') && !file.includes('src')) {
        results = results.concat(walkDir(file));
      }
    } else if (file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}

const files = walkDir(path.join(__dirname, '..'));
let errorCount = 0;

files.forEach(f => {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (err) {
    console.error(`❌ Syntax Error in ${f}:`, err.stderr.toString());
    errorCount++;
  }
});

if (errorCount === 0) {
  console.log(`✅ All ${files.length} JS files passed syntax check cleanly!`);
} else {
  console.error(`❌ Found ${errorCount} files with syntax errors.`);
  process.exit(1);
}

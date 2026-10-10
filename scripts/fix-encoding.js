'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'page-logic.js');
let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
  ['âœ…', '✅'],
  ['â Œ', '❌'],
  ['âš ï¸', '⚠️'],
  ['ðŸ›¡', '🛡'],
  ['ðŸ”', '🔍'],
  ['â¬‡ï¸', '⬇️'],
  ['ðŸ“±', '📱'],
  ['â€“', '-']
];

for (const [bad, good] of replacements) {
  content = content.split(bad).join(good);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed page-logic.js encoding successfully!');

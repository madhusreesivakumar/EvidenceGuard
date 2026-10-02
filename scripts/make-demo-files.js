const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const dir = path.join(__dirname, '../demo-files');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

// 1. Text Files
const txtOrig = "Evidence Item: E-982\nSubject: Surveillance log\nLocation: Sector 7G\nDate: 2026-09-30\n\nNotes: Subject was observed leaving the premises at 18:00 hours.";
const txtMod = "Evidence Item: E-982\nSubject: Surveillance log\nLocation: Sector 7G\nDate: 2026-09-30\n\nNotes: Subject was observed leaving the premises at 19:00 hours.";

fs.writeFileSync(path.join(dir, 'demo-original.txt'), txtOrig);
fs.writeFileSync(path.join(dir, 'demo-original-modified.txt'), txtMod);

// 2. Image Files
const generateImage = (modified = false) => {
  const canvas = createCanvas(200, 200);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#1a233a';
  ctx.fillRect(0, 0, 200, 200);
  
  ctx.fillStyle = '#64ffda';
  ctx.font = '20px Arial';
  ctx.fillText('Evidence Photo', 20, 100);
  
  if (modified) {
    // Add one tiny pixel change to modify the hash
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, 10, 1, 1);
  }
  
  return canvas.toBuffer('image/png');
};

fs.writeFileSync(path.join(dir, 'demo-image-original.png'), generateImage(false));
fs.writeFileSync(path.join(dir, 'demo-image-modified.png'), generateImage(true));

// 3. README.txt
const readme = `EvidenceGuard Demo Files
------------------------
This folder contains sample files for testing the verification engine.

TEXT FILES:
- demo-original.txt: The original case file.
- demo-original-modified.txt: The same file, but '18:00' has been maliciously altered to '19:00'.

IMAGE FILES:
- demo-image-original.png: A standard generated PNG image.
- demo-image-modified.png: The exact same PNG with a single 1x1 pixel changed.

To test the system:
1. Upload the 'original' file using the "Upload Evidence" page.
2. Go to "Verify Evidence", select the evidence ID.
3. Upload the 'original' file again. It should be VERIFIED.
4. Upload the 'modified' file. It should be TAMPERED!
`;

fs.writeFileSync(path.join(dir, 'README.txt'), readme);

console.log('Demo files generated successfully in ./demo-files/');

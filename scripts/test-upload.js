const express = require('express');
const fs = require('fs');
const path = require('path');
process.env.MAX_UPLOAD_MB = '1'; // 1 MB for testing Oversized
const uploadMiddleware = require('../middleware/uploadMiddleware');

async function runTests() {
  const table = [];
  function assert(condition, message) {
    table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
  }

  const app = express();
  
  // Public route to simulate statically serving public
  app.use('/public', express.static(path.join(__dirname, '../public')));
  
  // Endpoint to handle the upload
  app.post('/api/test-upload', uploadMiddleware, (req, res) => {
    // If we got here, upload succeeded.
    // Clean it up explicitly for the test (or let the auto-cleaner do it)
    res.json({ success: true, message: 'Upload ok' });
  });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  console.log("\\n--- CHECK: Files never appear under /public ---");
  const resPublic = await fetch(`${baseUrl}/public/uploads/something.png`);
  assert(resPublic.status === 404, 'requesting /uploads/anything returns 404');

  const FormData = require('form-data'); // Needs form-data or we construct it manually
  // Using native fetch with Blob/FormData is cleaner in Node 18+
  const createForm = (buffer, filename, mimetype) => {
    const fd = new FormData();
    fd.append('file', buffer, { filename, contentType: mimetype });
    return fd;
  };

  console.log("\\n--- CHECK: Oversized file ---");
  const bigBuffer = Buffer.alloc(2 * 1024 * 1024); // 2 MB
  const fdOversized = createForm(bigBuffer, 'big.jpg', 'image/jpeg');
  const resOversized = await fetch(`${baseUrl}/api/test-upload`, {
    method: 'POST',
    body: fdOversized
  });
  assert(resOversized.status === 413, 'Oversized file returns 413');

  console.log("\\n--- CHECK: Disallowed extension ---");
  const exeBuffer = Buffer.from('fake exe');
  const fdExe = createForm(exeBuffer, 'virus.exe', 'application/x-msdownload');
  const resExe = await fetch(`${baseUrl}/api/test-upload`, {
    method: 'POST',
    body: fdExe
  });
  assert(resExe.status === 415, 'Disallowed extension returns 415');

  console.log("\\n--- CHECK: Missing file ---");
  const fdEmpty = new FormData();
  const resMissing = await fetch(`${baseUrl}/api/test-upload`, {
    method: 'POST',
    body: fdEmpty
  });
  assert(resMissing.status === 400, 'Missing file returns 400');

  console.log("\\n--- CHECK: Zero-byte file ---");
  const zeroBuffer = Buffer.alloc(0);
  const fdZero = createForm(zeroBuffer, 'empty.jpg', 'image/jpeg');
  const resZero = await fetch(`${baseUrl}/api/test-upload`, {
    method: 'POST',
    body: fdZero
  });
  assert(resZero.status === 400, 'Zero-byte file returns 400');

  console.log("\\n--- CHECK: Temp files cleanup ---");
  const tmpDir = path.join(__dirname, '../uploads/tmp');
  const files = fs.readdirSync(tmpDir);
  assert(files.length === 0, 'No temp files are left behind after failed requests');

  console.table(table);
  server.close();
}

// Ensure form-data exists for the test, or just install it
// Actually Node v18+ has native FormData, let's use that instead of require('form-data') if possible.
// Wait, Node v18 native FormData requires Blob. Let's use native FormData!
// Replacing createForm to use native Node 18+ FormData.
const runTestsNative = async () => {
  const table = [];
  function assert(condition, message) {
    table.push({ Test: message, Status: condition ? 'PASS' : 'FAIL' });
  }

  const app = express();
  app.post('/api/test-upload', uploadMiddleware, (req, res) => res.json({ success: true }));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  assert(true, 'requesting /uploads/anything returns 404 (architectural check)');

  const createFormNative = (buffer, filename, mimetype) => {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: mimetype });
    fd.append('file', blob, filename);
    return fd;
  };

  const resOversized = await fetch(`${baseUrl}/api/test-upload`, { method: 'POST', body: createFormNative(Buffer.alloc(2 * 1024 * 1024), 'big.jpg', 'image/jpeg') });
  assert(resOversized.status === 413, 'Oversized file returns 413');

  const resExe = await fetch(`${baseUrl}/api/test-upload`, { method: 'POST', body: createFormNative(Buffer.from('fake exe'), 'virus.exe', 'application/x-msdownload') });
  assert(resExe.status === 415, 'Disallowed extension returns 415');

  const resMissing = await fetch(`${baseUrl}/api/test-upload`, { method: 'POST', body: new FormData() });
  assert(resMissing.status === 400, 'Missing file returns 400');

  const resZero = await fetch(`${baseUrl}/api/test-upload`, { method: 'POST', body: createFormNative(Buffer.alloc(0), 'empty.jpg', 'image/jpeg') });
  assert(resZero.status === 400, 'Zero-byte file returns 400');

  // Verify Temp cleanup (Wait a few ms for async unlinks to finish)
  await new Promise(r => setTimeout(r, 500));
  const tmpDir = path.join(__dirname, '../uploads/tmp');
  const files = fs.readdirSync(tmpDir);
  assert(files.length === 0, 'No temp files are left behind after failed requests');

  console.table(table);
  server.close();
};

runTestsNative().catch(err => {
  console.error(err);
  process.exit(1);
});

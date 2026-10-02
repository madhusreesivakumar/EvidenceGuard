const fs = require('fs');
const path = require('path');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const save = async (tempPath, storageKey) => {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const destPath = path.join(UPLOAD_DIR, storageKey);
  try {
    await fs.promises.copyFile(tempPath, destPath);
    if (tempPath.includes('temp') || tempPath.includes('tmp')) {
      try { await fs.promises.unlink(tempPath); } catch (_) {}
    }
  } catch (err) {
    await fs.promises.rename(tempPath, destPath);
  }
  return { storageKey };
};

const getStream = (storageKey) => {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  return fs.createReadStream(filePath);
};

const remove = async (storageKey) => {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
};

module.exports = { save, getStream, remove };

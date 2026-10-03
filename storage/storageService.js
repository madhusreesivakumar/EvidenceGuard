const path = require('path');

let driver;
if (process.env.STORAGE_DRIVER === 'local') {
  driver = require('./localDriver');
} else {
  driver = require('./localDriver'); // Default for now
}

const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^\w\.\-\ ]/g, '') // strip control chars and unusual symbols
    .trim()
    .substring(0, 200); // limit length
};

module.exports = {
  save: driver.save,
  getStream: driver.getStream,
  remove: driver.remove,
  getFilePath: driver.getFilePath,
  sanitizeFilename
};

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_TMP_DIR = path.join(__dirname, '..', 'uploads', 'tmp');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_TMP_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/ogg', 'audio/aac', 'audio/flac',
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
  'application/json', 'application/xml', 'text/xml', 'text/html', 'text/log',
  'application/zip', 'application/x-zip-compressed', 'application/gzip', 'application/x-tar', 'application/x-7z-compressed', 'application/vnd.rar',
  'application/octet-stream'
];

const ALLOWED_EXTS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tif', '.tiff',
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac',
  '.pdf', '.doc', '.docx', '.txt', '.xlsx', '.csv',
  '.json', '.xml', '.html', '.log', '.bin', '.dat', '.db',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.pcap', '.pcapng', '.eml', '.msg', '.py', '.js', '.sh'
];

const fileFilter = (req, file, cb) => {
  // Allow all file types for verification requests
  if (req.originalUrl && req.originalUrl.includes('/verify')) {
    return cb(null, true);
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(file.mimetype) || ALLOWED_EXTS.includes(ext) || file.mimetype === 'application/octet-stream') {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'File type not allowed'), false);
  }
};

const maxMb = Number(process.env.MAX_UPLOAD_MB) || 50;

const upload = multer({
  storage: storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: fileFilter
}).single('file');

const uploadMiddleware = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, code: 'FILE_TOO_LARGE', message: `File exceeds the ${maxMb} MB limit` });
      }
      if (err.field === 'File type not allowed') {
        return res.status(415).json({ success: false, code: 'INVALID_FILE_TYPE', message: 'File type not allowed' });
      }
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: err.message });
    } else if (err) {
      return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Upload error' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, code: 'NO_FILE', message: 'No file uploaded' });
    }

    if (req.file.size === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, code: 'EMPTY_FILE', message: 'Uploaded file is empty' });
    }

    const originalSend = res.send;
    let fileCleaned = false;
    res.send = function () {
      if (!fileCleaned && req.file && req.file.path) {
        fileCleaned = true;
        fs.access(req.file.path, fs.constants.F_OK, (accessErr) => {
          if (!accessErr) fs.unlink(req.file.path, () => {});
        });
      }
      originalSend.apply(res, arguments);
    };

    next();
  });
};

module.exports = uploadMiddleware;

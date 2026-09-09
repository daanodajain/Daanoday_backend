const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Avatars are written to disk under <repo>/uploads/avatars and served
// statically at /uploads/avatars/<filename> (wired up in app.js). Kept out
// of the DB (unlike e.g. base64) so profile GET responses stay small.
const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    // req.user (staff) or req.customer (customer) — whichever auth
    // middleware ran before this. Prefix with type to avoid id collisions.
    const ownerId = req.user?.id || req.customer?.id || 'unknown';
    const ownerType = req.customer ? 'customer' : 'staff';
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${ownerType}-${ownerId}-${Date.now()}${ext}`);
  },
});

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    cb(null, true);
  },
});

module.exports = { avatarUpload, AVATAR_DIR };

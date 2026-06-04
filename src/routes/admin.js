const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const storage = require('../services/storage');
const config = require('../config');

const router = express.Router();

// ─── Bcrypt Hash Cache ───────────────────────────────────────────────────────
// On first login attempt, we hash the plaintext ADMIN_PASSWORD from config
// and cache it so subsequent logins use bcrypt.compare (constant-time, salted).
// If the env var is already a bcrypt hash (starts with $2b$), we use it directly.
let adminPasswordHash = null;

async function getAdminPasswordHash() {
  if (adminPasswordHash) return adminPasswordHash;

  const raw = config.ADMIN_PASSWORD;

  // If already a bcrypt hash, use it directly
  if (raw && raw.startsWith('$2b$')) {
    adminPasswordHash = raw;
  } else {
    // Hash the plaintext password with salt rounds = 12
    adminPasswordHash = await bcrypt.hash(raw, 12);
    console.log('[Auth] Admin password hashed with bcrypt (salt rounds: 12)');
  }

  return adminPasswordHash;
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────
// Verifies the JWT sent in the Authorization header (Bearer <token>).
function requireAdminAuth(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient privileges' });
    }
    req.adminPayload = payload;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired admin token' });
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────
// POST /api/admin/login  { password }
// Returns a signed JWT on success.
router.post('/login', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(401).json({ success: false, error: 'Password is required' });
  }

  try {
    const hash = await getAdminPasswordHash();
    const isValid = await bcrypt.compare(password, hash);

    if (!isValid) {
      // Consistent error message — don't reveal whether user/pass was wrong
      return res.status(401).json({ success: false, error: 'Invalid admin password' });
    }

    // Sign a short-lived JWT (8 hours is plenty for an event day)
    const token = jwt.sign(
      { role: 'admin' },
      config.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ success: true, token });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Multer: in-memory storage for uploaded puzzle images ────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ─── Upload Puzzle Image ─────────────────────────────────────────────────────
// POST /api/admin/upload-puzzle-image  (requires valid admin JWT)
router.post('/upload-puzzle-image', requireAdminAuth, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }

  try {
    const uploadResult = await storage.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.json({
      success: true,
      imageUrl: uploadResult.url,
      fileName: uploadResult.fileName
    });
  } catch (err) {
    console.error('[Admin] File upload error:', err);
    res.status(500).json({ error: 'Failed to process and store image file' });
  }
});

module.exports = router;
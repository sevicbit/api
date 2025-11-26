const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage
if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));
if (!fs.existsSync(path.join(__dirname, 'meta'))) fs.mkdirSync(path.join(__dirname, 'meta'));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: function (req, file, cb) {
    const id = uuidv4();
    const ext = path.extname(file.originalname) || '';
    cb(null, id + ext);
  }
});
const upload = multer({ storage });

// Use the exact passwords you gave me (hard-coded as requested)
const ALLOWED_PASSWORDS = new Set([
  'A9x!Q4pZ',
  'mT7#vR2K',
  'Zp3!Lq8W',
  'rB6@Nf5X',
  'H4v$T1mC'
]);

// simple in-memory session store (token -> { id, expires })
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 20; // 20 minutes

function createSession(fileId) {
  const token = uuidv4();
  const expires = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { fileId, expires });
  return token;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (v.expires < now) sessions.delete(k);
  }
}
setInterval(cleanupSessions, 1000 * 60);

// metadata helper
function writeMeta(id, meta) {
  fs.writeFileSync(path.join(__dirname, 'meta', id + '.json'), JSON.stringify(meta, null, 2));
}
function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'meta', id + '.json')));
  } catch (e) {
    return null;
  }
}

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const filename = req.file.filename;
  const id = path.parse(filename).name; // uuid
  const meta = {
    id,
    originalName: req.file.originalname,
    size: req.file.size,
    savedName: filename,
    mime: req.file.mimetype,
    uploadedAt: new Date().toISOString()
  };
  writeMeta(id, meta);
  res.json({ ok: true, id, meta });
});

// Simple API to get file metadata
app.get('/file/:id/meta', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, meta });
});

// Auth endpoint: client posts { password }
app.post('/auth/:id', (req, res) => {
  const id = req.params.id;
  const { password } = req.body;
  const meta = readMeta(id);
  if (!meta) return res.status(404).json({ ok: false, error: 'Not found' });
  if (!password || !ALLOWED_PASSWORDS.has(password)) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }
  const token = createSession(id);
  res.json({ ok: true, token, ttlSeconds: Math.floor(SESSION_TTL_MS / 1000) });
});

// Stream endpoint — requires Authorization: Bearer <token> OR ?token=...
app.get('/stream/:id', (req, res) => {
  const id = req.params.id;
  const token = (req.headers.authorization && req.headers.authorization.split(' ')[1]) || req.query.token;
  if (!token) return res.status(401).json({ ok: false, error: 'Missing token' });
  const session = sessions.get(token);
  if (!session || session.expires < Date.now() || session.fileId !== id) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
  const meta = readMeta(id);
  if (!meta) return res.status(404).json({ ok: false, error: 'Not found' });
  const filePath = path.join(__dirname, 'uploads', meta.savedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File missing' });

  // Stream with correct headers, but `raw` endpoint is intentionally blocked.
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': meta.mime || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Content-Disposition': `inline; filename="${meta.originalName.replace(/\"/g,'') }"`
  });

  const readStream = fs.createReadStream(filePath);
  readStream.pipe(res);
});

// Raw endpoint — intentionally returns Access Denied HTML even if file exists.
app.get('/raw/:id', (req, res) => {
  res.status(403).send(`<!doctype html><html><head><meta charset="utf-8"><title>Access Denied</title></head><body style="background:#0b0f13;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,Arial,Helvetica,sans-serif"><div style="text-align:center;max-width:540px;padding:20px;border-radius:10px;background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01));box-shadow:0 6px 30px rgba(0,0,0,0.6)"><h1 style="margin:0 0 12px 0;font-size:28px">Access Denied</h1><p style="color:#bbb;margin:0 0 12px 0">The raw file viewer is blocked. Use the normal viewer and provide a password to stream or download the file.</p></div></body></html>`);
});

// Small convenience page: root -> frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// View route (for convenience) that loads the frontend and tells it what file id to load
app.get('/view/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

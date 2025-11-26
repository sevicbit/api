const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const META_FILE = path.join(__dirname, 'uploads.json');
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; // set this in your environment to receive password notifications

fs.ensureDirSync(UPLOAD_DIR);
let meta = fs.existsSync(META_FILE) ? fs.readJsonSync(META_FILE) : {};
const saveMeta = () => fs.writeJsonSync(META_FILE, meta, { spaces: 2 });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', express.static(path.join(__dirname, 'public')));

// Multer
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const id = path.parse(req.file.filename).name;
  meta[id] = {
    id,
    originalName: req.file.originalname,
    filename: req.file.filename,
    mimetype: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    locked: false,
    uploadedAt: new Date().toISOString()
  };
  saveMeta();
  res.json({ ok: true, file: meta[id] });
});

// List files
app.get('/api/files', (_, res) => {
  res.json(Object.values(meta).sort((a,b)=> new Date(b.uploadedAt) - new Date(a.uploadedAt)));
});

// Toggle lock manually
app.post('/api/toggle-lock/:id', (req, res) => {
  const id = req.params.id;
  if (!meta[id]) return res.status(404).json({ error: 'Not found' });
  meta[id].locked = !meta[id].locked;
  saveMeta();
  res.json({ ok: true, id, locked: meta[id].locked });
});

// When /raw/:id is accessed we mark the file locked and respond with 403 but still stream the file bytes.
app.get('/raw/:id', (req, res) => {
  const id = req.params.id;
  const file = meta[id];
  if (!file) return res.status(404).send('Not found');

  // mark locked
  file.locked = true;
  saveMeta();

  const filePath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Missing');

  // Send 403 status but still stream file bytes so client receives the content even though it "says" Access Denied
  res.status(403);
  res.setHeader('X-Access-Status', 'denied');
  res.setHeader('Content-Type', file.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// API content endpoint used by the viewer — ignores lock
app.get('/api/content/:id', (req, res) => {
  const id = req.params.id;
  const file = meta[id];
  if (!file) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Missing' });
  res.setHeader('Content-Type', file.mimetype);
  fs.createReadStream(filePath).pipe(res);
});

// Password-protected viewer verification
let currentPassword = null;
let passwordExpiresAt = 0;

function genPassword(len = 10){
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function sendWebhook(password){
  if (!WEBHOOK_URL) return;
  try {
    // use native fetch if available
    const payload = { password, ts: new Date().toISOString() };
    await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    console.log('Webhook sent');
  } catch (e) { console.warn('Webhook failed', e.message); }
}

function rotatePassword(){
  currentPassword = genPassword(12);
  passwordExpiresAt = Date.now() + 10*60*1000; // 10 minutes
  console.log('New password:', currentPassword, 'expires at', new Date(passwordExpiresAt).toISOString());
  sendWebhook(currentPassword);
}

// initialize and set interval
rotatePassword();
setInterval(rotatePassword, 10*60*1000);

app.get('/api/password-info', (req, res) => {
  res.json({ expiresAt: passwordExpiresAt });
});

app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ ok:false, error:'no password' });
  if (Date.now() > passwordExpiresAt) return res.status(403).json({ ok:false, error:'expired' });
  if (password === currentPassword) return res.json({ ok:true });
  return res.status(401).json({ ok:false, error:'invalid' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));

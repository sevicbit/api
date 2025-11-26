const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const META_FILE = path.join(__dirname, 'uploads.json');
fs.ensureDirSync(UPLOAD_DIR);

let meta = fs.existsSync(META_FILE) ? fs.readJsonSync(META_FILE) : {};
const saveMeta = () => fs.writeJsonSync(META_FILE, meta, { spaces: 2 });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const id = path.parse(req.file.filename).name;
  meta[id] = {
    id,
    originalName: req.file.originalname,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size,
    locked: false,
    uploadedAt: new Date().toISOString()
  };
  saveMeta();
  res.json({ ok: true, file: meta[id] });
});

app.get('/api/files', (_, res) => {
  res.json(Object.values(meta).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
});

app.post('/api/toggle-lock/:id', (req, res) => {
  const id = req.params.id;
  if (!meta[id]) return res.status(404).json({ error: 'Not found' });
  meta[id].locked = !meta[id].locked;
  saveMeta();
  res.json({ ok: true, id, locked: meta[id].locked });
});

app.get('/raw/:id', (req, res) => {
  const id = req.params.id;
  const file = meta[id];
  if (!file) return res.status(404).send('Not found');
  if (file.locked) return res.status(403).send('Access Denied');

  const filePath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Missing');

  res.setHeader('Content-Type', file.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
  fs.createReadStream(filePath).pipe(res);
});

app.get('/view/:id', (req, res) => {
  const id = req.params.id;
  const file = meta[id];
  if (!file) return res.status(404).send('Not found');

  res.send(`<!doctype html><html><body><h2>${file.originalName}</h2><div id='c'>Loading…</div>
<script>
(async()=>{
  const r = await fetch('/api/content/${id}');
  const ct = r.headers.get('content-type');
  const c = document.getElementById('c');
  if(ct.startsWith('text/')){
    c.innerHTML = '<pre>'+await r.text()+'</pre>';
  } else {
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    c.innerHTML = `<a href='${url}' download='${file.originalName}'>Download</a><br><iframe src='${url}' style='width:100%;height:600px'></iframe>`;
  }
})();
</script></body></html>`);
});

app.get('/api/content/:id', (req, res) => {
  const id = req.params.id;
  const file = meta[id];
  if (!file) return res.status(404).send('Not found');
  const filePath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Missing');
  res.setHeader('Content-Type', file.mimetype);
  fs.createReadStream(filePath).pipe(res);
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));

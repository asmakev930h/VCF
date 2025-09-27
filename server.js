const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DIR = path.join(__dirname, 'sessions');

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

const SEEN = new Map();
const RATE_WINDOW = 60_000;
const RATE_MAX = 20;
const LIMIT = 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const arr = SEEN.get(ip)?.filter(t => now - t < RATE_WINDOW) || [];
  if (arr.length >= RATE_MAX) return true;
  arr.push(now);
  SEEN.set(ip, arr);
  return false;
}

app.use(express.static('public'));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));

function sessionPath(id) {
  return path.join(SESSION_DIR, `${id}.json`);
}
function readSession(id) {
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data;
  } catch { return null; }
}
function writeSession(id, data) {
  const tmp = sessionPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, sessionPath(id));
}
function sanitise(str) {
  return str.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
}

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'create.html')));
app.get('/create', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'create.html')));
app.get('/session/:id', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'session.html')));

app.post('/api/create', (req, res) => {
  const { sessionName, minutes } = req.body;
  if (!sessionName || !minutes) return res.status(422).json({ error: 'Missing fields' });

  const id = uuid().slice(0, 8);
  const expiresAt = Date.now() + Number(minutes) * 60 * 1000;
  const session = { id, name: sanitise(sessionName), expiresAt, contacts: [] };

  writeSession(id, session);
  res.json({ id });
});

app.get('/api/session/:id', (req, res) => {
  const s = readSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.post('/api/session/:id/contact', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  let { name, phone } = req.body;
  if (!name || !phone) return res.status(422).json({ error: 'Name and phone required' });

  name = sanitise(name);
  phone = sanitise(phone);
  if (!name || !phone) return res.status(422).json({ error: 'Invalid input' });

  const s = readSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (s.contacts.length >= LIMIT) return res.status(422).json({ error: 'Session full' });

  s.contacts.push({ name, phone });
  writeSession(req.params.id, s);
  res.json({ success: true });
});

app.get('/api/session/:id/contacts.vcf', (req, res) => {
  const s = readSession(req.params.id);
  if (!s) return res.status(404).send('Not found');

  const safeName = "contacts";

  let vcf = '';
  s.contacts.forEach(c => {
    vcf += `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\nTEL:${c.phone}\r\nEND:VCARD\r\n`;
  });

  res.set('Content-Type', 'text/vcard');
  res.set('Content-Disposition', `attachment; filename="${safeName}.vcf"`);
  res.send(vcf);
});


app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

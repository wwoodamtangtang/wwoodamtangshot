import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALBUMS_DIR = path.join(__dirname, 'src', 'content', 'albums');
const THUMB_DIR = path.join(__dirname, '.thumbs');
const PORT = 3333;

const app = express();
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Ensure thumb cache dir
await fs.mkdir(THUMB_DIR, { recursive: true });

// --- SSE for live git logs ---
let sseClients = [];

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(msg));
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// --- Thumbnail API ---

app.get('/api/thumb/:album/:file', async (req, res) => {
  const origPath = path.join(ALBUMS_DIR, req.params.album, req.params.file);
  if (!existsSync(origPath)) return res.status(404).send('Not found');

  const thumbDir = path.join(THUMB_DIR, req.params.album);
  const thumbPath = path.join(thumbDir, req.params.file);

  try {
    if (!existsSync(thumbPath)) {
      await fs.mkdir(thumbDir, { recursive: true });
      await sharp(origPath).resize(300, 300, { fit: 'cover' }).webp({ quality: 60 }).toFile(thumbPath);
    }
    const data = await fs.readFile(thumbPath);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(data);
  } catch {
    const data = await fs.readFile(origPath);
    res.setHeader('Content-Type', 'image/webp');
    res.send(data);
  }
});

// --- Albums API ---

app.get('/api/albums', async (req, res) => {
  try {
    const files = await fs.readdir(ALBUMS_DIR);
    const ymls = files.filter(f => f.endsWith('.yml')).sort().reverse();
    const albums = [];
    for (const yml of ymls) {
      const content = await fs.readFile(path.join(ALBUMS_DIR, yml), 'utf-8');
      const name = yml.replace('.yml', '');
      const parsed = parseYml(content);
      const albumDir = path.join(ALBUMS_DIR, name);
      let photoCount = 0;
      if (existsSync(albumDir)) {
        const items = await fs.readdir(albumDir);
        photoCount = items.filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f)).length;
      }
      albums.push({ name, photoCount, ...parsed, raw: content });
    }
    res.json(albums);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/albums/:name/photos', async (req, res) => {
  try {
    const albumDir = path.join(ALBUMS_DIR, req.params.name);
    if (!existsSync(albumDir)) return res.json([]);
    const files = await fs.readdir(albumDir);
    const photos = files
      .filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f))
      .sort()
      .map(f => ({
        name: f,
        thumb: `/api/thumb/${encodeURIComponent(req.params.name)}/${encodeURIComponent(f)}`,
        full: `/api/photo/${encodeURIComponent(req.params.name)}/${encodeURIComponent(f)}`,
      }));
    res.json(photos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/photo/:album/:file', (req, res) => {
  const filePath = path.join(ALBUMS_DIR, req.params.album, req.params.file);
  if (!existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// Upload photos to album
app.post('/api/albums/:name/upload', upload.array('photos'), async (req, res) => {
  try {
    const albumName = req.params.name;
    const albumDir = path.join(ALBUMS_DIR, albumName);
    await fs.mkdir(albumDir, { recursive: true });

    let converted = 0;
    let skipped = 0;

    for (const file of req.files) {
      const stem = sanitize(path.parse(file.originalname).name);
      if (!stem) continue;
      const dest = path.join(albumDir, `${stem}.webp`);
      if (existsSync(dest)) {
        skipped++;
        broadcast({ type: 'log', msg: `⏭️ 건너뜀: ${stem}.webp` });
        continue;
      }
      await sharp(file.buffer).webp({ quality: 85 }).toFile(dest);
      converted++;
      broadcast({ type: 'log', msg: `✅ 변환: ${file.originalname} → ${stem}.webp` });
    }

    const ymlPath = path.join(ALBUMS_DIR, `${albumName}.yml`);
    if (!existsSync(ymlPath)) {
      const dateMatch = albumName.match(/^(\d{6})/);
      let date;
      if (dateMatch) {
        const d = dateMatch[1];
        date = `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
      } else {
        date = new Date().toISOString().slice(0, 10);
      }
      const photos = (await fs.readdir(albumDir)).filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f)).sort();
      const cover = photos.length ? `${albumName}/${photos[0]}` : '';
      const yml = `title: "${albumName}"\nslug: "${albumName}"\ndate: ${date}\ncover: ${cover}\n`;
      await fs.writeFile(ymlPath, yml);
    }

    res.json({ converted, skipped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/albums', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const albumDir = path.join(ALBUMS_DIR, name);
    await fs.mkdir(albumDir, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/albums/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const ymlPath = path.join(ALBUMS_DIR, `${name}.yml`);
    const albumDir = path.join(ALBUMS_DIR, name);
    const thumbDir = path.join(THUMB_DIR, name);
    if (existsSync(ymlPath)) await fs.unlink(ymlPath);
    if (existsSync(albumDir)) await fs.rm(albumDir, { recursive: true });
    if (existsSync(thumbDir)) await fs.rm(thumbDir, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/albums/:name/delete-photos', async (req, res) => {
  try {
    const { photos } = req.body;
    const albumDir = path.join(ALBUMS_DIR, req.params.name);
    const thumbDir = path.join(THUMB_DIR, req.params.name);
    let deleted = 0;
    for (const photo of photos) {
      const filePath = path.join(albumDir, photo);
      const thumbPath = path.join(thumbDir, photo);
      if (existsSync(filePath)) { await fs.unlink(filePath); deleted++; }
      if (existsSync(thumbPath)) await fs.unlink(thumbPath).catch(() => {});
    }
    await fixCoverIfNeeded(req.params.name, photos);
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/albums/:name/cover', async (req, res) => {
  try {
    const { photo } = req.body;
    const ymlPath = path.join(ALBUMS_DIR, `${req.params.name}.yml`);
    let content = await fs.readFile(ymlPath, 'utf-8');
    content = content.replace(/cover: .*/, `cover: ${req.params.name}/${photo}`);
    await fs.writeFile(ymlPath, content);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git deploy
app.post('/api/deploy', async (req, res) => {
  res.json({ ok: true });
  broadcast({ type: 'deploy-start' });
  try {
    await gitExec(['add', '.']);
    const commitResult = await gitExec(['commit', '-m', 'update: 앨범 변경']).catch(() => null);
    if (!commitResult) {
      broadcast({ type: 'log', msg: '⚠️ 커밋할 변경사항 없음' });
    }
    await gitExec(['push']);
    broadcast({ type: 'deploy-done', success: true });
  } catch (e) {
    broadcast({ type: 'deploy-done', success: false, error: e.message });
  }
});

app.get('/api/git/status', async (req, res) => {
  try {
    const result = await gitExec(['status', '--short']);
    res.json({ status: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function gitExec(args) {
  return new Promise((resolve, reject) => {
    broadcast({ type: 'log', msg: `$ git ${args.join(' ')}` });
    const proc = spawn('git', args, { cwd: __dirname });
    let out = '';
    proc.stdout.on('data', d => {
      const line = d.toString();
      out += line;
      broadcast({ type: 'git', msg: line });
    });
    proc.stderr.on('data', d => {
      const line = d.toString();
      out += line;
      broadcast({ type: 'git', msg: line });
    });
    proc.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`git ${args[0]} failed (exit ${code}): ${out}`));
    });
    setTimeout(() => {
      proc.kill();
      reject(new Error(`git ${args[0]} timed out (60s)`));
    }, 60000);
  });
}

function sanitize(name) {
  let clean = name.replace(/[^a-zA-Z0-9\-]/g, '');
  clean = clean.replace(/^[-]+/, '').replace(/-+/g, '-').replace(/-+$/, '');
  return clean || 'photo';
}

function parseYml(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

async function fixCoverIfNeeded(albumName, deletedPhotos) {
  const ymlPath = path.join(ALBUMS_DIR, `${albumName}.yml`);
  if (!existsSync(ymlPath)) return;
  const content = await fs.readFile(ymlPath, 'utf-8');
  const coverMatch = content.match(/cover: .+?\/(.+)/);
  if (coverMatch && deletedPhotos.includes(coverMatch[1])) {
    const albumDir = path.join(ALBUMS_DIR, albumName);
    const remaining = (await fs.readdir(albumDir))
      .filter(f => /\.(webp|jpg|jpeg|png)$/i.test(f)).sort();
    if (remaining.length) {
      const updated = content.replace(/cover: .*/, `cover: ${albumName}/${remaining[0]}`);
      await fs.writeFile(ymlPath, updated);
    }
  }
}

// --- Serve frontend ---
app.get('/', (req, res) => {
  res.send(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>앨범 관리자</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; height: 100vh; }

  .sidebar { width: 280px; background: #141414; border-right: 1px solid #2a2a2a; display: flex; flex-direction: column; flex-shrink: 0; }
  .sidebar-header { padding: 20px; border-bottom: 1px solid #2a2a2a; }
  .sidebar-header h1 { font-size: 18px; font-weight: 600; }
  .album-list { flex: 1; overflow-y: auto; padding: 8px; }
  .album-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
  .album-item:hover { background: #1e1e1e; }
  .album-item.active { background: #1a3a5c; }
  .album-item .name { font-size: 13px; font-weight: 500; }
  .album-item .count { font-size: 11px; color: #888; }
  .sidebar-actions { padding: 12px; border-top: 1px solid #2a2a2a; display: flex; flex-direction: column; gap: 8px; }

  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { padding: 12px 20px; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; gap: 12px; background: #111; }
  .toolbar h2 { font-size: 16px; flex: 1; }
  .content { flex: 1; overflow-y: auto; padding: 20px; }

  .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
  .photo-card { position: relative; border-radius: 8px; overflow: hidden; background: #1a1a1a; border: 2px solid transparent; cursor: pointer; }
  .photo-card.selected { border-color: #3b82f6; }
  .photo-card.is-cover { border-color: #f59e0b; }
  .photo-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #222; }
  .photo-card .label { padding: 4px 6px; font-size: 10px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .photo-card .cover-badge { position: absolute; top: 4px; right: 4px; background: #f59e0b; color: #000; font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 600; }
  .photo-card .check { position: absolute; top: 4px; left: 4px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.4); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; }
  .photo-card.selected .check { background: #3b82f6; border-color: #3b82f6; }

  .console-panel { height: 180px; background: #0d0d0d; border-top: 1px solid #2a2a2a; display: flex; flex-direction: column; flex-shrink: 0; }
  .console-header { padding: 6px 16px; font-size: 12px; color: #888; border-bottom: 1px solid #1a1a1a; display: flex; justify-content: space-between; align-items: center; }
  .console-body { flex: 1; overflow-y: auto; padding: 6px 16px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px; line-height: 1.5; }
  .console-body .log-git { color: #4ade80; }
  .console-body .log-info { color: #38bdf8; }
  .console-body .log-error { color: #f87171; }

  .btn { padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s; }
  .btn-primary { background: #3b82f6; color: white; }
  .btn-primary:hover { background: #2563eb; }
  .btn-danger { background: #dc2626; color: white; }
  .btn-danger:hover { background: #b91c1c; }
  .btn-success { background: #16a34a; color: white; }
  .btn-success:hover { background: #15803d; }
  .btn-ghost { background: transparent; color: #aaa; border: 1px solid #333; }
  .btn-ghost:hover { background: #1e1e1e; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .upload-zone { border: 2px dashed #333; border-radius: 12px; padding: 40px; text-align: center; color: #666; cursor: pointer; transition: all 0.2s; }
  .upload-zone:hover, .upload-zone.dragover { border-color: #3b82f6; color: #3b82f6; background: rgba(59,130,246,0.05); }
  .upload-zone input { display: none; }

  .empty { text-align: center; padding: 60px; color: #555; }
  .empty .icon { font-size: 48px; margin-bottom: 16px; }

  .deploy-status { display: inline-flex; align-items: center; gap: 6px; }
  .deploy-status .spinner { width: 14px; height: 14px; border: 2px solid #333; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; min-width: 360px; }
  .dialog h3 { margin-bottom: 16px; }
  .dialog .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .dialog input[type=text] { width: 100%; padding: 8px 12px; background: #0a0a0a; border: 1px solid #333; border-radius: 6px; color: #e0e0e0; font-size: 14px; }
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-header"><h1>앨범 관리자</h1></div>
  <div class="album-list" id="albumList"></div>
  <div class="sidebar-actions">
    <button class="btn btn-primary" onclick="showNewAlbumDialog()" style="width:100%">+ 새 앨범</button>
    <button class="btn btn-success" onclick="deploy()" id="deployBtn" style="width:100%">배포</button>
  </div>
</div>

<div class="main">
  <div class="toolbar">
    <h2 id="toolbarTitle">앨범을 선택하세요</h2>
    <div id="toolbarActions"></div>
  </div>
  <div class="content" id="content">
    <div class="empty"><div class="icon">📸</div>왼쪽에서 앨범을 선택하거나<br>새 앨범을 만드세요</div>
  </div>
  <div class="console-panel">
    <div class="console-header">
      <span>콘솔</span>
      <button class="btn btn-ghost" onclick="clearConsole()" style="padding:2px 8px;font-size:11px">지우기</button>
    </div>
    <div class="console-body" id="console"></div>
  </div>
</div>

<div class="dialog-overlay" id="newAlbumDialog" style="display:none">
  <div class="dialog">
    <h3>새 앨범 만들기</h3>
    <input type="text" id="newAlbumName" placeholder="예: 260505 Seoul">
    <div class="actions">
      <button class="btn btn-ghost" onclick="hideDialog()">취소</button>
      <button class="btn btn-primary" onclick="createAlbum()">만들기</button>
    </div>
  </div>
</div>

<script>
let albums = [];
let currentAlbum = null;
let selectedPhotos = new Set();
let loadVersion = 0;

const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'log' || data.type === 'git') {
    appendLog(data.msg, data.type === 'git' ? 'git' : 'info');
  } else if (data.type === 'deploy-start') {
    appendLog('🚀 배포 시작...', 'info');
    document.getElementById('deployBtn').disabled = true;
    document.getElementById('deployBtn').innerHTML = '<span class="deploy-status"><span class="spinner"></span> 배포 중...</span>';
  } else if (data.type === 'deploy-done') {
    document.getElementById('deployBtn').disabled = false;
    document.getElementById('deployBtn').textContent = '배포';
    appendLog(data.success ? '✅ 배포 완료!' : '❌ 배포 실패: ' + data.error, data.success ? 'info' : 'error');
  }
};

function appendLog(msg, type) {
  const el = document.getElementById('console');
  const line = document.createElement('div');
  line.className = 'log-' + type;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearConsole() { document.getElementById('console').innerHTML = ''; }

async function loadAlbums() {
  albums = await (await fetch('/api/albums')).json();
  renderAlbumList();
}

function renderAlbumList() {
  const list = document.getElementById('albumList');
  list.innerHTML = '';
  for (const a of albums) {
    const div = document.createElement('div');
    div.className = 'album-item' + (currentAlbum === a.name ? ' active' : '');
    div.innerHTML = '<span class="name">' + esc(a.name) + '</span><span class="count">' + a.photoCount + '</span>';
    div.onclick = () => selectAlbum(a.name);
    list.appendChild(div);
  }
}

async function selectAlbum(name) {
  const version = ++loadVersion;
  currentAlbum = name;
  selectedPhotos.clear();
  renderAlbumList();

  const album = albums.find(a => a.name === name);
  document.getElementById('toolbarTitle').textContent = name;
  document.getElementById('toolbarActions').innerHTML =
    '<button class="btn btn-danger" onclick="deleteAlbum()">앨범 삭제</button>';

  const content = document.getElementById('content');
  content.innerHTML = '<div style="text-align:center;padding:40px;color:#666">로딩 중...</div>';

  const photos = await (await fetch('/api/albums/' + encodeURIComponent(name) + '/photos')).json();

  if (version !== loadVersion) return;

  if (photos.length === 0) {
    content.innerHTML = '<div class="upload-zone" id="uploadZone" onclick="document.getElementById(\\'fileInput\\').click()">' +
      '<input type="file" id="fileInput" multiple accept="image/*" onchange="uploadFiles(this.files)">' +
      '<div style="font-size:36px;margin-bottom:12px">📂</div>' +
      '<div>사진을 드래그하거나 클릭하여 업로드</div></div>';
    setupDragDrop();
    return;
  }

  let html = '<div style="margin-bottom:12px;display:flex;align-items:center;gap:12px">' +
    '<button class="btn btn-ghost" onclick="toggleSelectAll()">전체 선택</button>' +
    '<button class="btn btn-danger" id="deleteSelectedBtn" onclick="deleteSelected()" disabled>선택 삭제</button>' +
    '<div style="flex:1"></div>' +
    '<label class="upload-zone" style="padding:8px 16px;border-radius:8px;font-size:12px;display:inline-block">' +
      '<input type="file" id="fileInput" multiple accept="image/*" onchange="uploadFiles(this.files)">+ 사진 추가' +
    '</label></div>';

  html += '<div class="photo-grid">';
  for (const p of photos) {
    const isCover = album && album.cover && album.cover.endsWith('/' + p.name);
    html += '<div class="photo-card' + (isCover ? ' is-cover' : '') + '" data-name="' + esc(p.name) + '" onclick="togglePhoto(this)">' +
      '<div class="check">✓</div>' +
      (isCover ? '<div class="cover-badge">커버</div>' : '') +
      '<img src="' + p.thumb + '" loading="lazy">' +
      '<div class="label" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>' + esc(p.name) + '</span>' +
        '<button class="btn btn-ghost" onclick="event.stopPropagation();setCover(\\'' + esc(p.name).replace(/'/g, "\\\\'") + '\\')" style="padding:2px 6px;font-size:10px">커버</button>' +
      '</div></div>';
  }
  html += '</div>';
  content.innerHTML = html;
  setupDragDrop();
}

function togglePhoto(el) {
  const name = el.dataset.name;
  if (selectedPhotos.has(name)) { selectedPhotos.delete(name); el.classList.remove('selected'); }
  else { selectedPhotos.add(name); el.classList.add('selected'); }
  const btn = document.getElementById('deleteSelectedBtn');
  if (btn) btn.disabled = selectedPhotos.size === 0;
}

function toggleSelectAll() {
  const cards = document.querySelectorAll('.photo-card');
  const allSelected = selectedPhotos.size === cards.length;
  selectedPhotos.clear();
  cards.forEach(c => {
    if (!allSelected) { selectedPhotos.add(c.dataset.name); c.classList.add('selected'); }
    else c.classList.remove('selected');
  });
  const btn = document.getElementById('deleteSelectedBtn');
  if (btn) btn.disabled = selectedPhotos.size === 0;
}

async function deleteSelected() {
  if (!currentAlbum || !selectedPhotos.size) return;
  if (!confirm(selectedPhotos.size + '장을 삭제하시겠습니까?')) return;
  await fetch('/api/albums/' + encodeURIComponent(currentAlbum) + '/delete-photos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: [...selectedPhotos] })
  });
  appendLog(selectedPhotos.size + '장 삭제 완료', 'info');
  await loadAlbums();
  selectAlbum(currentAlbum);
}

async function setCover(photoName) {
  if (!currentAlbum) return;
  await fetch('/api/albums/' + encodeURIComponent(currentAlbum) + '/cover', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo: photoName })
  });
  appendLog('커버 변경: ' + photoName, 'info');
  await loadAlbums();
  selectAlbum(currentAlbum);
}

async function deleteAlbum() {
  if (!currentAlbum) return;
  if (!confirm("'" + currentAlbum + "' 앨범을 삭제하시겠습니까?")) return;
  await fetch('/api/albums/' + encodeURIComponent(currentAlbum), { method: 'DELETE' });
  appendLog('앨범 삭제: ' + currentAlbum, 'info');
  currentAlbum = null;
  document.getElementById('toolbarTitle').textContent = '앨범을 선택하세요';
  document.getElementById('toolbarActions').innerHTML = '';
  document.getElementById('content').innerHTML = '<div class="empty"><div class="icon">📸</div>왼쪽에서 앨범을 선택하거나<br>새 앨범을 만드세요</div>';
  await loadAlbums();
}

function setupDragDrop() {
  const zone = document.getElementById('content');
  zone.ondragover = e => { e.preventDefault(); };
  zone.ondrop = e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); };
}

async function uploadFiles(files) {
  if (!files.length || !currentAlbum) return;
  appendLog(files.length + '개 파일 업로드 중...', 'info');
  const form = new FormData();
  for (const f of files) form.append('photos', f);
  const result = await (await fetch('/api/albums/' + encodeURIComponent(currentAlbum) + '/upload', { method: 'POST', body: form })).json();
  appendLog('업로드 완료 (변환: ' + result.converted + ', 건너뜀: ' + result.skipped + ')', 'info');
  await loadAlbums();
  selectAlbum(currentAlbum);
}

function showNewAlbumDialog() {
  document.getElementById('newAlbumDialog').style.display = 'flex';
  const input = document.getElementById('newAlbumName');
  input.value = '';
  input.focus();
}
function hideDialog() { document.getElementById('newAlbumDialog').style.display = 'none'; }

async function createAlbum() {
  const name = document.getElementById('newAlbumName').value.trim();
  if (!name) return;
  await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  hideDialog();
  appendLog('새 앨범 생성: ' + name, 'info');
  await loadAlbums();
  selectAlbum(name);
}

async function deploy() {
  if (!confirm('변경사항을 배포하시겠습니까?')) return;
  await fetch('/api/deploy', { method: 'POST' });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

document.getElementById('newAlbumName').addEventListener('keydown', e => {
  if (e.key === 'Enter') createAlbum();
  if (e.key === 'Escape') hideDialog();
});

loadAlbums();
appendLog('앨범 관리자 시작됨', 'info');
</script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log('\\n  앨범 관리자: http://localhost:' + PORT + '\\n');
});

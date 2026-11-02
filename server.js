// Phòng Chiếu Vô Hạn - Bước 1: máy chủ sảnh chờ (Node.js + ws)
// Chạy: npm install && node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

// ===== Hằng số (đổi ở đây) =====
const PORT = process.env.PORT || 3000;
const COUNT_SEC = 60;      // giây đếm ngược mỗi vòng
const MIN_PLAYERS = 1;     // số người tối thiểu để bắt đầu (1 để thử một mình)
const MAX_LOBBY = 60;      // sức chứa sảnh
const PICK = 10;           // số người được chọn

// ===== CHỖ NHÉT PHÓ BẢN (máy chủ): tên, thời lượng, 10 điểm xuất hiện =====
const DUNGEON = {
  id: 'tam', name: 'Phòng thử', duration: 60,
  spawns: Array.from({ length: 10 }, (_, i) => ({ x: Math.cos(i * Math.PI / 5) * 4, z: Math.sin(i * Math.PI / 5) * 4 })),
};
const BOUND = { lobby: { x: 8.6, z0: -7.8, z1: 9.2 }, dungeon: { x: 14, z0: -14, z1: 14 } };
const BAD = ['địt', 'đụ', 'lồn', 'cặc', 'đm', 'fuck', 'shit'];

// ===== Máy chủ HTTP: phục vụ index.html =====
const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { res.writeHead(500); return res.end('Thiếu index.html'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
  });
});
const wss = new WebSocketServer({ server });

// ===== Trạng thái =====
const players = new Map(); const seats = Array(60).fill(null);
let nid = 1, mode = 'wait', end = 0, chosen = [], dirty = true;
const seatPos = s => { const r = (s / 10) | 0, k = s % 10, j = k % 5; return { x: (k < 5 ? -1 : 1) * (1.2 + j * 1.1), z: -2 + r * 1.6 }; };
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const clean = n => { n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Khách'; return BAD.some(b => n.toLowerCase().includes(b)) ? '***' : n; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const lobbyList = () => [...players.values()].filter(p => p.room === 'lobby');
function removeP(p) { if (p.seat >= 0) seats[p.seat] = null; players.delete(p.id); dirty = true; }

wss.on('connection', ws => {
  let p = null, msgs = 0; const iv = setInterval(() => msgs = 0, 1000);
  ws.on('message', raw => {
    if (++msgs > 40) return; // giới hạn tần suất
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !p) {
      if (lobbyList().length >= MAX_LOBBY) return send(ws, { t: 'full' });
      p = { id: nid++, ws, name: clean(m.name), color: (m.color | 0) % 6, room: 'lobby', x: (Math.random() - .5) * 6, z: -5, yaw: 0, seat: -1, e: -1, eT: 0, lt: Date.now() };
      players.set(p.id, p); dirty = true; send(ws, { t: 'hi', id: p.id, x: p.x, z: p.z });
    } else if (p) {
      if (m.t === 'pos' && p.seat < 0 && Number.isFinite(m.x) && Number.isFinite(m.z)) {
        const now = Date.now(), dt = Math.max((now - p.lt) / 1000, .05); p.lt = now;
        if (Math.hypot(m.x - p.x, m.z - p.z) > 8 * dt + .5) return; // quá nhanh: bỏ qua
        const b = BOUND[p.room];
        p.x = Math.max(-b.x, Math.min(b.x, m.x)); p.z = Math.max(b.z0, Math.min(b.z1, m.z)); p.yaw = Number.isFinite(m.yaw) ? m.yaw : 0;
      } else if (m.t === 'sit' && p.room === 'lobby' && p.seat < 0) {
        const s = m.seat | 0;
        if (s >= 0 && s < 60 && seats[s] == null) { const sp = seatPos(s); if (Math.hypot(sp.x - p.x, sp.z - p.z) < 2.5) { seats[s] = p.id; p.seat = s; p.x = sp.x; p.z = sp.z; } }
      } else if (m.t === 'stand' && p.seat >= 0) { seats[p.seat] = null; p.seat = -1; }
      else if (m.t === 'emo') { p.e = (m.e | 0) % 4; p.eT = Date.now(); }
    }
  });
  ws.on('close', () => { clearInterval(iv); if (p) removeP(p); });
});

let info = [];
function startLive(now) {
  chosen = chosen.filter(id => players.has(id));
  if (!chosen.length) { mode = 'wait'; return; }
  chosen.forEach((id, i) => {
    const p = players.get(id), s = DUNGEON.spawns[i];
    if (p.seat >= 0) { seats[p.seat] = null; p.seat = -1; }
    p.room = 'dungeon'; p.x = s.x; p.z = s.z; send(p.ws, { t: 'tp', room: 'dungeon', x: s.x, z: s.z });
  });
  mode = 'live'; end = now + DUNGEON.duration * 1000;
}
function endLive(now) {
  chosen.forEach(id => {
    const p = players.get(id); if (!p) return;
    p.room = 'lobby'; p.x = (Math.random() - .5) * 6; p.z = 8; send(p.ws, { t: 'tp', room: 'lobby', x: p.x, z: p.z });
  });
  mode = 'result'; end = now + 7000;
}

// ===== Vòng lặp chính 10 lần/giây =====
setInterval(() => {
  const now = Date.now(), lob = lobbyList();
  if (mode === 'wait') { if (lob.length >= MIN_PLAYERS) { mode = 'count'; end = now + COUNT_SEC * 1000; } }
  else if (mode === 'count') {
    if (lob.length < MIN_PLAYERS) mode = 'wait';
    else if (now >= end) { chosen = shuffle(lob.slice()).slice(0, PICK).map(p => p.id); info = chosen.map(id => ({ id, name: players.get(id).name })); mode = 'draw'; end = now + 6000; }
  }
  else if (mode === 'draw') { if (now >= end) startLive(now); }
  else if (mode === 'live') { if (now >= end || !chosen.some(id => players.has(id))) endLive(now); }
  else if (mode === 'result') { if (now >= end) { mode = 'wait'; chosen = []; info = []; } }

  if (dirty) { dirty = false; const list = [...players.values()].map(p => [p.id, p.name, p.color]); wss.clients.forEach(c => send(c, { t: 'r', list })); }
  const st = JSON.stringify({
    t: 's', mode, left: Math.max(0, end - now), ch: info, dn: DUNGEON.name,
    p: [...players.values()].map(p => [p.id, p.room, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), p.seat, now - p.eT < 3000 ? p.e : -1]),
  });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(st); });
}, 100);

server.listen(PORT, () => console.log('Phòng Chiếu Vô Hạn chạy tại cổng ' + PORT));
